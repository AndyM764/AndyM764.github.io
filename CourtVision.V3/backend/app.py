import os
import shutil
import signal
import socket
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Literal

from flask import Flask, Response, jsonify, request, send_file, send_from_directory

app = Flask(__name__)

HLS_DIRECTORY = Path(os.environ.get("COURTVISION_HLS_DIR", "/tmp/courtvision-camera-hls"))
HLS_PLAYLIST = HLS_DIRECTORY / "stream.m3u8"
HLS_SEGMENT_PREFIX = "segment_"
RECORDING_DIR = Path(os.environ.get("COURTVISION_RECORDING_DIR", "/tmp/courtvision-recordings"))
RECORDING_DIR.mkdir(parents=True, exist_ok=True)

CAMERA_WIDTH = os.environ.get("COURTVISION_CAMERA_WIDTH", "1280")
CAMERA_HEIGHT = os.environ.get("COURTVISION_CAMERA_HEIGHT", "720")
CAMERA_FPS = os.environ.get("COURTVISION_CAMERA_FPS", "30")
CAMERA_INTRA_PERIOD = os.environ.get("COURTVISION_CAMERA_INTRA_PERIOD", "15")
CAMERA_START_TIMEOUT_SECONDS = float(os.environ.get("COURTVISION_CAMERA_START_TIMEOUT", "8"))
HLS_SEGMENT_SECONDS = os.environ.get("COURTVISION_HLS_SEGMENT_SECONDS", "0.5")
HLS_LIST_SIZE = os.environ.get("COURTVISION_HLS_LIST_SIZE", "3")
RECORDING_FINALIZE_TIMEOUT_SECONDS = float(
    os.environ.get("COURTVISION_RECORDING_FINALIZE_TIMEOUT", "45")
)

CameraOwner = Literal["recording", "preview"]

last_parameters: dict[str, Any] | None = None
ball_machine_power: Literal["on", "off"] = "off"


def get_current_ip_address() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        except OSError:
            return ""


class CameraResourceGuard:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._owner: CameraOwner | None = None

    @property
    def owner(self) -> CameraOwner | None:
        with self._lock:
            return self._owner

    def acquire(self, owner: CameraOwner) -> None:
        with self._lock:
            if self._owner is not None and self._owner != owner:
                raise RuntimeError(
                    f"Camera is already in use by {self._owner}. "
                    f"Stop {self._owner} before starting {owner}."
                )

            self._owner = owner

    def release(self, owner: CameraOwner) -> None:
        with self._lock:
            if self._owner == owner:
                self._owner = None


camera_guard = CameraResourceGuard()


def validate_system_commands(*commands: str) -> None:
    for command in commands:
        if shutil.which(command) is None:
            raise RuntimeError(f"{command} is not installed or not available on PATH.")


def build_rpicam_command() -> list[str]:
    return [
        "rpicam-vid",
        "--timeout",
        "0",
        "--codec",
        "h264",
        "--inline",
        "--width",
        CAMERA_WIDTH,
        "--height",
        CAMERA_HEIGHT,
        "--framerate",
        CAMERA_FPS,
        "--intra",
        CAMERA_INTRA_PERIOD,
        "--nopreview",
        "-o",
        "-",
    ]


def capture_stderr(name: str, process: subprocess.Popen[bytes], sink: list[str]) -> None:
    if process.stderr is None:
        return

    def read_stderr() -> None:
        assert process.stderr is not None

        for raw_line in iter(process.stderr.readline, b""):
            line = raw_line.decode("utf-8", errors="replace").strip()

            if line:
                sink.append(f"{name}: {line}")
                del sink[:-20]

    threading.Thread(target=read_stderr, daemon=True).start()


def terminate_process(process: subprocess.Popen[bytes] | None, timeout_seconds: float = 3) -> None:
    if process is None or process.poll() is not None:
        return

    process.terminate()

    try:
        process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        process.send_signal(signal.SIGKILL)
        process.wait(timeout=timeout_seconds)


def validate_mp4(mp4_path: Path) -> None:
    if not mp4_path.exists() or mp4_path.stat().st_size == 0:
        raise RuntimeError("Finalized MP4 file was not created.")

    if shutil.which("ffprobe") is None:
        return

    ffprobe_command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(mp4_path),
    ]

    completed = subprocess.run(ffprobe_command, capture_output=True, text=True, check=False)

    if completed.returncode != 0:
        raise RuntimeError("Finalized MP4 failed validation with ffprobe.")

    try:
        duration = float(completed.stdout.strip())
    except ValueError as error:
        raise RuntimeError("Finalized MP4 does not contain a valid duration.") from error

    if duration <= 0:
        raise RuntimeError("Finalized MP4 duration is invalid.")


class DirectRecordingManager:
    """Recording-first pipeline: rpicam-vid -> ffmpeg -> MP4 on disk."""

    def __init__(self, guard: CameraResourceGuard) -> None:
        self._guard = guard
        self._lock = threading.Lock()
        self._active_recording: dict[str, Any] | None = None
        self._camera_process: subprocess.Popen[bytes] | None = None
        self._ffmpeg_process: subprocess.Popen[bytes] | None = None
        self._process_errors: list[str] = []

    @property
    def is_recording(self) -> bool:
        with self._lock:
            return self._active_recording is not None

    def start(self) -> str:
        with self._lock:
            if self._active_recording is not None:
                raise RuntimeError("A recording is already in progress.")

            validate_system_commands("rpicam-vid", "ffmpeg")
            self._guard.acquire("recording")

            recording_id = uuid.uuid4().hex
            output_path = RECORDING_DIR / f"{recording_id}.mp4"
            self._process_errors = []

            ffmpeg_command = [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "warning",
                "-fflags",
                "nobuffer",
                "-f",
                "h264",
                "-r",
                CAMERA_FPS,
                "-i",
                "pipe:0",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-pix_fmt",
                "yuv420p",
                "-profile:v",
                "baseline",
                "-level",
                "3.1",
                "-movflags",
                "+faststart",
                str(output_path),
            ]

            try:
                self._camera_process = subprocess.Popen(
                    build_rpicam_command(),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                capture_stderr("rpicam-vid", self._camera_process, self._process_errors)

                if self._camera_process.stdout is None:
                    raise RuntimeError("Unable to read rpicam-vid output.")

                self._ffmpeg_process = subprocess.Popen(
                    ffmpeg_command,
                    stdin=self._camera_process.stdout,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
                capture_stderr("ffmpeg", self._ffmpeg_process, self._process_errors)
                self._camera_process.stdout.close()

                time.sleep(0.35)
                self._raise_if_process_failed()

                self._active_recording = {
                    "recording_id": recording_id,
                    "output_path": output_path,
                }

                return recording_id
            except Exception:
                self._cleanup_processes()
                self._guard.release("recording")
                raise

    def stop(self, recording_id: str) -> Path:
        with self._lock:
            if self._active_recording is None:
                raise RuntimeError("No recording is in progress.")

            if self._active_recording["recording_id"] != recording_id:
                raise RuntimeError("Recording ID does not match the active recording.")

            output_path: Path = self._active_recording["output_path"]
            self._active_recording = None

        terminate_process(self._camera_process)
        self._camera_process = None

        if self._ffmpeg_process is not None and self._ffmpeg_process.stdin is not None:
            try:
                self._ffmpeg_process.stdin.close()
            except OSError:
                pass

        if self._ffmpeg_process is not None:
            try:
                self._ffmpeg_process.wait(timeout=RECORDING_FINALIZE_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                terminate_process(self._ffmpeg_process, timeout_seconds=5)
                self._ffmpeg_process = None
                self._guard.release("recording")
                raise RuntimeError(
                    "Recording finalization timed out. "
                    f"{self._get_process_diagnostics()}"
                )

            if self._ffmpeg_process.poll() not in (0, None):
                diagnostics = self._get_process_diagnostics()
                self._ffmpeg_process = None
                self._guard.release("recording")
                raise RuntimeError(
                    "ffmpeg failed while finalizing the recording. " + diagnostics
                )

        self._ffmpeg_process = None
        self._guard.release("recording")

        try:
            validate_mp4(output_path)
        except RuntimeError:
            output_path.unlink(missing_ok=True)
            raise

        return output_path

    def _cleanup_processes(self) -> None:
        terminate_process(self._ffmpeg_process)
        terminate_process(self._camera_process)
        self._ffmpeg_process = None
        self._camera_process = None

    def _raise_if_process_failed(self) -> None:
        failed_processes: list[str] = []

        if self._camera_process is None or self._camera_process.poll() is not None:
            failed_processes.append(
                f"rpicam-vid exited with code {self._get_return_code(self._camera_process)}"
            )

        if self._ffmpeg_process is None or self._ffmpeg_process.poll() is not None:
            failed_processes.append(
                f"ffmpeg exited with code {self._get_return_code(self._ffmpeg_process)}"
            )

        if failed_processes:
            diagnostics = self._get_process_diagnostics()
            self._cleanup_processes()
            raise RuntimeError(
                "Recording pipeline failed to start. " + " ".join(failed_processes) + " " + diagnostics
            )

    def _get_process_diagnostics(self) -> str:
        if not self._process_errors:
            return "No process error output was captured."

        return "Recent process output: " + " | ".join(self._process_errors[-8:])

    def _get_return_code(self, process: subprocess.Popen[bytes] | None) -> str:
        if process is None:
            return "not started"

        return str(process.poll())


class HlsPreviewManager:
    """Low-latency HLS preview built on top of the same camera tooling."""

    def __init__(self, guard: CameraResourceGuard) -> None:
        self._guard = guard
        self._lock = threading.Lock()
        self._camera_process: subprocess.Popen[bytes] | None = None
        self._ffmpeg_process: subprocess.Popen[bytes] | None = None
        self._process_errors: list[str] = []

    @property
    def enabled(self) -> bool:
        with self._lock:
            return self._is_stream_process_running()

    def set_enabled(self, enabled: bool) -> None:
        with self._lock:
            if enabled:
                self._start_locked()
                return

            self._stop_locked()

    def ensure_playlist_ready(self, timeout_seconds: float) -> bool:
        deadline = time.monotonic() + timeout_seconds

        while time.monotonic() < deadline:
            if HLS_PLAYLIST.exists() and HLS_PLAYLIST.stat().st_size > 0:
                return True

            if not self._is_stream_process_running():
                raise RuntimeError(
                    "Camera preview stopped before the HLS playlist was ready. "
                    f"{self._get_process_diagnostics()}"
                )

            time.sleep(0.1)

        return HLS_PLAYLIST.exists() and HLS_PLAYLIST.stat().st_size > 0

    def get_diagnostics(self) -> str:
        with self._lock:
            return self._get_process_diagnostics()

    def _start_locked(self) -> None:
        if self._is_stream_process_running():
            return

        self._stop_locked()
        self._process_errors = []
        self._prepare_hls_directory()
        validate_system_commands("rpicam-vid", "ffmpeg")
        self._guard.acquire("preview")

        ffmpeg_command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-fflags",
            "nobuffer",
            "-flags",
            "low_delay",
            "-f",
            "h264",
            "-r",
            CAMERA_FPS,
            "-i",
            "pipe:0",
            "-c:v",
            "copy",
            "-f",
            "hls",
            "-hls_time",
            HLS_SEGMENT_SECONDS,
            "-hls_list_size",
            HLS_LIST_SIZE,
            "-hls_flags",
            "append_list+omit_endlist+independent_segments+program_date_time",
            "-hls_allow_cache",
            "0",
            "-hls_segment_filename",
            f"{HLS_SEGMENT_PREFIX}%05d.ts",
            "-hls_base_url",
            "/camera/hls/",
            "stream.m3u8",
        ]

        try:
            self._camera_process = subprocess.Popen(
                build_rpicam_command(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            capture_stderr("rpicam-vid", self._camera_process, self._process_errors)

            if self._camera_process.stdout is None:
                raise RuntimeError("Unable to read rpicam-vid output.")

            self._ffmpeg_process = subprocess.Popen(
                ffmpeg_command,
                cwd=HLS_DIRECTORY,
                stdin=self._camera_process.stdout,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            capture_stderr("ffmpeg", self._ffmpeg_process, self._process_errors)
            self._camera_process.stdout.close()

            time.sleep(0.25)
            self._raise_if_process_failed()
        except Exception:
            self._stop_locked()
            self._guard.release("preview")
            raise

    def _stop_locked(self) -> None:
        terminate_process(self._ffmpeg_process)
        terminate_process(self._camera_process)
        self._ffmpeg_process = None
        self._camera_process = None
        self._prepare_hls_directory()
        self._guard.release("preview")

    def _is_stream_process_running(self) -> bool:
        return (
            self._camera_process is not None
            and self._camera_process.poll() is None
            and self._ffmpeg_process is not None
            and self._ffmpeg_process.poll() is None
        )

    def _prepare_hls_directory(self) -> None:
        HLS_DIRECTORY.mkdir(parents=True, exist_ok=True)

        for path in HLS_DIRECTORY.iterdir():
            if path.name == "stream.m3u8" or path.name.startswith(HLS_SEGMENT_PREFIX):
                path.unlink(missing_ok=True)

    def _raise_if_process_failed(self) -> None:
        failed_processes: list[str] = []

        if self._camera_process is None or self._camera_process.poll() is not None:
            failed_processes.append(
                f"rpicam-vid exited with code {self._get_return_code(self._camera_process)}"
            )

        if self._ffmpeg_process is None or self._ffmpeg_process.poll() is not None:
            failed_processes.append(
                f"ffmpeg exited with code {self._get_return_code(self._ffmpeg_process)}"
            )

        if failed_processes:
            diagnostics = self._get_process_diagnostics()
            self._stop_locked()
            raise RuntimeError(
                "Camera preview failed to start. " + " ".join(failed_processes) + " " + diagnostics
            )

    def _get_process_diagnostics(self) -> str:
        if not self._process_errors:
            return "No process error output was captured."

        return "Recent process output: " + " | ".join(self._process_errors[-8:])

    def _get_return_code(self, process: subprocess.Popen[bytes] | None) -> str:
        if process is None:
            return "not started"

        return str(process.poll())


recording_manager = DirectRecordingManager(camera_guard)
preview_manager = HlsPreviewManager(camera_guard)


def delete_recording_file(filename: str) -> None:
    if "/" in filename or not filename.endswith(".mp4"):
        raise ValueError("Invalid recording filename.")

    recording_path = RECORDING_DIR / filename
    recording_path.unlink(missing_ok=True)


@app.get("/info")
def info() -> Response:
    return jsonify(
        {
            "hostname": socket.gethostname(),
            "ip": get_current_ip_address(),
        }
    )


@app.get("/status")
def status() -> Response:
    return jsonify(
        {
            "status": "ok",
            "cameraPreviewEnabled": preview_manager.enabled,
            "recordingActive": recording_manager.is_recording,
            "ballMachinePower": ball_machine_power,
            "cameraOwner": camera_guard.owner,
        }
    )


@app.post("/data")
def data() -> tuple[Response, int] | Response:
    global last_parameters

    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return jsonify({"success": False, "message": "JSON payload is required."}), 400

    required_numeric_fields = {
        "speed": (0, 250),
        "elevation": (0, 90),
        "spin": (-5000, 5000),
        "frequency": (0, 20),
    }

    for field_name, (minimum, maximum) in required_numeric_fields.items():
        if field_name not in payload:
            continue

        value = payload[field_name]

        if not isinstance(value, (int, float)):
            return jsonify(
                {"success": False, "message": f"{field_name} must be a number."}
            ), 400

        if value < minimum or value > maximum:
            return jsonify(
                {
                    "success": False,
                    "message": f"{field_name} must be between {minimum} and {maximum}.",
                }
            ), 400

    last_parameters = payload
    return jsonify({"success": True, "message": "Parameters received."})


@app.post("/ball-machine/state")
def ball_machine_state() -> tuple[Response, int] | Response:
    global ball_machine_power

    payload = request.get_json(silent=True)

    if not isinstance(payload, dict) or payload.get("power") not in ("on", "off"):
        return jsonify(
            {"success": False, "message": "Power must be 'on' or 'off'."}
        ), 400

    ball_machine_power = payload["power"]

    return jsonify(
        {
            "success": True,
            "power": ball_machine_power,
            "message": f"Ball machine turned {ball_machine_power}.",
        }
    )


@app.post("/camera/state")
def camera_state() -> tuple[Response, int] | Response:
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict) or not isinstance(payload.get("enabled"), bool):
        return jsonify({"success": False, "message": "Boolean enabled value is required."}), 400

    enabled = payload["enabled"]

    if enabled and recording_manager.is_recording:
        return jsonify(
            {
                "success": False,
                "message": "Cannot enable camera preview while a recording is in progress.",
            }
        ), 409

    try:
        preview_manager.set_enabled(enabled)

        if enabled and not preview_manager.ensure_playlist_ready(CAMERA_START_TIMEOUT_SECONDS):
            diagnostics = preview_manager.get_diagnostics()
            preview_manager.set_enabled(False)
            return jsonify(
                {"success": False, "message": f"Camera preview did not start. {diagnostics}"}
            ), 500

        return jsonify({"success": True, "enabled": enabled})
    except RuntimeError as error:
        preview_manager.set_enabled(False)
        return jsonify({"success": False, "message": str(error)}), 500


@app.get("/camera/stream")
def camera_stream() -> tuple[Response, int] | Response:
    return serve_camera_playlist()


@app.get("/camera/stream.m3u8")
def camera_stream_playlist() -> tuple[Response, int] | Response:
    return serve_camera_playlist()


def serve_camera_playlist() -> tuple[Response, int] | Response:
    if not preview_manager.enabled:
        return jsonify({"success": False, "message": "Camera preview is disabled."}), 409

    if not HLS_PLAYLIST.exists():
        return jsonify({"success": False, "message": "Camera preview is starting."}), 503

    response = send_from_directory(
        HLS_DIRECTORY, HLS_PLAYLIST.name, mimetype="application/vnd.apple.mpegurl"
    )
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/camera/hls/<path:filename>")
def camera_hls_segment(filename: str) -> tuple[Response, int] | Response:
    if not preview_manager.enabled:
        return jsonify({"success": False, "message": "Camera preview is disabled."}), 409

    if not filename.startswith(HLS_SEGMENT_PREFIX) or not filename.endswith(".ts"):
        return jsonify({"success": False, "message": "Invalid HLS segment."}), 404

    response = send_from_directory(HLS_DIRECTORY, filename, mimetype="video/mp2t")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@app.post("/recording/start")
def recording_start() -> tuple[Response, int] | Response:
    if preview_manager.enabled:
        return jsonify(
            {
                "success": False,
                "message": "Stop camera preview before starting a recording.",
            }
        ), 409

    try:
        recording_id = recording_manager.start()
        return jsonify({"success": True, "recordingId": recording_id})
    except RuntimeError as error:
        return jsonify({"success": False, "message": str(error)}), 500


@app.post("/recording/stop")
def recording_stop() -> tuple[Response, int] | Response:
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict) or not isinstance(payload.get("recordingId"), str):
        return jsonify({"success": False, "message": "Recording ID is required."}), 400

    recording_id = payload["recordingId"].strip()

    if len(recording_id) == 0:
        return jsonify({"success": False, "message": "Recording ID is required."}), 400

    try:
        mp4_path = recording_manager.stop(recording_id)
        filename = mp4_path.name

        return jsonify(
            {
                "success": True,
                "recordingId": recording_id,
                "downloadUrl": f"/recordings/{filename}",
                "filename": filename,
            }
        )
    except RuntimeError as error:
        return jsonify({"success": False, "message": str(error)}), 500


@app.get("/recordings/<path:filename>")
def recording_download(filename: str) -> tuple[Response, int] | Response:
    if "/" in filename or not filename.endswith(".mp4"):
        return jsonify({"success": False, "message": "Invalid recording filename."}), 404

    recording_path = RECORDING_DIR / filename

    if not recording_path.exists():
        return jsonify({"success": False, "message": "Recording was not found."}), 404

    response = send_file(
        recording_path,
        as_attachment=True,
        download_name=filename,
        mimetype="video/mp4",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.delete("/recordings/<path:filename>")
def recording_delete(filename: str) -> tuple[Response, int] | Response:
    try:
        delete_recording_file(filename)
    except ValueError:
        return jsonify({"success": False, "message": "Invalid recording filename."}), 404

    return jsonify({"success": True, "message": "Recording deleted from Raspberry Pi."})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), threaded=True)

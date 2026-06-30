import os
import shutil
import signal
import socket
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request, send_file, send_from_directory

app = Flask(__name__)


HLS_DIRECTORY = Path(os.environ.get("COURTVISION_HLS_DIR", "/tmp/courtvision-camera-hls"))
HLS_PLAYLIST = HLS_DIRECTORY / "stream.m3u8"
HLS_SEGMENT_PREFIX = "segment_"
OUTPUT_DIR = "/home/andy76/recordings"
os.makedirs(OUTPUT_DIR, exist_ok=True)

CAMERA_WIDTH = os.environ.get("COURTVISION_CAMERA_WIDTH", "1280")
CAMERA_HEIGHT = os.environ.get("COURTVISION_CAMERA_HEIGHT", "720")
CAMERA_FPS = os.environ.get("COURTVISION_CAMERA_FPS", "30")
CAMERA_INTRA_PERIOD = os.environ.get("COURTVISION_CAMERA_INTRA_PERIOD", "15")
CAMERA_START_TIMEOUT_SECONDS = float(os.environ.get("COURTVISION_CAMERA_START_TIMEOUT", "8"))
HLS_SEGMENT_SECONDS = os.environ.get("COURTVISION_HLS_SEGMENT_SECONDS", "0.5")
HLS_LIST_SIZE = os.environ.get("COURTVISION_HLS_LIST_SIZE", "3")
RECORDING_SEGMENT_SETTLE_SECONDS = float(os.environ.get("COURTVISION_RECORDING_SEGMENT_SETTLE", "1.2"))

last_parameters: dict[str, Any] | None = None


def get_current_ip_address() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        except OSError:
            return ""


class CameraStreamManager:
    def __init__(self) -> None:
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
                    "Camera pipeline stopped before the HLS playlist was ready. "
                    f"{self._get_process_diagnostics()}"
                )

            time.sleep(0.1)

        return HLS_PLAYLIST.exists() and HLS_PLAYLIST.stat().st_size > 0

    def get_latest_segment_index(self) -> int:
        indexes = [index for index, _ in self.get_segment_files()]
        return max(indexes, default=-1)

    def get_segment_files_after(self, start_index: int) -> list[Path]:
        return [path for index, path in self.get_segment_files() if index > start_index]

    def get_segment_files(self) -> list[tuple[int, Path]]:
        if not HLS_DIRECTORY.exists():
            return []

        segment_files: list[tuple[int, Path]] = []

        for path in HLS_DIRECTORY.glob(f"{HLS_SEGMENT_PREFIX}*.ts"):
            index = self._parse_segment_index(path)

            if index is not None:
                segment_files.append((index, path))

        return sorted(segment_files, key=lambda item: item[0])

    def get_diagnostics(self) -> str:
        with self._lock:
            return self._get_process_diagnostics()

    def _start_locked(self) -> None:
        if self._is_stream_process_running():
            return

        self._stop_locked()
        self._process_errors = []
        self._prepare_hls_directory()
        self._validate_system_commands()

        camera_command = [
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

        self._camera_process = subprocess.Popen(
            camera_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._capture_stderr("rpicam-vid", self._camera_process)

        if self._camera_process.stdout is None:
            self._stop_locked()
            raise RuntimeError("Unable to read rpicam-vid output.")

        self._ffmpeg_process = subprocess.Popen(
            ffmpeg_command,
            cwd=HLS_DIRECTORY,
            stdin=self._camera_process.stdout,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        self._capture_stderr("ffmpeg", self._ffmpeg_process)

        self._camera_process.stdout.close()
        time.sleep(0.25)
        self._raise_if_process_failed()

    def _stop_locked(self) -> None:
        self._terminate_process(self._ffmpeg_process)
        self._terminate_process(self._camera_process)
        self._ffmpeg_process = None
        self._camera_process = None
        self._prepare_hls_directory()

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

    def _validate_system_commands(self) -> None:
        if shutil.which("rpicam-vid") is None:
            raise RuntimeError("rpicam-vid is not installed or not available on PATH.")

        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg is not installed or not available on PATH.")

    def _capture_stderr(self, name: str, process: subprocess.Popen[bytes]) -> None:
        if process.stderr is None:
            return

        def read_stderr() -> None:
            assert process.stderr is not None

            for raw_line in iter(process.stderr.readline, b""):
                line = raw_line.decode("utf-8", errors="replace").strip()

                if line:
                    self._process_errors.append(f"{name}: {line}")
                    self._process_errors = self._process_errors[-20:]

        threading.Thread(target=read_stderr, daemon=True).start()

    def _raise_if_process_failed(self) -> None:
        failed_processes: list[str] = []

        if self._camera_process is None or self._camera_process.poll() is not None:
            failed_processes.append(f"rpicam-vid exited with code {self._get_return_code(self._camera_process)}")

        if self._ffmpeg_process is None or self._ffmpeg_process.poll() is not None:
            failed_processes.append(f"ffmpeg exited with code {self._get_return_code(self._ffmpeg_process)}")

        if failed_processes:
            diagnostics = self._get_process_diagnostics()
            self._stop_locked()
            raise RuntimeError("Camera pipeline failed to start. " + " ".join(failed_processes) + " " + diagnostics)

    def _get_process_diagnostics(self) -> str:
        if not self._process_errors:
            return "No process error output was captured."

        return "Recent process output: " + " | ".join(self._process_errors[-8:])

    def _get_return_code(self, process: subprocess.Popen[bytes] | None) -> str:
        if process is None:
            return "not started"

        return str(process.poll())

    def _parse_segment_index(self, path: Path) -> int | None:
        if not path.name.startswith(HLS_SEGMENT_PREFIX) or not path.name.endswith(".ts"):
            return None

        index_text = path.stem.removeprefix(HLS_SEGMENT_PREFIX)

        try:
            return int(index_text)
        except ValueError:
            return None

    def _terminate_process(self, process: subprocess.Popen[bytes] | None) -> None:
        if process is None or process.poll() is not None:
            return

        process.terminate()

        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.send_signal(signal.SIGKILL)
            process.wait(timeout=3)


camera_stream_manager = CameraStreamManager()


class RecordingManager:
    def __init__(self, stream_manager: CameraStreamManager) -> None:
        self._stream_manager = stream_manager
        self._lock = threading.Lock()
        self._active_recording: dict[str, Any] | None = None

    def start(self) -> str:
        with self._lock:
            if self._active_recording is not None:
                raise RuntimeError("A recording is already in progress.")

            camera_was_enabled = self._stream_manager.enabled

            if not camera_was_enabled:
                self._stream_manager.set_enabled(True)

            if not self._stream_manager.ensure_playlist_ready(CAMERA_START_TIMEOUT_SECONDS):
                if not camera_was_enabled:
                    self._stream_manager.set_enabled(False)

                raise RuntimeError("Camera stream was not ready for recording.")

            recording_id = uuid.uuid4().hex
            start_segment_index = (
                self._stream_manager.get_latest_segment_index() if camera_was_enabled else -1
            )

            self._active_recording = {
                "recording_id": recording_id,
                "start_segment_index": start_segment_index,
                "camera_was_enabled": camera_was_enabled,
            }

            return recording_id

    def stop(self, recording_id: str) -> tuple[str, Path]:
        with self._lock:
            if self._active_recording is None:
                raise RuntimeError("No recording is in progress.")

            if self._active_recording["recording_id"] != recording_id:
                raise RuntimeError("Recording ID does not match the active recording.")

            recording = self._active_recording
            self._active_recording = None

        time.sleep(RECORDING_SEGMENT_SETTLE_SECONDS)

        segments = self._stream_manager.get_segment_files_after(recording["start_segment_index"])

        try:
            if len(segments) == 0:
                raise RuntimeError("No camera segments were captured for this recording.")

            mp4_path = self._finalize_segments_to_mp4(recording_id, segments)

            return mp4_path.name, mp4_path
        finally:
            if not recording["camera_was_enabled"]:
                self._stream_manager.set_enabled(False)

    def _finalize_segments_to_mp4(self, recording_id: str, segments: list[Path]) -> Path:
        self._validate_system_commands()
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        output_path = Path(OUTPUT_DIR)

        concat_file = output_path / f"{recording_id}.txt"
        temporary_mp4 = output_path / f"{recording_id}.tmp.mp4"
        final_mp4 = output_path / f"{recording_id}.mp4"

        concat_file.write_text(
            "".join(f"file '{self._escape_concat_path(segment)}'\n" for segment in segments),
            encoding="utf-8",
        )

        ffmpeg_command = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
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
            str(temporary_mp4),
        ]

        completed = subprocess.run(ffmpeg_command, capture_output=True, text=True, check=False)

        if completed.returncode != 0:
            raise RuntimeError(
                "Unable to finalize recording as MP4: "
                f"{completed.stderr.strip() or 'ffmpeg failed.'}"
            )

        self._validate_mp4(temporary_mp4)
        temporary_mp4.replace(final_mp4)
        concat_file.unlink(missing_ok=True)

        return final_mp4

    def _validate_mp4(self, mp4_path: Path) -> None:
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

    def _validate_system_commands(self) -> None:
        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg is not installed or not available on PATH.")

    def _escape_concat_path(self, path: Path) -> str:
        return str(path).replace("'", "'\\''")


recording_manager = RecordingManager(camera_stream_manager)


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
    return jsonify({"status": "ok"})


@app.post("/data")
def data() -> tuple[Response, int] | Response:
    global last_parameters

    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return jsonify({"success": False, "message": "JSON payload is required."}), 400

    last_parameters = payload
    return jsonify({"success": True, "message": "Parameters received."})


@app.post("/camera/state")
def camera_state() -> tuple[Response, int] | Response:
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict) or not isinstance(payload.get("enabled"), bool):
        return jsonify({"success": False, "message": "Boolean enabled value is required."}), 400

    enabled = payload["enabled"]

    try:
        camera_stream_manager.set_enabled(enabled)

        if enabled and not camera_stream_manager.ensure_playlist_ready(CAMERA_START_TIMEOUT_SECONDS):
            diagnostics = camera_stream_manager.get_diagnostics()
            camera_stream_manager.set_enabled(False)
            return jsonify({"success": False, "message": f"Camera stream did not start. {diagnostics}"}), 500

        return jsonify({"success": True})
    except RuntimeError as error:
        camera_stream_manager.set_enabled(False)
        return jsonify({"success": False, "message": str(error)}), 500


@app.get("/camera/stream")
def camera_stream() -> tuple[Response, int] | Response:
    return serve_camera_playlist()


@app.get("/camera/stream.m3u8")
def camera_stream_playlist() -> tuple[Response, int] | Response:
    return serve_camera_playlist()


def serve_camera_playlist() -> tuple[Response, int] | Response:
    if not camera_stream_manager.enabled:
        return jsonify({"success": False, "message": "Camera stream is disabled."}), 409

    if not HLS_PLAYLIST.exists():
        return jsonify({"success": False, "message": "Camera stream is starting."}), 503

    response = send_from_directory(HLS_DIRECTORY, HLS_PLAYLIST.name, mimetype="application/vnd.apple.mpegurl")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/camera/hls/<path:filename>")
def camera_hls_segment(filename: str) -> tuple[Response, int] | Response:
    if not camera_stream_manager.enabled:
        return jsonify({"success": False, "message": "Camera stream is disabled."}), 409

    if not filename.startswith(HLS_SEGMENT_PREFIX) or not filename.endswith(".ts"):
        return jsonify({"success": False, "message": "Invalid HLS segment."}), 404

    response = send_from_directory(HLS_DIRECTORY, filename, mimetype="video/mp2t")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@app.post("/recording/start")
def recording_start() -> tuple[Response, int] | Response:
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
        filename, _ = recording_manager.stop(recording_id)

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

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    recording_path = Path(OUTPUT_DIR) / filename

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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), threaded=True)

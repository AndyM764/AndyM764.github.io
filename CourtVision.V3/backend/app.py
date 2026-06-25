import os
import shutil
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request, send_from_directory

app = Flask(__name__)


HLS_DIRECTORY = Path(os.environ.get("COURTVISION_HLS_DIR", "/tmp/courtvision-camera-hls"))
HLS_PLAYLIST = HLS_DIRECTORY / "stream.m3u8"
HLS_SEGMENT_PREFIX = "segment_"

CAMERA_WIDTH = os.environ.get("COURTVISION_CAMERA_WIDTH", "1280")
CAMERA_HEIGHT = os.environ.get("COURTVISION_CAMERA_HEIGHT", "720")
CAMERA_FPS = os.environ.get("COURTVISION_CAMERA_FPS", "30")
CAMERA_START_TIMEOUT_SECONDS = float(os.environ.get("COURTVISION_CAMERA_START_TIMEOUT", "8"))

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
        self._enabled = False
        self._camera_process: subprocess.Popen[bytes] | None = None
        self._ffmpeg_process: subprocess.Popen[bytes] | None = None

    @property
    def enabled(self) -> bool:
        with self._lock:
            return self._enabled and self._is_stream_process_running()

    def set_enabled(self, enabled: bool) -> None:
        with self._lock:
            if enabled:
                self._start_locked()
                self._enabled = True
                return

            self._enabled = False
            self._stop_locked()

    def ensure_playlist_ready(self, timeout_seconds: float) -> bool:
        deadline = time.monotonic() + timeout_seconds

        while time.monotonic() < deadline:
            if HLS_PLAYLIST.exists() and HLS_PLAYLIST.stat().st_size > 0:
                return True

            if not self.enabled:
                return False

            time.sleep(0.1)

        return HLS_PLAYLIST.exists() and HLS_PLAYLIST.stat().st_size > 0

    def _start_locked(self) -> None:
        if self._is_stream_process_running():
            return

        self._stop_locked()
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
            "-i",
            "pipe:0",
            "-c:v",
            "copy",
            "-f",
            "hls",
            "-hls_time",
            "1",
            "-hls_list_size",
            "4",
            "-hls_flags",
            "delete_segments+append_list+omit_endlist",
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

        self._camera_process.stdout.close()

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
            camera_stream_manager.set_enabled(False)
            return jsonify({"success": False, "message": "Camera stream did not start."}), 500

        return jsonify({"success": True})
    except RuntimeError as error:
        camera_stream_manager.set_enabled(False)
        return jsonify({"success": False, "message": str(error)}), 500


@app.get("/camera/stream")
def camera_stream() -> tuple[Response, int] | Response:
    if not camera_stream_manager.enabled:
        return jsonify({"success": False, "message": "Camera stream is disabled."}), 409

    if not HLS_PLAYLIST.exists():
        return jsonify({"success": False, "message": "Camera stream is starting."}), 503

    response = send_from_directory(HLS_DIRECTORY, HLS_PLAYLIST.name, mimetype="application/vnd.apple.mpegurl")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), threaded=True)

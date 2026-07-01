import json
import logging
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Literal

from flask import Flask, Response, jsonify, request, send_file, send_from_directory

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [CourtVision] %(message)s",
)
logger = logging.getLogger("courtvision")

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
RECORDING_WATCHDOG_SECONDS = float(os.environ.get("COURTVISION_RECORDING_WATCHDOG_SECONDS", "2"))
RECORDING_FILE_STABLE_INTERVAL_SECONDS = float(
    os.environ.get("COURTVISION_RECORDING_FILE_STABLE_INTERVAL", "0.5")
)
RECORDING_FILE_STABLE_CHECKS = int(os.environ.get("COURTVISION_RECORDING_FILE_STABLE_CHECKS", "3"))
RECORDING_FILE_STABLE_TIMEOUT_SECONDS = float(
    os.environ.get("COURTVISION_RECORDING_FILE_STABLE_TIMEOUT", "15")
)
MIN_MP4_SIZE_WITHOUT_FFPROBE = int(os.environ.get("COURTVISION_MIN_MP4_SIZE_WITHOUT_FFPROBE", str(100 * 1024)))
RECORDING_MIN_TMP_FREE_BYTES = int(
    os.environ.get("COURTVISION_RECORDING_MIN_TMP_FREE_BYTES", str(200 * 1024 * 1024))
)
RECORDING_MAX_DURATION_SECONDS = float(
    os.environ.get("COURTVISION_RECORDING_MAX_DURATION_SECONDS", "600")
)
RECORDING_DURATION_TOLERANCE_SECONDS = float(
    os.environ.get("COURTVISION_RECORDING_DURATION_TOLERANCE_SECONDS", "3.0")
)
ACTIVE_RECORDING_STATE_FILE = Path(
    os.environ.get("COURTVISION_ACTIVE_RECORDING_STATE_FILE", "/tmp/courtvision-active-recording.json")
)
RECORDING_PROCESS_REGISTRY_FILE = Path(
    os.environ.get("COURTVISION_RECORDING_PROCESS_REGISTRY_FILE", "/tmp/courtvision-recording-process-registry.json")
)
PROCESS_TERMINATION_TIMEOUT_SECONDS = float(
    os.environ.get("COURTVISION_PROCESS_TERMINATION_TIMEOUT_SECONDS", "5")
)

CAMERA_CONFLICT_MESSAGE = "Raspberry Pi camera is busy."
CAMERA_NOT_DETECTED_MESSAGE = "Raspberry Pi camera not detected."
CAMERA_INITIALIZATION_FAILED_MESSAGE = "Failed to initialize Raspberry Pi camera."
RECORDING_PROCESSES_RUNNING_MESSAGE = (
    "Recording processes are already running on the Raspberry Pi."
)

last_parameters: dict[str, Any] | None = None
ball_machine_power: Literal["on", "off"] = "off"


class CameraState(str, Enum):
    IDLE = "IDLE"
    PREVIEW = "PREVIEW"
    RECORDING = "RECORDING"


class CameraConflictError(RuntimeError):
    pass


class CameraNotDetectedError(RuntimeError):
    pass


class CameraBusyError(RuntimeError):
    pass


class CameraInitializationError(RuntimeError):
    pass


class CameraStateError(RuntimeError):
    pass


def get_current_ip_address() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        except OSError:
            return ""


def is_ignorable_deploy_artifact_dir(path: Path) -> bool:
    name = path.name
    return (
        name.startswith("backend.staging-")
        or name.startswith("courtvision-backup-")
        or name.startswith("backup-")
    )


def warn_ignorable_deploy_artifacts(runtime_backend_dir: Path) -> None:
    courtvision_root = runtime_backend_dir.parent
    if not courtvision_root.is_dir():
        return

    try:
        children = list(courtvision_root.iterdir())
    except OSError:
        return

    for child in children:
        if child.is_dir() and is_ignorable_deploy_artifact_dir(child):
            logger.warning("Found stale staging directory, ignoring: %s", child)


def find_conflicting_flask_process(runtime_app: Path) -> Path | None:
    runtime_app = runtime_app.resolve()
    our_pid = os.getpid()
    proc_root = Path("/proc")

    if not proc_root.is_dir():
        return None

    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue

        pid = int(entry.name)
        if pid == our_pid:
            continue

        try:
            cmdline = (entry / "cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", errors="replace")
        except OSError:
            continue

        if "app.py" not in cmdline:
            continue

        try:
            cwd = (entry / "cwd").resolve()
        except OSError:
            continue

        other_app = cwd / "app.py"
        if other_app.is_file() and other_app.resolve() != runtime_app:
            return other_app.resolve()

    return None


def validate_single_backend() -> None:
    backend_app = Path(__file__).resolve()
    runtime_backend_dir = backend_app.parent

    if not backend_app.is_file():
        raise SystemExit(
            f"Invalid CourtVision backend layout: missing runtime app at {backend_app}."
        )

    forbidden_names = {"camera" + "_server.py"}
    for path in runtime_backend_dir.iterdir():
        if path.is_file() and path.name in forbidden_names:
            raise SystemExit(
                f"Invalid CourtVision backend layout: found forbidden file {path}. "
                "Use only backend/app.py."
            )

    duplicate_runtime_apps = [
        path.resolve()
        for path in runtime_backend_dir.rglob("app.py")
        if path.is_file() and path.resolve() != backend_app
    ]
    runtime_layout_invalid = bool(duplicate_runtime_apps)

    warn_ignorable_deploy_artifacts(runtime_backend_dir)

    conflicting_app = find_conflicting_flask_process(backend_app)
    if conflicting_app is not None:
        logger.warning(
            "Found another running CourtVision backend process using %s",
            conflicting_app,
        )

    if runtime_layout_invalid:
        for duplicate_app in duplicate_runtime_apps:
            logger.warning("Ignoring duplicate app.py in runtime tree: %s", duplicate_app)

    if runtime_layout_invalid and conflicting_app is not None:
        joined = ", ".join(str(path) for path in duplicate_runtime_apps)
        raise SystemExit(
            "Invalid CourtVision backend layout: multiple Flask apps detected "
            f"({joined}) with conflicting running process ({conflicting_app})."
        )


class CameraStateManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = CameraState.IDLE

    @property
    def state(self) -> CameraState:
        with self._lock:
            return self._state

    def require_state(self, *allowed_states: CameraState) -> None:
        with self._lock:
            if self._state not in allowed_states:
                raise CameraStateError(
                    f"Invalid camera transition from {self._state.value}. "
                    f"Expected one of: {', '.join(state.value for state in allowed_states)}."
                )

    def begin_preview(self) -> None:
        with self._lock:
            if self._state == CameraState.PREVIEW:
                return

            if self._state != CameraState.IDLE:
                raise CameraConflictError(CAMERA_CONFLICT_MESSAGE)

            self._state = CameraState.PREVIEW

    def end_preview(self) -> None:
        with self._lock:
            if self._state == CameraState.IDLE:
                return

            if self._state != CameraState.PREVIEW:
                raise CameraStateError(
                    f"Cannot stop preview while camera state is {self._state.value}."
                )

            self._state = CameraState.IDLE

    def begin_recording(self) -> None:
        with self._lock:
            if self._state != CameraState.IDLE:
                raise CameraConflictError(CAMERA_CONFLICT_MESSAGE)

            self._state = CameraState.RECORDING

    def end_recording(self) -> None:
        with self._lock:
            if self._state != CameraState.RECORDING:
                raise CameraStateError(
                    f"Cannot stop recording while camera state is {self._state.value}."
                )

            self._state = CameraState.IDLE

    def force_idle(self) -> None:
        with self._lock:
            self._state = CameraState.IDLE


camera_state_manager = CameraStateManager()


def validate_system_commands(*commands: str) -> None:
    for command in commands:
        if shutil.which(command) is None:
            raise RuntimeError(f"{command} is not installed or not available on PATH.")


def verify_camera_available() -> None:
    validate_system_commands("rpicam-vid")

    camera_list_commands = [
        ["rpicam-hello", "--list-cameras"],
        ["rpicam-vid", "--list-cameras"],
    ]

    for command in camera_list_commands:
        if shutil.which(command[0]) is None:
            continue

        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as error:
            logger.warning(
                "Unable to query Raspberry Pi camera availability using %s: %s",
                command[0],
                error,
            )
            continue

        output = f"{completed.stdout}\n{completed.stderr}".strip()
        lowered = output.lower()

        if completed.returncode != 0:
            continue

        if "no cameras available" in lowered:
            raise CameraNotDetectedError(CAMERA_NOT_DETECTED_MESSAGE)

        if "available cameras" in lowered or "imx" in lowered or "/base/" in lowered:
            logger.info("Camera detected via %s: %s", command[0], output.replace("\n", " | "))
            return

        if len(output) > 0:
            logger.info("Camera detected via %s.", command[0])
            return

    raise CameraNotDetectedError(CAMERA_NOT_DETECTED_MESSAGE)


def verify_tmp_storage_available() -> int:
    usage = shutil.disk_usage("/tmp")
    free_bytes = usage.free
    logger.info("Free storage in /tmp: %d bytes (required minimum %d bytes)", free_bytes, RECORDING_MIN_TMP_FREE_BYTES)

    if free_bytes < RECORDING_MIN_TMP_FREE_BYTES:
        raise RuntimeError("Insufficient storage on Raspberry Pi.")

    return free_bytes


def wait_for_file_stable(mp4_path: Path, timeout_seconds: float = RECORDING_FILE_STABLE_TIMEOUT_SECONDS) -> int:
    deadline = time.monotonic() + timeout_seconds
    stable_count = 0
    last_size = -1

    while time.monotonic() < deadline:
        if not mp4_path.exists():
            time.sleep(RECORDING_FILE_STABLE_INTERVAL_SECONDS)
            continue

        size = mp4_path.stat().st_size
        if size == last_size:
            stable_count += 1
            if stable_count >= RECORDING_FILE_STABLE_CHECKS:
                logger.info(
                    "Recording file stabilized path=%s size=%d bytes",
                    mp4_path,
                    size,
                )
                return size
        else:
            stable_count = 0
            last_size = size

        time.sleep(RECORDING_FILE_STABLE_INTERVAL_SECONDS)

    raise RuntimeError(
        f"Recording file did not finish writing to disk at {mp4_path} within {timeout_seconds} seconds."
    )


def persist_active_recording_state(payload: dict[str, Any]) -> None:
    persist_recording_process_registry(payload)


def clear_active_recording_state() -> None:
    ACTIVE_RECORDING_STATE_FILE.unlink(missing_ok=True)


def read_recording_process_registry() -> dict[str, Any] | None:
    for registry_path in (RECORDING_PROCESS_REGISTRY_FILE, ACTIVE_RECORDING_STATE_FILE):
        if not registry_path.exists():
            continue

        try:
            payload = json.loads(registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("Unable to read recording process registry at %s", registry_path)
            registry_path.unlink(missing_ok=True)
            continue

        if isinstance(payload, dict):
            return payload

    return None


def persist_recording_process_registry(payload: dict[str, Any]) -> None:
    serialized = json.dumps(payload)
    RECORDING_PROCESS_REGISTRY_FILE.write_text(serialized, encoding="utf-8")
    ACTIVE_RECORDING_STATE_FILE.write_text(serialized, encoding="utf-8")


def clear_recording_process_registry() -> None:
    RECORDING_PROCESS_REGISTRY_FILE.unlink(missing_ok=True)
    clear_active_recording_state()


def list_proc_pids() -> list[int]:
    proc_root = Path("/proc")
    if not proc_root.is_dir():
        return []

    pids: list[int] = []
    for entry in proc_root.iterdir():
        if entry.name.isdigit():
            pids.append(int(entry.name))
    return pids


def read_proc_cmdline(pid: int) -> str:
    try:
        return (
            Path(f"/proc/{pid}/cmdline")
            .read_bytes()
            .replace(b"\x00", b" ")
            .decode("utf-8", errors="replace")
            .strip()
        )
    except OSError:
        return ""


def pid_is_alive(pid: int | None) -> bool:
    if pid is None or pid <= 0:
        return False

    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False

    return True


def kill_pid(pid: int, label: str, timeout_seconds: float = PROCESS_TERMINATION_TIMEOUT_SECONDS) -> bool:
    if not pid_is_alive(pid):
        logger.info("Process already terminated %s pid=%s", label, pid)
        return True

    try:
        os.kill(pid, signal.SIGTERM)
        logger.warning("Sent SIGTERM to %s pid=%s", label, pid)
    except ProcessLookupError:
        return True
    except OSError as error:
        logger.warning("Unable to terminate %s pid=%s: %s", label, pid, error)
        return not pid_is_alive(pid)

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if not pid_is_alive(pid):
            logger.info("Confirmed %s terminated pid=%s", label, pid)
            return True
        time.sleep(0.1)

    if not pid_is_alive(pid):
        return True

    try:
        os.kill(pid, signal.SIGKILL)
        logger.warning("Sent SIGKILL to %s pid=%s", label, pid)
    except ProcessLookupError:
        return True
    except OSError as error:
        logger.warning("Unable to SIGKILL %s pid=%s: %s", label, pid, error)
        return not pid_is_alive(pid)

    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if not pid_is_alive(pid):
            logger.info("Confirmed %s terminated after SIGKILL pid=%s", label, pid)
            return True
        time.sleep(0.1)

    return not pid_is_alive(pid)


def confirm_pid_terminated(pid: int | None, label: str) -> None:
    if pid is None:
        return

    if kill_pid(pid, label):
        return

    raise RuntimeError(f"Failed to terminate recording process {label} pid={pid}.")


def find_rpicam_vid_pids() -> list[int]:
    pids: list[int] = []
    for pid in list_proc_pids():
        cmdline = read_proc_cmdline(pid)
        if "rpicam-vid" in cmdline:
            pids.append(pid)
    return sorted(set(pids))


def find_recording_ffmpeg_pids() -> list[int]:
    recording_dir = str(RECORDING_DIR)
    pids: list[int] = []
    for pid in list_proc_pids():
        cmdline = read_proc_cmdline(pid)
        if "ffmpeg" in cmdline and recording_dir in cmdline:
            pids.append(pid)
    return sorted(set(pids))


def cleanup_registry_stale_pids() -> None:
    payload = read_recording_process_registry()
    if payload is None:
        return

    for pid_key, label in (("cameraPid", "rpicam-vid"), ("ffmpegPid", "ffmpeg")):
        pid = payload.get(pid_key)
        if isinstance(pid, int) and pid_is_alive(pid):
            kill_pid(pid, label)

    clear_recording_process_registry()


def cleanup_recording_processes_on_startup() -> None:
    logger.info("Cleaning up stale recording processes on backend startup")

    cleanup_registry_stale_pids()

    for pid in find_rpicam_vid_pids():
        kill_pid(pid, "rpicam-vid")

    for pid in find_recording_ffmpeg_pids():
        kill_pid(pid, "ffmpeg")

    clear_recording_process_registry()

    remaining_rpicam = find_rpicam_vid_pids()
    remaining_ffmpeg = find_recording_ffmpeg_pids()
    if remaining_rpicam or remaining_ffmpeg:
        logger.warning(
            "Recording process cleanup incomplete rpicam-vid=%s ffmpeg=%s",
            remaining_rpicam,
            remaining_ffmpeg,
        )
    else:
        logger.info("Recording process cleanup complete: 0 rpicam-vid, 0 ffmpeg")


def verify_recording_processes_not_running() -> None:
    rpicam_pids = find_rpicam_vid_pids()
    ffmpeg_pids = find_recording_ffmpeg_pids()

    if rpicam_pids or ffmpeg_pids:
        raise CameraBusyError(
            f"{RECORDING_PROCESSES_RUNNING_MESSAGE} "
            f"(rpicam-vid={rpicam_pids}, ffmpeg={ffmpeg_pids})."
        )


def confirm_recording_pipeline_stopped(
    camera_pid: int | None,
    ffmpeg_pid: int | None,
) -> None:
    if pid_is_alive(camera_pid):
        if not kill_pid(int(camera_pid), "rpicam-vid"):
            raise RuntimeError(f"Failed to terminate rpicam-vid pid={camera_pid}.")

    if pid_is_alive(ffmpeg_pid):
        if not kill_pid(int(ffmpeg_pid), "ffmpeg"):
            raise RuntimeError(f"Failed to terminate ffmpeg pid={ffmpeg_pid}.")

    remaining_ffmpeg = find_recording_ffmpeg_pids()
    if remaining_ffmpeg:
        for pid in remaining_ffmpeg:
            kill_pid(pid, "ffmpeg")
        remaining_ffmpeg = find_recording_ffmpeg_pids()
        if remaining_ffmpeg:
            raise RuntimeError(
                "Recording ffmpeg processes still running after stop: "
                f"{remaining_ffmpeg}."
            )

    logger.info(
        "Recording pipeline stopped cleanly rpicam-vid=%s ffmpeg=%s",
        camera_pid,
        ffmpeg_pid,
    )


def build_debug_process_payload() -> dict[str, Any]:
    rpicam_pids = find_rpicam_vid_pids()
    ffmpeg_pids = find_recording_ffmpeg_pids()
    registry = read_recording_process_registry()
    camera_state = camera_state_manager.state.value
    recording_active = recording_manager.is_recording
    managed_processes_running = recording_manager.processes_running()

    expected_process_count = 2 if recording_active and managed_processes_running else 0
    actual_process_count = len(rpicam_pids) + len(ffmpeg_pids)

    if recording_active:
        recording_state_consistent = (
            camera_state == CameraState.RECORDING.value
            and managed_processes_running
            and len(rpicam_pids) == 1
            and len(ffmpeg_pids) == 1
        )
    else:
        recording_state_consistent = (
            camera_state != CameraState.RECORDING.value
            and not managed_processes_running
            and len(ffmpeg_pids) == 0
        )

    return {
        "success": True,
        "rpicamVidPids": rpicam_pids,
        "ffmpegPids": ffmpeg_pids,
        "processRegistry": registry,
        "recordingActive": recording_active,
        "cameraState": camera_state,
        "managedProcessesRunning": managed_processes_running,
        "expectedProcessCount": expected_process_count,
        "actualProcessCount": actual_process_count,
        "recordingStateConsistent": recording_state_consistent,
    }


def terminate_orphan_recording_processes() -> None:
    payload = read_recording_process_registry()
    if payload is None:
        return

    for pid_key, label in (("cameraPid", "rpicam-vid"), ("ffmpegPid", "ffmpeg")):
        pid = payload.get(pid_key)
        if not isinstance(pid, int):
            continue

        if kill_pid(pid, label):
            logger.warning("Terminated orphan recording process %s=%s", pid_key, pid)
        else:
            logger.warning("Unable to terminate orphan recording process %s=%s", pid_key, pid)

    clear_recording_process_registry()


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


def validate_mp4(mp4_path: Path) -> dict[str, Any]:
    if not mp4_path.exists():
        raise RuntimeError(f"Recording file does not exist at {mp4_path}.")

    file_size = mp4_path.stat().st_size
    if file_size <= 0:
        raise RuntimeError(f"Recording file at {mp4_path} has zero size.")

    result: dict[str, Any] = {
        "fileExists": True,
        "fileSize": file_size,
        "ffprobeAvailable": shutil.which("ffprobe") is not None,
        "duration": None,
        "validVideoStream": None,
        "videoStreamCount": None,
        "passed": True,
    }

    if not result["ffprobeAvailable"]:
        if file_size < MIN_MP4_SIZE_WITHOUT_FFPROBE:
            raise RuntimeError(
                "Recording file is too small for validation without ffprobe: "
                f"{file_size} bytes (minimum {MIN_MP4_SIZE_WITHOUT_FFPROBE} bytes)."
            )

        result["warning"] = (
            "ffprobe is not installed; validated file existence and minimum size only."
        )
        logger.warning(
            "ffprobe unavailable; MP4 passed size-only validation for %s (%d bytes)",
            mp4_path,
            file_size,
        )
        return result

    duration_command = [
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
    stream_command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(mp4_path),
    ]
    video_stream_count_command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(mp4_path),
    ]

    try:
        duration_result = subprocess.run(duration_command, capture_output=True, text=True, check=False)
        stream_result = subprocess.run(stream_command, capture_output=True, text=True, check=False)
        video_stream_count_result = subprocess.run(
            video_stream_count_command, capture_output=True, text=True, check=False
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"Recording MP4 ffprobe validation failed: {error}") from error

    if duration_result.returncode != 0:
        raise RuntimeError(
            "Recording MP4 failed ffprobe duration validation: "
            f"{duration_result.stderr.strip() or 'unknown ffprobe error'}"
        )

    if stream_result.returncode != 0 or stream_result.stdout.strip() != "video":
        raise RuntimeError(
            "Recording MP4 does not contain a valid H.264 video stream for mobile playback."
        )

    video_streams = [
        line.strip()
        for line in video_stream_count_result.stdout.splitlines()
        if line.strip() == "video"
    ]
    video_stream_count = len(video_streams)
    result["videoStreamCount"] = video_stream_count

    if video_stream_count_result.returncode != 0:
        raise RuntimeError(
            "Recording MP4 failed ffprobe video stream count validation: "
            f"{video_stream_count_result.stderr.strip() or 'unknown ffprobe error'}"
        )

    if video_stream_count != 1:
        raise RuntimeError(
            f"Recording MP4 must contain exactly one video stream, found {video_stream_count}."
        )

    try:
        duration = float(duration_result.stdout.strip())
    except ValueError as error:
        raise RuntimeError("Recording MP4 does not contain a parseable duration.") from error

    if duration <= 0:
        raise RuntimeError("Recording MP4 duration must be greater than zero.")

    result["duration"] = duration
    result["validVideoStream"] = True
    logger.info(
        "ffprobe validation passed for %s (duration=%.3fs, size=%d bytes, video_streams=%d)",
        mp4_path,
        duration,
        file_size,
        video_stream_count,
    )
    return result


def verify_recording_duration(recording_duration_seconds: float, validation: dict[str, Any]) -> None:
    if not validation.get("ffprobeAvailable"):
        return

    video_duration = validation.get("duration")
    if not isinstance(video_duration, (int, float)) or video_duration <= 0:
        raise RuntimeError("Recording MP4 duration must be greater than zero.")

    delta = abs(recording_duration_seconds - float(video_duration))
    if delta > RECORDING_DURATION_TOLERANCE_SECONDS:
        raise RuntimeError(
            "Recording duration mismatch: "
            f"recorded {recording_duration_seconds:.2f}s but MP4 duration is {float(video_duration):.2f}s "
            f"(tolerance {RECORDING_DURATION_TOLERANCE_SECONDS:.1f}s)."
        )


def build_recording_filename() -> tuple[str, Path]:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    recording_id = uuid.uuid4().hex[:8]
    filename = f"courtvision-{timestamp}-{recording_id}.mp4"
    return filename, RECORDING_DIR / filename


class DirectRecordingManager:
    """Recording-only pipeline: rpicam-vid -> ffmpeg -> MP4 on disk."""

    def __init__(self, state_manager: CameraStateManager) -> None:
        self._state_manager = state_manager
        self._lock = threading.Lock()
        self._active_recording: dict[str, Any] | None = None
        self._camera_process: subprocess.Popen[bytes] | None = None
        self._ffmpeg_process: subprocess.Popen[bytes] | None = None
        self._process_errors: list[str] = []
        self._stopping = False
        self._timeout_timer: threading.Timer | None = None
        self._finalized_recordings: dict[str, dict[str, Any]] = {}

    @property
    def is_recording(self) -> bool:
        with self._lock:
            return self._active_recording is not None

    def get_active_recording(self) -> dict[str, Any] | None:
        with self._lock:
            if self._active_recording is None:
                return None

            return {
                "recordingId": self._active_recording["recording_id"],
                "filename": self._active_recording["filename"],
                "startedAt": self._active_recording.get("started_at"),
            }

    def get_finalized_recording(self, recording_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._finalized_recordings.get(recording_id)

    def clear_finalized_recording(self, recording_id: str) -> None:
        with self._lock:
            self._finalized_recordings.pop(recording_id, None)

    def recover_orphans(self) -> None:
        cleanup_recording_processes_on_startup()
        terminate_orphan_recording_processes()

        with self._lock:
            self._active_recording = None
            self._camera_process = None
            self._ffmpeg_process = None
            self._stopping = False

            if self._state_manager.state == CameraState.RECORDING:
                logger.warning("Recovering orphaned recording state back to IDLE.")
                self._state_manager.force_idle()

    def processes_running(self) -> bool:
        with self._lock:
            return self._processes_running_unlocked()

    def _processes_running_unlocked(self) -> bool:
        return (
            self._camera_process is not None
            and self._camera_process.poll() is None
            and self._ffmpeg_process is not None
            and self._ffmpeg_process.poll() is None
        )

    def force_abort(self) -> None:
        with self._lock:
            self._active_recording = None
            self._stopping = False

        self._cancel_timeout_timer()
        self._cleanup_processes()
        clear_recording_process_registry()

        if self._state_manager.state == CameraState.RECORDING:
            self._state_manager.force_idle()

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self._active_recording is not None:
                raise CameraBusyError(CAMERA_CONFLICT_MESSAGE)

            if self._stopping:
                raise RuntimeError("A recording is still finalizing. Wait before starting again.")

        verify_camera_not_busy_for_recording()
        verify_recording_processes_not_running()
        verify_camera_available()
        free_storage_bytes = verify_tmp_storage_available()
        validate_system_commands("rpicam-vid", "ffmpeg")

        with self._lock:
            if self._active_recording is not None:
                raise CameraBusyError(CAMERA_CONFLICT_MESSAGE)

            try:
                self._state_manager.begin_recording()
            except CameraConflictError as error:
                raise CameraBusyError(CAMERA_CONFLICT_MESSAGE) from error

            filename, output_path = build_recording_filename()
            recording_id = filename.removesuffix(".mp4")
            started_at = time.time()
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
                    raise CameraInitializationError(CAMERA_INITIALIZATION_FAILED_MESSAGE)

                time.sleep(0.25)
                if self._camera_process.poll() is not None:
                    raise CameraInitializationError(CAMERA_INITIALIZATION_FAILED_MESSAGE)

                self._ffmpeg_process = subprocess.Popen(
                    ffmpeg_command,
                    stdin=self._camera_process.stdout,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
                capture_stderr("ffmpeg", self._ffmpeg_process, self._process_errors)
                self._camera_process.stdout.close()

                time.sleep(RECORDING_WATCHDOG_SECONDS)
                self._raise_if_process_failed()

                self._active_recording = {
                    "recording_id": recording_id,
                    "filename": filename,
                    "output_path": output_path,
                    "camera_pid": self._camera_process.pid,
                    "ffmpeg_pid": self._ffmpeg_process.pid,
                    "started_at": started_at,
                }

                persist_active_recording_state(
                    {
                        "recordingId": recording_id,
                        "filename": filename,
                        "outputPath": str(output_path),
                        "cameraPid": self._camera_process.pid,
                        "ffmpegPid": self._ffmpeg_process.pid,
                        "startedAt": started_at,
                    }
                )

                self._schedule_timeout_timer(recording_id)

                logger.info(
                    "Recording started id=%s path=%s started_at=%s camera_pid=%s ffmpeg_pid=%s free_storage=%d",
                    recording_id,
                    output_path,
                    datetime.fromtimestamp(started_at, tz=timezone.utc).isoformat(),
                    self._camera_process.pid,
                    self._ffmpeg_process.pid,
                    free_storage_bytes,
                )

                return {
                    "recordingId": recording_id,
                    "filename": filename,
                    "outputPath": str(output_path),
                    "cameraPid": self._camera_process.pid,
                    "ffmpegPid": self._ffmpeg_process.pid,
                    "startedAt": started_at,
                }
            except CameraInitializationError:
                self._cancel_timeout_timer()
                self._cleanup_processes_unlocked(confirm_termination=True)
                clear_recording_process_registry()
                self._state_manager.end_recording()
                raise
            except Exception as error:
                self._cancel_timeout_timer()
                self._cleanup_processes_unlocked(confirm_termination=True)
                clear_recording_process_registry()
                self._state_manager.end_recording()
                logger.error("Failed to initialize Raspberry Pi camera: %s", error)
                raise CameraInitializationError(CAMERA_INITIALIZATION_FAILED_MESSAGE) from error

    def stop(self, recording_id: str, *, timed_out: bool = False) -> tuple[Path, dict[str, Any]]:
        cached = self.get_finalized_recording(recording_id)
        if cached is not None:
            logger.info("Returning cached finalized recording id=%s", recording_id)
            return Path(cached["outputPath"]), cached["details"]

        with self._lock:
            if self._stopping:
                raise RuntimeError("Recording stop is already in progress.")

            if self._active_recording is None:
                raise RuntimeError("No recording is in progress.")

            if self._active_recording["recording_id"] != recording_id:
                raise RuntimeError("Recording ID does not match the active recording.")

            output_path: Path = self._active_recording["output_path"]
            filename: str = self._active_recording["filename"]
            started_at: float = self._active_recording.get("started_at", time.time())
            self._stopping = True
            self._active_recording = None

        logger.info("Recording stop requested id=%s path=%s timed_out=%s", recording_id, output_path, timed_out)

        camera_pid = self._camera_process.pid if self._camera_process is not None else None
        ffmpeg_pid = self._ffmpeg_process.pid if self._ffmpeg_process is not None else None

        try:
            self._cancel_timeout_timer()
            terminate_process(self._camera_process)
            self._camera_process = None
            confirm_pid_terminated(camera_pid, "rpicam-vid")

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
                    confirm_pid_terminated(ffmpeg_pid, "ffmpeg")
                    self._state_manager.end_recording()
                    raise RuntimeError(
                        "Recording finalization timed out. "
                        f"{self._get_process_diagnostics()}"
                    )

                if self._ffmpeg_process.poll() not in (0, None):
                    diagnostics = self._get_process_diagnostics()
                    self._ffmpeg_process = None
                    confirm_pid_terminated(ffmpeg_pid, "ffmpeg")
                    self._state_manager.end_recording()
                    raise RuntimeError(
                        "ffmpeg failed while finalizing the recording. " + diagnostics
                    )

            self._ffmpeg_process = None
            confirm_recording_pipeline_stopped(camera_pid, ffmpeg_pid)
            self._state_manager.end_recording()

            stable_size = wait_for_file_stable(output_path)
            validation = validate_mp4(output_path)
            file_size = output_path.stat().st_size
            recording_duration_seconds = max(0.0, time.time() - started_at)
            verify_recording_duration(recording_duration_seconds, validation)

            if file_size != stable_size:
                logger.warning(
                    "Recording file size changed after stabilization id=%s size=%d stable=%d",
                    recording_id,
                    file_size,
                    stable_size,
                )

            clear_recording_process_registry()

            details: dict[str, Any] = {
                "filename": filename,
                "fileSize": file_size,
                "recordingDurationSeconds": recording_duration_seconds,
                "validation": validation,
                "outputPath": str(output_path),
            }

            if timed_out and RECORDING_MAX_DURATION_SECONDS > 0:
                details["timedOut"] = True
                details["message"] = (
                    f"Recording stopped automatically after reaching maximum duration of "
                    f"{int(RECORDING_MAX_DURATION_SECONDS)} seconds."
                )
                with self._lock:
                    self._finalized_recordings[recording_id] = {
                        "outputPath": str(output_path),
                        "details": details,
                    }

            logger.info(
                "Recording stopped id=%s path=%s duration=%.2fs final_size=%d bytes validation=%s timed_out=%s",
                recording_id,
                output_path,
                recording_duration_seconds,
                file_size,
                validation,
                timed_out,
            )
            return output_path, details
        except Exception:
            self._cleanup_processes_unlocked(confirm_termination=True)
            clear_recording_process_registry()
            raise
        finally:
            with self._lock:
                self._stopping = False

    def _schedule_timeout_timer(self, recording_id: str) -> None:
        self._cancel_timeout_timer()

        if RECORDING_MAX_DURATION_SECONDS <= 0:
            return

        def on_timeout() -> None:
            try:
                logger.warning(
                    "Recording maximum duration exceeded id=%s limit=%.0fs",
                    recording_id,
                    RECORDING_MAX_DURATION_SECONDS,
                )
                self.stop(recording_id, timed_out=True)
            except Exception as error:
                logger.error(
                    "Failed to auto-stop recording after timeout id=%s: %s",
                    recording_id,
                    error,
                )
                self.force_abort()

        self._timeout_timer = threading.Timer(RECORDING_MAX_DURATION_SECONDS, on_timeout)
        self._timeout_timer.daemon = True
        self._timeout_timer.start()

    def _cancel_timeout_timer(self) -> None:
        if self._timeout_timer is not None:
            self._timeout_timer.cancel()
            self._timeout_timer = None

    def _cleanup_processes(self) -> None:
        with self._lock:
            self._cleanup_processes_unlocked()

    def _cleanup_processes_unlocked(self, *, confirm_termination: bool = False) -> None:
        camera_pid = self._camera_process.pid if self._camera_process is not None else None
        ffmpeg_pid = self._ffmpeg_process.pid if self._ffmpeg_process is not None else None

        terminate_process(self._ffmpeg_process)
        terminate_process(self._camera_process)
        self._ffmpeg_process = None
        self._camera_process = None

        if confirm_termination:
            confirm_pid_terminated(ffmpeg_pid, "ffmpeg")
            confirm_pid_terminated(camera_pid, "rpicam-vid")

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
            self._cleanup_processes_unlocked(confirm_termination=True)
            logger.error(
                "Recording pipeline failed to start: %s %s",
                " ".join(failed_processes),
                diagnostics,
            )
            raise CameraInitializationError(CAMERA_INITIALIZATION_FAILED_MESSAGE)

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

    def __init__(self, state_manager: CameraStateManager) -> None:
        self._state_manager = state_manager
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
        self._state_manager.begin_preview()

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
            self._cleanup_processes()
            if self._state_manager.state == CameraState.PREVIEW:
                self._state_manager.end_preview()
            raise

    def _stop_locked(self) -> None:
        self._cleanup_processes()
        self._prepare_hls_directory()

        if self._state_manager.state == CameraState.PREVIEW:
            self._state_manager.end_preview()

    def _cleanup_processes(self) -> None:
        terminate_process(self._ffmpeg_process)
        terminate_process(self._camera_process)
        self._ffmpeg_process = None
        self._camera_process = None

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
            self._cleanup_processes()
            if self._state_manager.state == CameraState.PREVIEW:
                self._state_manager.end_preview()
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


recording_manager = DirectRecordingManager(camera_state_manager)
preview_manager = HlsPreviewManager(camera_state_manager)
recording_manager.recover_orphans()


def verify_camera_not_busy_for_recording() -> None:
    if recording_manager.is_recording:
        raise CameraBusyError(CAMERA_CONFLICT_MESSAGE)

    if camera_state_manager.state == CameraState.RECORDING:
        raise CameraBusyError(CAMERA_CONFLICT_MESSAGE)


def prepare_recording_camera() -> None:
    if preview_manager.enabled:
        logger.info("Stopping camera preview before recording starts.")
        preview_manager.set_enabled(False)


def delete_recording_file(filename: str) -> None:
    if "/" in filename or not filename.endswith(".mp4"):
        raise ValueError("Invalid recording filename.")

    recording_path = RECORDING_DIR / filename

    if not recording_path.exists():
        raise FileNotFoundError("Recording was not found.")

    recording_path.unlink(missing_ok=True)


def camera_conflict_response() -> tuple[Response, int]:
    return jsonify({"success": False, "message": CAMERA_CONFLICT_MESSAGE}), 409


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
    camera_state = camera_state_manager.state.value
    state_consistent = (
        (camera_state == CameraState.IDLE.value and not preview_manager.enabled and not recording_manager.is_recording)
        or (camera_state == CameraState.PREVIEW.value and preview_manager.enabled and not recording_manager.is_recording)
        or (camera_state == CameraState.RECORDING.value and recording_manager.is_recording and not preview_manager.enabled)
    )

    payload: dict[str, Any] = {
        "status": "ok",
        "cameraState": camera_state,
        "cameraStateConsistent": state_consistent,
        "cameraPreviewEnabled": preview_manager.enabled,
        "recordingActive": recording_manager.is_recording,
        "ballMachinePower": ball_machine_power,
        "maxRecordingDurationSeconds": RECORDING_MAX_DURATION_SECONDS,
    }

    active_recording = recording_manager.get_active_recording()
    if active_recording is not None:
        payload["activeRecordingId"] = active_recording["recordingId"]
        payload["activeRecordingFilename"] = active_recording["filename"]
        payload["recordingStartedAt"] = active_recording.get("startedAt")

    return jsonify(payload)


@app.get("/debug/processes")
def debug_processes() -> Response:
    return jsonify(build_debug_process_payload())


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

    if enabled and camera_state_manager.state == CameraState.RECORDING:
        return camera_conflict_response()

    try:
        preview_manager.set_enabled(enabled)

        if enabled and not preview_manager.ensure_playlist_ready(CAMERA_START_TIMEOUT_SECONDS):
            diagnostics = preview_manager.get_diagnostics()
            preview_manager.set_enabled(False)
            return jsonify(
                {"success": False, "message": f"Camera preview did not start. {diagnostics}"}
            ), 500

        return jsonify({"success": True, "enabled": enabled, "cameraState": camera_state_manager.state.value})
    except CameraConflictError:
        preview_manager.set_enabled(False)
        return camera_conflict_response()
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
    if camera_state_manager.state != CameraState.PREVIEW:
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
    if camera_state_manager.state != CameraState.PREVIEW:
        return jsonify({"success": False, "message": "Camera preview is disabled."}), 409

    if not filename.startswith(HLS_SEGMENT_PREFIX) or not filename.endswith(".ts"):
        return jsonify({"success": False, "message": "Invalid HLS segment."}), 404

    response = send_from_directory(HLS_DIRECTORY, filename, mimetype="video/mp2t")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@app.post("/recording/start")
def recording_start() -> tuple[Response, int] | Response:
    try:
        prepare_recording_camera()
        started = recording_manager.start()

        if not recording_manager.processes_running():
            recording_manager.force_abort()
            return jsonify(
                {
                    "success": False,
                    "message": CAMERA_INITIALIZATION_FAILED_MESSAGE,
                }
            ), 500

        return jsonify(
            {
                "success": True,
                "recordingId": started["recordingId"],
                "filename": started["filename"],
                "processesRunning": True,
                "recordingActive": True,
                "cameraPid": started["cameraPid"],
                "ffmpegPid": started["ffmpegPid"],
                "cameraState": camera_state_manager.state.value,
            }
        )
    except CameraNotDetectedError as error:
        return jsonify({"success": False, "message": str(error)}), 500
    except (CameraBusyError, CameraConflictError):
        return jsonify({"success": False, "message": CAMERA_CONFLICT_MESSAGE}), 409
    except CameraInitializationError as error:
        return jsonify({"success": False, "message": str(error)}), 500
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
        mp4_path, details = recording_manager.stop(recording_id)
        filename = details["filename"]
        file_size = details["fileSize"]

        response_payload: dict[str, Any] = {
            "success": True,
            "recordingId": recording_id,
            "downloadUrl": f"/recordings/{filename}",
            "filename": filename,
            "fileSize": file_size,
            "recordingDurationSeconds": details["recordingDurationSeconds"],
            "validation": details["validation"],
            "cameraState": camera_state_manager.state.value,
        }

        if details.get("timedOut") is True:
            response_payload["timedOut"] = True

        if isinstance(details.get("message"), str):
            response_payload["message"] = details["message"]

        recording_manager.clear_finalized_recording(recording_id)
        return jsonify(response_payload)
    except RuntimeError as error:
        return jsonify({"success": False, "message": str(error)}), 500


@app.get("/recordings/<path:filename>")
def recording_download(filename: str) -> tuple[Response, int] | Response:
    if "/" in filename or not filename.endswith(".mp4"):
        return jsonify({"success": False, "message": "Invalid recording filename."}), 404

    recording_path = RECORDING_DIR / filename

    if not recording_path.exists():
        logger.warning("Download requested for missing recording: %s", filename)
        return jsonify({"success": False, "message": "Recording was not found on the Raspberry Pi."}), 404

    file_size = recording_path.stat().st_size
    if file_size <= 0:
        return jsonify({"success": False, "message": "Recording file exists but is empty."}), 500

    logger.info("Download started filename=%s path=%s size=%d", filename, recording_path, file_size)
    response = send_file(
        recording_path,
        as_attachment=True,
        download_name=filename,
        mimetype="video/mp4",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Length"] = str(file_size)

    def log_download_complete() -> None:
        logger.info("Download completed filename=%s download_size=%d", filename, file_size)

    response.call_on_close(log_download_complete)
    return response


@app.delete("/recordings/<path:filename>")
def recording_delete(filename: str) -> tuple[Response, int] | Response:
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict) or payload.get("downloaded") is not True:
        return jsonify(
            {
                "success": False,
                "message": "Recording deletion requires confirmed successful phone download.",
            }
        ), 400

    try:
        delete_recording_file(filename)
    except ValueError:
        return jsonify({"success": False, "message": "Invalid recording filename."}), 404
    except FileNotFoundError:
        return jsonify({"success": False, "message": "Recording was not found."}), 404

    logger.info("Cleanup result=success filename=%s", filename)
    return jsonify({"success": True, "message": "Recording deleted from Raspberry Pi."})


validate_single_backend()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), threaded=True)

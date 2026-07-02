import os
import shutil
import subprocess
import sys
import threading
from datetime import datetime

from flask import Flask, jsonify, send_file

RECORDINGS_DIR = "/tmp/picam-recordings/"
LOGS_DIR = "/tmp/picam-logs/"
PORT = 5000
CAMERA_CHECK_TIMEOUT = 3
DIAGNOSTICS_REFRESH_SECONDS = 30

# Pipeline: rpicam-vid (h264 stdout) -> ffmpeg -c copy -> MP4
# Do not use libx264 re-encode; camera already outputs compatible H.264.
FFMPEG_OUTPUT_ARGS = ["-c", "copy"]

app = Flask(__name__)

recording_lock = threading.Lock()
monitor_lock = threading.Lock()
diagnostics_lock = threading.Lock()
diagnostics_refresh_lock = threading.Lock()

state = {
    "recording": False,
    "recordingFailed": False,
    "recordingError": None,
    "filename": None,
    "rpicam_proc": None,
    "ffmpeg_proc": None,
    "rpicam_log": None,
    "ffmpeg_log": None,
}
monitor_stop_event = None
monitor_thread = None

diagnostics = {
    "rpicamInstalled": False,
    "ffmpegInstalled": False,
    "recordingDirectoryWritable": False,
    "cameraAvailable": False,
    "lastUpdated": None,
}


def ensure_logs_dir():
    os.makedirs(LOGS_DIR, exist_ok=True)


def write_log(log_name, message):
    ensure_logs_dir()
    log_path = os.path.join(LOGS_DIR, log_name)
    timestamp = datetime.now().isoformat(timespec="seconds")
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(f"{timestamp} {message}\n")


def check_rpicam_installed():
    return shutil.which("rpicam-vid") is not None


def check_ffmpeg_installed():
    return shutil.which("ffmpeg") is not None


def check_recording_directory_writable():
    try:
        os.makedirs(RECORDINGS_DIR, exist_ok=True)
        test_file = os.path.join(RECORDINGS_DIR, ".write-test")
        with open(test_file, "w", encoding="utf-8") as handle:
            handle.write("ok")
        os.remove(test_file)
        return True
    except OSError:
        return False


def check_camera_available():
    if not check_rpicam_installed():
        return False

    try:
        result = subprocess.run(
            ["rpicam-vid", "--list-cameras"],
            capture_output=True,
            text=True,
            timeout=CAMERA_CHECK_TIMEOUT,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False

    if result.returncode != 0:
        return False

    output = f"{result.stdout}\n{result.stderr}"
    return "Available cameras" in output and "0 :" in output


def run_fast_checks():
    return {
        "rpicamInstalled": check_rpicam_installed(),
        "ffmpegInstalled": check_ffmpeg_installed(),
        "recordingDirectoryWritable": check_recording_directory_writable(),
    }


def get_cached_diagnostics():
    with diagnostics_lock:
        return dict(diagnostics)


def update_diagnostics(results):
    results["lastUpdated"] = datetime.now().isoformat(timespec="seconds")
    with diagnostics_lock:
        diagnostics.update(results)
    write_log(
        "diagnostics.log",
        (
            "diagnostics "
            f"rpicam={results['rpicamInstalled']} "
            f"ffmpeg={results['ffmpegInstalled']} "
            f"dir={results['recordingDirectoryWritable']} "
            f"camera={results['cameraAvailable']}"
        ),
    )


def refresh_diagnostics_blocking():
    results = run_fast_checks()
    results["cameraAvailable"] = False
    if (
        results["rpicamInstalled"]
        and results["ffmpegInstalled"]
        and results["recordingDirectoryWritable"]
    ):
        results["cameraAvailable"] = check_camera_available()
    update_diagnostics(results)
    return results


def refresh_diagnostics_background():
    with diagnostics_refresh_lock:
        if getattr(refresh_diagnostics_background, "running", False):
            return
        refresh_diagnostics_background.running = True

    def worker():
        try:
            refresh_diagnostics_blocking()
        finally:
            refresh_diagnostics_background.running = False

    threading.Thread(target=worker, daemon=True, name="diagnostics-refresh").start()


def maybe_refresh_diagnostics_background():
    cached = get_cached_diagnostics()
    last_updated = cached.get("lastUpdated")
    if last_updated is None:
        refresh_diagnostics_background()
        return

    try:
        updated_at = datetime.fromisoformat(last_updated)
    except ValueError:
        refresh_diagnostics_background()
        return

    age = (datetime.now() - updated_at).total_seconds()
    if age >= DIAGNOSTICS_REFRESH_SECONDS:
        refresh_diagnostics_background()


def log_startup_diagnostics(results):
    lines = [
        "PiCamRecorder startup diagnostics:",
        f"  pipeline: rpicam-vid -> ffmpeg {' '.join(FFMPEG_OUTPUT_ARGS)}",
        f"  rpicam-vid installed: {'yes' if results['rpicamInstalled'] else 'no'}",
        f"  ffmpeg installed: {'yes' if results['ffmpegInstalled'] else 'no'}",
        f"  recording directory writable: {'yes' if results['recordingDirectoryWritable'] else 'no'}",
        f"  camera detected: {'yes' if results['cameraAvailable'] else 'no'}",
    ]
    message = "\n".join(lines)
    print(message, file=sys.stderr)
    write_log("startup.log", message.replace("\n", " | "))


def get_health_payload():
    maybe_refresh_diagnostics_background()
    results = get_cached_diagnostics()
    return {
        "success": True,
        "cameraAvailable": results["cameraAvailable"],
        "rpicamInstalled": results["rpicamInstalled"],
        "ffmpegInstalled": results["ffmpegInstalled"],
        "recordingDirectoryWritable": results["recordingDirectoryWritable"],
    }


def get_status_payload():
    maybe_refresh_diagnostics_background()
    results = get_cached_diagnostics()
    with recording_lock:
        recording = state["recording"]
        recording_failed = state["recordingFailed"]
        recording_error = state["recordingError"]

    payload = {
        "success": True,
        "cameraAvailable": results["cameraAvailable"],
        "rpicamInstalled": results["rpicamInstalled"],
        "ffmpegInstalled": results["ffmpegInstalled"],
        "recordingDirectoryWritable": results["recordingDirectoryWritable"],
        "recording": recording,
        "recordingFailed": recording_failed,
    }
    if recording_failed and recording_error:
        payload["recordingError"] = recording_error
    return payload


def close_process_logs():
    with recording_lock:
        for key in ("rpicam_log", "ffmpeg_log"):
            handle = state.get(key)
            if handle and not handle.closed:
                handle.close()
            state[key] = None


def stop_recording_monitor():
    global monitor_stop_event, monitor_thread
    with monitor_lock:
        if monitor_stop_event:
            monitor_stop_event.set()
        if monitor_thread and monitor_thread.is_alive():
            monitor_thread.join(timeout=2)
        monitor_stop_event = None
        monitor_thread = None


def mark_recording_failed(reason="Recording failed"):
    with recording_lock:
        if not state["recording"]:
            return
        state["recording"] = False
        state["recordingFailed"] = True
        state["recordingError"] = reason
        state["rpicam_proc"] = None
        state["ffmpeg_proc"] = None
    close_process_logs()
    stop_recording_monitor()
    write_log("recording.log", f"failed {reason}")


def recording_monitor_loop(stop_event):
    while not stop_event.is_set():
        if stop_event.wait(1):
            return

        with recording_lock:
            if not state["recording"]:
                return
            rpicam_proc = state["rpicam_proc"]
            ffmpeg_proc = state["ffmpeg_proc"]

        if rpicam_proc is None or rpicam_proc.poll() is not None:
            code = None if rpicam_proc is None else rpicam_proc.poll()
            write_log("recording.log", f"rpicam-vid exited code={code}")
            mark_recording_failed()
            return
        if ffmpeg_proc is None or ffmpeg_proc.poll() is not None:
            code = None if ffmpeg_proc is None else ffmpeg_proc.poll()
            write_log("recording.log", f"ffmpeg exited code={code}")
            mark_recording_failed()
            return


def start_recording_monitor():
    global monitor_stop_event, monitor_thread
    with monitor_lock:
        stop_recording_monitor()
        monitor_stop_event = threading.Event()
        monitor_thread = threading.Thread(
            target=recording_monitor_loop,
            args=(monitor_stop_event,),
            daemon=True,
        )
        monitor_thread.start()


def recording_ready_message(results):
    if not results["rpicamInstalled"]:
        return "rpicam-vid is not installed"
    if not results["ffmpegInstalled"]:
        return "ffmpeg is not installed"
    if not results["recordingDirectoryWritable"]:
        return f"{RECORDINGS_DIR} is missing or not writable"
    if not results["cameraAvailable"]:
        return "No camera detected"
    return None


def generate_filename():
    now = datetime.now()
    return f"recording-{now.strftime('%Y%m%d')}-{now.strftime('%H%M%S')}.mp4"


def launch_recording_processes(filename):
    filepath = os.path.join(RECORDINGS_DIR, filename)

    rpicam_cmd = [
        "rpicam-vid",
        "-t",
        "0",
        "--width",
        "1280",
        "--height",
        "720",
        "--framerate",
        "30",
        "--codec",
        "h264",
        "--inline",
        "-n",
        "-o",
        "-",
    ]

    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "h264",
        "-i",
        "pipe:0",
        *FFMPEG_OUTPUT_ARGS,
        filepath,
    ]

    ensure_logs_dir()
    rpicam_log_path = os.path.join(LOGS_DIR, f"rpicam-{filename}.stderr.log")
    ffmpeg_log_path = os.path.join(LOGS_DIR, f"ffmpeg-{filename}.stderr.log")
    rpicam_log = open(rpicam_log_path, "w", encoding="utf-8")
    ffmpeg_log = open(ffmpeg_log_path, "w", encoding="utf-8")

    try:
        rpicam_proc = subprocess.Popen(
            rpicam_cmd,
            stdout=subprocess.PIPE,
            stderr=rpicam_log,
        )
        ffmpeg_proc = subprocess.Popen(
            ffmpeg_cmd,
            stdin=rpicam_proc.stdout,
            stderr=ffmpeg_log,
        )
        rpicam_proc.stdout.close()
    except OSError as exc:
        rpicam_log.close()
        ffmpeg_log.close()
        write_log("recording.log", f"start error {exc}")
        mark_recording_failed(str(exc))
        return

    with recording_lock:
        if not state["recording"] or state["filename"] != filename:
            rpicam_proc.terminate()
            ffmpeg_proc.terminate()
            rpicam_log.close()
            ffmpeg_log.close()
            return

        state["rpicam_proc"] = rpicam_proc
        state["ffmpeg_proc"] = ffmpeg_proc
        state["rpicam_log"] = rpicam_log
        state["ffmpeg_log"] = ffmpeg_log

    write_log(
        "recording.log",
        f"started {filename} pipeline=rpicam-vid|ffmpeg-{'-'.join(FFMPEG_OUTPUT_ARGS)}",
    )
    start_recording_monitor()


@app.route("/health")
def health():
    return jsonify(get_health_payload())


@app.route("/status")
def status():
    return jsonify(get_status_payload())


@app.route("/recording/start", methods=["POST"])
def start_recording():
    fast_results = run_fast_checks()
    fast_results["cameraAvailable"] = get_cached_diagnostics()["cameraAvailable"]
    ready_error = recording_ready_message(fast_results)
    if ready_error:
        write_log("recording.log", f"start rejected {ready_error}")
        return jsonify({"success": False, "error": ready_error}), 503

    with recording_lock:
        if state["recording"]:
            return jsonify({"success": False, "error": "Already recording"}), 409

        filename = generate_filename()
        state["recording"] = True
        state["recordingFailed"] = False
        state["recordingError"] = None
        state["filename"] = filename
        state["rpicam_proc"] = None
        state["ffmpeg_proc"] = None

    threading.Thread(
        target=launch_recording_processes,
        args=(filename,),
        daemon=True,
        name=f"recording-start-{filename}",
    ).start()

    refresh_diagnostics_background()

    return jsonify(
        {
            "success": True,
            "recording": True,
            "filename": filename,
        }
    )


@app.route("/recording/stop", methods=["POST"])
def stop_recording():
    with recording_lock:
        if not state["recording"]:
            error = state["recordingError"] or "Not recording"
            return jsonify({"success": False, "error": error}), 400

        filename = state["filename"]
        filepath = os.path.join(RECORDINGS_DIR, filename)
        rpicam_proc = state["rpicam_proc"]
        ffmpeg_proc = state["ffmpeg_proc"]

        state["recording"] = False
        state["recordingFailed"] = False
        state["recordingError"] = None
        state["rpicam_proc"] = None
        state["ffmpeg_proc"] = None
        state["filename"] = None

    stop_recording_monitor()

    if rpicam_proc and rpicam_proc.poll() is None:
        rpicam_proc.terminate()
        try:
            rpicam_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            rpicam_proc.kill()

    if ffmpeg_proc and ffmpeg_proc.poll() is None:
        try:
            ffmpeg_proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            ffmpeg_proc.kill()

    close_process_logs()

    if not os.path.exists(filepath):
        write_log("recording.log", f"stop missing file {filename}")
        return jsonify({"success": False, "error": "Recording file not found"}), 500

    file_size = os.path.getsize(filepath)
    if file_size == 0:
        write_log("recording.log", f"stop empty file {filename}")
        return jsonify({"success": False, "error": "Recording file is empty"}), 500

    write_log("recording.log", f"stopped {filename} size={file_size}")

    return jsonify(
        {
            "success": True,
            "recording": False,
            "filename": filename,
            "fileSize": file_size,
            "downloadUrl": f"/recordings/{filename}",
        }
    )


@app.route("/recordings/<filename>", methods=["GET"])
def get_recording(filename):
    safe_name = os.path.basename(filename)
    filepath = os.path.join(RECORDINGS_DIR, safe_name)

    if not os.path.exists(filepath):
        return jsonify({"success": False, "error": "File not found"}), 404

    file_size = os.path.getsize(filepath)
    if file_size == 0:
        return jsonify({"success": False, "error": "File is empty"}), 400

    write_log("downloads.log", f"download {safe_name} size={file_size}")
    return send_file(
        filepath,
        mimetype="video/mp4",
        as_attachment=True,
        download_name=safe_name,
    )


@app.route("/recordings/<filename>", methods=["DELETE"])
def delete_recording(filename):
    safe_name = os.path.basename(filename)
    filepath = os.path.join(RECORDINGS_DIR, safe_name)

    if not os.path.exists(filepath):
        return jsonify({"success": False, "error": "File not found"}), 404

    os.remove(filepath)
    write_log("downloads.log", f"deleted {safe_name}")
    return jsonify({"success": True})


if __name__ == "__main__":
    ensure_logs_dir()
    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    startup_results = refresh_diagnostics_blocking()
    log_startup_diagnostics(startup_results)
    app.run(host="0.0.0.0", port=PORT, threaded=True)

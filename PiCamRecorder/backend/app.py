from flask import Flask, jsonify
import os
import subprocess
import threading
import time

app = Flask(__name__)

RECORDINGS_DIR = "recordings"
os.makedirs(RECORDINGS_DIR, exist_ok=True)

state_lock = threading.Lock()
record_proc = None
record_filename = None


def is_recording():
    return record_proc is not None and record_proc.poll() is None


def clear_dead_proc():
    global record_proc, record_filename
    if record_proc is not None and record_proc.poll() is not None:
        record_proc = None
        record_filename = None


@app.route("/health")
def health():
    return jsonify({"success": True})


@app.route("/status")
def status():
    with state_lock:
        running = is_recording()
    return jsonify({"success": True, "recording": running})


@app.route("/recording/start", methods=["POST"])
def start():
    global record_proc, record_filename

    with state_lock:
        clear_dead_proc()
        if is_recording():
            return jsonify({"success": False, "error": "Already recording"}), 409

        filename = f"rec_{int(time.time())}.h264"
        filepath = os.path.join(RECORDINGS_DIR, filename)
        record_proc = subprocess.Popen(
            ["rpicam-vid", "-t", "0", "-o", filepath],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        record_filename = filename

    return jsonify(
        {
            "success": True,
            "recording": True,
            "filename": filename,
        }
    )


@app.route("/recording/stop", methods=["POST"])
def stop():
    global record_proc, record_filename

    with state_lock:
        if not is_recording():
            return jsonify({"success": False, "error": "Not recording"}), 400

        proc = record_proc
        filename = record_filename
        record_proc = None
        record_filename = None

    proc.terminate()

    return jsonify(
        {
            "success": True,
            "recording": False,
            "filename": filename,
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, threaded=True)

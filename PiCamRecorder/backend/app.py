import os
import subprocess
from datetime import datetime

from flask import Flask, jsonify

RECORDINGS_DIR = "recordings"
PORT = 5000

app = Flask(__name__)
record_proc = None
record_filename = None


def generate_filename():
    now = datetime.now()
    return f"recording-{now.strftime('%Y%m%d')}-{now.strftime('%H%M%S')}.h264"


@app.route("/health")
def health():
    return jsonify({"success": True})


@app.route("/status")
def status():
    recording = record_proc is not None and record_proc.poll() is None
    return jsonify({"success": True, "recording": recording})


@app.route("/recording/start", methods=["POST"])
def start_recording():
    global record_proc, record_filename

    if record_proc is not None and record_proc.poll() is None:
        return jsonify({"success": False, "error": "Already recording"}), 409

    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    filename = generate_filename()
    filepath = os.path.join(RECORDINGS_DIR, filename)

    record_proc = subprocess.Popen(["rpicam-vid", "-t", "0", "-o", filepath])
    record_filename = filename

    return jsonify(
        {
            "success": True,
            "recording": True,
            "filename": filename,
        }
    )


@app.route("/recording/stop", methods=["POST"])
def stop_recording():
    global record_proc, record_filename

    if record_proc is None or record_proc.poll() is not None:
        return jsonify({"success": False, "error": "Not recording"}), 400

    filename = record_filename
    record_proc.terminate()
    try:
        record_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        record_proc.kill()
        record_proc.wait(timeout=5)

    record_proc = None

    return jsonify(
        {
            "success": True,
            "recording": False,
            "filename": filename,
        }
    )


if __name__ == "__main__":
    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    app.run(host="0.0.0.0", port=PORT, threaded=True)

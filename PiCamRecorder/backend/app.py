from flask import Flask, jsonify
import subprocess
import os
import time

app = Flask(__name__)

RECORDINGS_DIR = "recordings"
os.makedirs(RECORDINGS_DIR, exist_ok=True)

record_proc = None
record_filename = None


@app.route("/health")
def health():
    return jsonify({"success": True})


@app.route("/status")
def status():
    global record_proc
    running = record_proc is not None and record_proc.poll() is None
    return jsonify({"success": True, "recording": running})


@app.route("/recording/start", methods=["POST"])
def start():
    global record_proc, record_filename

    if record_proc is not None and record_proc.poll() is None:
        return jsonify({"success": False, "error": "Already recording"}), 409

    record_filename = f"rec_{int(time.time())}.h264"
    filepath = os.path.join(RECORDINGS_DIR, record_filename)

    record_proc = subprocess.Popen([
        "rpicam-vid",
        "-t", "0",
        "-o", filepath
    ])

    return jsonify({
        "success": True,
        "recording": True,
        "filename": record_filename
    })


@app.route("/recording/stop", methods=["POST"])
def stop():
    global record_proc, record_filename

    if record_proc is None or record_proc.poll() is not None:
        return jsonify({"success": False, "error": "Not recording"}), 400

    record_proc.terminate()
    try:
        record_proc.wait(timeout=5)
    except:
        record_proc.kill()

    filename = record_filename
    record_proc = None
    record_filename = None

    return jsonify({
        "success": True,
        "recording": False,
        "filename": filename
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

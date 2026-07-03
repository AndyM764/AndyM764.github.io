import os
import subprocess
import threading

from flask import Flask, jsonify, send_file

RECORDINGS_DIR = "recordings"
OUTPUT_FILE = os.path.join(RECORDINGS_DIR, "test.h264")
PORT = 5000

app = Flask(__name__)

recording_lock = threading.Lock()
rpicam_proc = None
recording = False


@app.route("/health")
def health():
    return jsonify({"success": True, "recording": recording})


@app.route("/status")
def status():
    return jsonify({"success": True, "recording": recording})


@app.route("/recording/start", methods=["POST"])
def start_recording():
    global rpicam_proc, recording

    with recording_lock:
        if recording:
            return jsonify({"success": False, "error": "Already recording"}), 409

        os.makedirs(RECORDINGS_DIR, exist_ok=True)
        rpicam_proc = subprocess.Popen(
            ["rpicam-vid", "-t", "0", "-o", OUTPUT_FILE],
        )
        recording = True

    return jsonify(
        {
            "success": True,
            "recording": True,
            "filename": "test.h264",
        }
    )


@app.route("/recording/stop", methods=["POST"])
def stop_recording():
    global rpicam_proc, recording

    with recording_lock:
        if not recording:
            return jsonify({"success": False, "error": "Not recording"}), 400

        if rpicam_proc and rpicam_proc.poll() is None:
            rpicam_proc.terminate()
            try:
                rpicam_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                rpicam_proc.kill()

        rpicam_proc = None
        recording = False

    file_size = os.path.getsize(OUTPUT_FILE) if os.path.exists(OUTPUT_FILE) else 0

    return jsonify(
        {
            "success": True,
            "recording": False,
            "filename": "test.h264",
            "fileSize": file_size,
            "downloadUrl": "/recordings/test.h264",
        }
    )


@app.route("/recordings/<filename>", methods=["GET"])
def get_recording(filename):
    if os.path.basename(filename) != "test.h264":
        return jsonify({"success": False, "error": "File not found"}), 404

    if not os.path.exists(OUTPUT_FILE):
        return jsonify({"success": False, "error": "File not found"}), 404

    return send_file(
        OUTPUT_FILE,
        mimetype="application/octet-stream",
        as_attachment=True,
        download_name="test.h264",
    )


if __name__ == "__main__":
    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    app.run(host="0.0.0.0", port=PORT, threaded=True)

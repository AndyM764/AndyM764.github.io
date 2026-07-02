import os
import shutil
import subprocess
import threading
from datetime import datetime

from flask import Flask, jsonify, send_file

RECORDINGS_DIR = "/tmp/picam-recordings/"
PORT = 5000

app = Flask(__name__)

recording_lock = threading.Lock()
state = {
    "recording": False,
    "filename": None,
    "rpicam_proc": None,
    "ffmpeg_proc": None,
}


def ensure_recordings_dir():
    os.makedirs(RECORDINGS_DIR, exist_ok=True)


def camera_available():
    return shutil.which("rpicam-vid") is not None and shutil.which("ffmpeg") is not None


def generate_filename():
    now = datetime.now()
    return f"recording-{now.strftime('%Y%m%d')}-{now.strftime('%H%M%S')}.mp4"


@app.route("/status")
def status():
    return jsonify(
        {
            "success": True,
            "cameraAvailable": camera_available(),
            "recording": state["recording"],
        }
    )


@app.route("/recording/start", methods=["POST"])
def start_recording():
    with recording_lock:
        if state["recording"]:
            return jsonify({"success": False, "error": "Already recording"}), 409

        ensure_recordings_dir()
        filename = generate_filename()
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
            "-c",
            "copy",
            filepath,
        ]

        try:
            rpicam_proc = subprocess.Popen(
                rpicam_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            ffmpeg_proc = subprocess.Popen(
                ffmpeg_cmd,
                stdin=rpicam_proc.stdout,
                stderr=subprocess.DEVNULL,
            )
            rpicam_proc.stdout.close()
        except OSError as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

        state["recording"] = True
        state["filename"] = filename
        state["rpicam_proc"] = rpicam_proc
        state["ffmpeg_proc"] = ffmpeg_proc

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
            return jsonify({"success": False, "error": "Not recording"}), 400

        filename = state["filename"]
        filepath = os.path.join(RECORDINGS_DIR, filename)
        rpicam_proc = state["rpicam_proc"]
        ffmpeg_proc = state["ffmpeg_proc"]

        state["recording"] = False
        state["rpicam_proc"] = None
        state["ffmpeg_proc"] = None
        state["filename"] = None

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

    if not os.path.exists(filepath):
        return jsonify({"success": False, "error": "Recording file not found"}), 500

    file_size = os.path.getsize(filepath)
    if file_size == 0:
        return jsonify({"success": False, "error": "Recording file is empty"}), 500

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
    return jsonify({"success": True})


if __name__ == "__main__":
    ensure_recordings_dir()
    app.run(host="0.0.0.0", port=PORT)

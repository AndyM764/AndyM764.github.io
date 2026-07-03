from flask import Flask, jsonify, send_file
from picamera2 import Picamera2
import os

app = Flask(__name__)

VIDEO_PATH = "video.h264"

picam2 = Picamera2()
config = picam2.create_video_configuration()
picam2.configure(config)
picam2.start()

recording = False


@app.route("/start", methods=["POST"])
def start():
    global recording
    if recording:
        return jsonify({"status": "already recording"}), 400
    picam2.start_recording(VIDEO_PATH)
    recording = True
    return jsonify({"status": "recording"})


@app.route("/stop", methods=["POST"])
def stop():
    global recording
    if not recording:
        return jsonify({"status": "not recording"}), 400
    picam2.stop_recording()
    recording = False
    return jsonify({"status": "stopped"})


@app.route("/download", methods=["GET"])
def download():
    if not os.path.exists(VIDEO_PATH):
        return jsonify({"error": "no video recorded yet"}), 404
    return send_file(VIDEO_PATH, as_attachment=True, download_name="video.h264")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

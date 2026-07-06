#!/usr/bin/env python3
import datetime
import io
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Condition, Lock

from picamera2 import Picamera2
from picamera2.encoders import H264Encoder, JpegEncoder
from picamera2.outputs import FfmpegOutput, FileOutput


class StreamingOutput(io.BufferedIOBase):
    def __init__(self):
        self.frame = None
        self.condition = Condition()

    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.condition.notify_all()


def main():
    picam2 = Picamera2()
    picam2.configure(
        picam2.create_video_configuration(
            main={"size": (640, 480)},
            lores={"size": (640, 480), "format": "YUV420"},
        )
    )
    picam2.start()

    output = StreamingOutput()
    picam2.start_encoder(JpegEncoder(), FileOutput(output))

    recording_encoder = None
    recording_lock = Lock()

    def start_recording():
        nonlocal recording_encoder
        with recording_lock:
            if recording_encoder is not None:
                return False
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"recording_{timestamp}.mp4"
            recording_encoder = H264Encoder()
            picam2.start_encoder(recording_encoder, FfmpegOutput(filename), name="lores")
            return True

    def stop_recording():
        nonlocal recording_encoder
        with recording_lock:
            if recording_encoder is None:
                return False
            picam2.stop_encoder(recording_encoder)
            recording_encoder = None
            return True

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/start-recording":
                self.send_response(200 if start_recording() else 409)
                self.end_headers()
                return

            if self.path == "/stop-recording":
                self.send_response(200 if stop_recording() else 409)
                self.end_headers()
                return

            if self.path != "/stream":
                self.send_response(404)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Age", 0)
            self.send_header("Cache-Control", "no-cache, private")
            self.send_header("Pragma", "no-cache")
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=FRAME")
            self.end_headers()

            try:
                while True:
                    with output.condition:
                        output.condition.wait()
                        frame = output.frame
                    self.wfile.write(b"--FRAME\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode())
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, format, *args):
            pass

    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()


if __name__ == "__main__":
    main()

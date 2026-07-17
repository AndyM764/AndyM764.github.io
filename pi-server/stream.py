#!/usr/bin/env python3
import datetime
import glob
import io
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Condition, Event, Lock, Thread
from urllib.parse import urlparse

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
    recording_output = None
    recording_filename = None
    recording_lock = Lock()
    # FfmpegOutput uses prctl PDEATHSIG tied to the creating thread.
    # Keep that thread alive until stop_recording(), or ffmpeg is SIGKILL'd.
    recording_hold_stop = Event()
    recording_hold_thread = None

    def start_recording():
        nonlocal recording_encoder, recording_output, recording_filename, recording_hold_thread
        with recording_lock:
            if recording_encoder is not None:
                print("[recording] start_recording() -> False (already recording)")
                return False
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            recording_filename = f"recording_{timestamp}.mp4"
            recording_output = FfmpegOutput(recording_filename)
            recording_encoder = H264Encoder()
            print(f"[recording] starting {os.path.abspath(recording_filename)}")

            recording_hold_stop.clear()
            started = Event()
            start_error = []

            def _hold_ffmpeg_parent():
                try:
                    picam2.start_encoder(recording_encoder, recording_output, name="lores")
                except Exception as exc:
                    start_error.append(exc)
                finally:
                    started.set()
                recording_hold_stop.wait()

            recording_hold_thread = Thread(target=_hold_ffmpeg_parent, daemon=True)
            recording_hold_thread.start()
            started.wait()

            if start_error:
                recording_encoder = None
                recording_output = None
                recording_filename = None
                recording_hold_stop.set()
                recording_hold_thread = None
                print(f"[recording] start_recording() -> False ({start_error[0]})")
                return False

            print("[recording] start_recording() -> True")
            return True

    def stop_recording():
        nonlocal recording_encoder, recording_output, recording_filename, recording_hold_thread
        with recording_lock:
            if recording_encoder is None:
                print("[recording] stop_recording() -> False (not recording)")
                return False
            print(f"[recording] stopping {recording_filename}")
            picam2.stop_encoder(recording_encoder)
            recording_hold_stop.set()
            if recording_hold_thread is not None:
                recording_hold_thread.join(timeout=5)
                recording_hold_thread = None
            recording_encoder = None
            recording_output = None
            path = os.path.abspath(recording_filename) if recording_filename else None
            if path and os.path.exists(path):
                print(f"[recording] stopped, file exists ({os.path.getsize(path)} bytes): {path}")
            else:
                print(f"[recording] stopped, file missing: {path}")
            recording_filename = None
            print("[recording] stop_recording() -> True")
            return True

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlparse(self.path).path

            if path == "/start-recording":
                print(f"[recording] GET /start-recording received (raw path={self.path})")
                started = start_recording()
                self.send_response(200 if started else 409)
                self.end_headers()
                return

            if path == "/stop-recording":
                print(f"[recording] GET /stop-recording received (raw path={self.path})")
                stopped = stop_recording()
                self.send_response(200 if stopped else 409)
                self.end_headers()
                return

            if path.startswith("/download/"):
                filename = os.path.basename(path[len("/download/"):])
                if not filename or not os.path.isfile(filename):
                    self.send_response(404)
                    self.end_headers()
                    return
                with open(filename, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

            if path == "/latest-recording":
                recordings = glob.glob("recording_*.mp4")
                if not recordings:
                    self.send_response(404)
                    self.end_headers()
                    return
                latest = max(recordings, key=os.path.getmtime)
                data = os.path.basename(latest).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
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

    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()


if __name__ == "__main__":
    main()

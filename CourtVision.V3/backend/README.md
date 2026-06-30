# CourtVision V4 Raspberry Pi Backend

Single Flask backend at `backend/app.py` for the CourtVision mobile app.

## Runtime requirements

- Raspberry Pi 5 with Camera Module
- `rpicam-vid`
- `ffmpeg` and `ffprobe`
- Python 3.11+

Install system dependencies:

```sh
sudo apt update
sudo apt install -y ffmpeg
```

Install Python dependencies:

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

Run:

```sh
python app.py
```

The server listens on `0.0.0.0:5000` by default.

## Architecture

V4 is recording-first:

1. **Recording** uses a dedicated `rpicam-vid | ffmpeg` pipeline that writes a mobile-compatible MP4 directly to a temp directory.
2. **Preview** uses a separate HLS pipeline when preview is enabled.
3. Only one pipeline can use the camera at a time.

Recordings are stored temporarily in `/tmp/courtvision-recordings` by default. The phone downloads the MP4 and then calls `DELETE /recordings/<filename>` so files are not kept on the Pi.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/info` | Pi hostname and IP for discovery |
| GET | `/status` | Health plus camera/recording/ball machine state |
| POST | `/data` | Receive tennis parameters (speed, elevation, spin, frequency) |
| POST | `/ball-machine/state` | Turn ball machine on or off |
| POST | `/camera/state` | Enable or disable HLS preview |
| GET | `/camera/stream.m3u8` | HLS playlist for Expo preview |
| POST | `/recording/start` | Start direct MP4 recording |
| POST | `/recording/stop` | Finalize MP4 and return download URL |
| GET | `/recordings/<filename>.mp4` | Download recording to phone |
| DELETE | `/recordings/<filename>.mp4` | Remove temp file from Pi |

## Recording

`POST /recording/start` starts `rpicam-vid` piped into `ffmpeg`, which encodes H.264 baseline video with `yuv420p` and `+faststart` for iOS and Android playback.

`POST /recording/stop` closes the pipeline, validates the MP4 with `ffprobe`, and returns a download URL.

Stop camera preview before starting a recording.

## Camera preview

`POST /camera/state` with `{"enabled": true}` starts low-latency HLS preview.

`GET /camera/stream.m3u8` is consumed by `expo-video` in Expo Go.

Default low-latency settings:

```txt
COURTVISION_HLS_SEGMENT_SECONDS=0.5
COURTVISION_HLS_LIST_SIZE=3
COURTVISION_CAMERA_INTRA_PERIOD=15
```

## Deployment

Copy the backend to the Pi and restart Flask:

```sh
scp -r backend/ andy76@<pi-ip>:~/courtvision/backend/
ssh andy76@<pi-ip> "cd ~/courtvision/backend && . .venv/bin/activate && python app.py"
```

Set the phone app bootstrap URL:

```txt
EXPO_PUBLIC_RASPBERRY_PI_BASE_URL=http://<pi-ip>:5000
```

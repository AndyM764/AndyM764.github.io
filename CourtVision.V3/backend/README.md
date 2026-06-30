# CourtVision V4 Raspberry Pi Backend

Single Flask backend at `backend/app.py` for the CourtVision mobile app.

## Runtime requirements

- Raspberry Pi 5 with Camera Module
- `rpicam-vid`
- `ffmpeg` (`ffprobe` is optional)
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

V4 is recording-first with atomic camera state:

| State | Meaning |
|-------|---------|
| `IDLE` | Camera not in use |
| `PREVIEW` | HLS preview pipeline active |
| `RECORDING` | Direct MP4 recording pipeline active |

Only one state is allowed at a time. Conflicts return:

```json
{
  "success": false,
  "message": "Camera is currently in use by another process"
}
```

## Safety guarantees

- **Camera lock** is enforced in the backend, not the app.
- **Recording deletion** only happens after the phone confirms a successful download via `DELETE /recordings/<filename>` with `{"downloaded": true}`.
- **ffprobe** is optional. Recording success requires a non-empty MP4 file.
- **Single backend**: startup fails if `camera_server.py` or duplicate `app.py` files exist.
- **Safe deploy**: use `deploy.sh` to health-check staged backend before promotion.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/info` | Pi hostname and IP for discovery |
| GET | `/status` | Health, `cameraState`, and consistency check |
| POST | `/data` | Receive tennis parameters |
| POST | `/ball-machine/state` | Turn ball machine on or off |
| POST | `/camera/state` | Enable or disable HLS preview |
| GET | `/camera/stream.m3u8` | HLS playlist for Expo preview |
| POST | `/recording/start` | Start direct MP4 recording |
| POST | `/recording/stop` | Finalize MP4 and return download URL |
| GET | `/recordings/<filename>.mp4` | Download recording to phone |
| DELETE | `/recordings/<filename>.mp4` | Remove temp file after confirmed download |

## Recording flow

1. `POST /recording/start` → Pi records to temp directory
2. `POST /recording/stop` → MP4 finalized (file must exist with size > 0)
3. `GET /recordings/<filename>` → phone downloads MP4
4. `DELETE /recordings/<filename>` with `{"downloaded": true}` → Pi deletes file

If download fails, the file remains on the Pi for retry.

## One-command deploy and verify (Mac)

From your Mac, with SSH access to the Pi:

```sh
cd /Users/andymannikum/CourtVisionV4/CourtVision.V3/backend
chmod +x deploy-courtvision-v4.sh verify-courtvision-v4.sh
./deploy-courtvision-v4.sh andy76@<pi-ip>
```

This single command:

1. Validates local `backend/app.py`
2. Uploads to a staged directory on the Pi
3. Health-checks the staged backend on port `5001`
4. Promotes files to `~/courtvision/backend`
5. Stops any old Flask process and starts production Flask on port `5000`
6. Runs `verify-courtvision-v4.sh` against the Pi

Environment overrides:

```sh
export COURTVISION_BACKEND_DIR=/Users/andymannikum/CourtVisionV4/CourtVision.V3/backend
export COURTVISION_PI_TARGET=andy76@192.168.1.50
export COURTVISION_REMOTE_DIR=~/courtvision/backend
export COURTVISION_PORT=5000
./deploy-courtvision-v4.sh
```

Verify only (without redeploying):

```sh
./verify-courtvision-v4.sh http://<pi-ip>:5000
```

Each script ends with a clear summary:

```txt
DEPLOY: PASS
VERIFY: PASS
```

or `FAIL` with failed check details.

## Safe deployment (staged only)

The older staged deploy script remains available:

```sh
./deploy.sh andy76@<pi-ip> ~/courtvision/backend
```

Set the phone app bootstrap URL:

```txt
EXPO_PUBLIC_RASPBERRY_PI_BASE_URL=http://<pi-ip>:5000
```

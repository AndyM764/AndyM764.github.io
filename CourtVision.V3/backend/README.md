# CourtVision V4 Raspberry Pi Backend

Single Flask backend at `backend/app.py` for the CourtVision mobile app.

## One-command deploy (Mac)

```sh
cd CourtVision.V3/backend
chmod +x deploy.sh verify.sh
./deploy.sh andy76@<pi-ip>
```

That's it. No second path argument. No manual SSH.

The script will:

1. Auto-detect the local backend directory (the folder containing `deploy.sh`)
2. Show a confirmation prompt with backend dir, Pi target, remote dir, and port
3. Upload and health-check a staged build
4. Backup the existing Pi backend to `/home/andy76/courtvision-backup-YYYYMMDD-HHMMSS`
5. Deploy to `/home/andy76/courtvision/backend`
6. Stop the old Flask process and start the new one on port `5000`
7. Run `verify.sh` automatically

Ends with:

```txt
========================================
DEPLOY: PASS
VERIFY: PASS
========================================
Rollback:
  ssh andy76@<pi-ip> '...'
```

## Verify only

```sh
./verify.sh http://<pi-ip>:5000
```

Checks:

- `GET /status` — `cameraState` in `IDLE|PREVIEW|RECORDING`, `cameraStateConsistent == true`
- `GET /info` — `hostname` and `ip` present
- `POST /camera/state`
- `POST /recording/start` — if recording starts, validates process state and output file size
- `POST /recording/stop`

Every check prints:

```txt
PASS: GET /status — HTTP 200
```

or on failure:

```txt
FAIL: GET /status
  endpoint: GET http://192.168.1.50:5000/status
  HTTP status: 500
  response body: {"success":false,"message":"..."}
```

## Phone app

```sh
cd CourtVision.V3
EXPO_PUBLIC_RASPBERRY_PI_BASE_URL=http://<pi-ip>:5000 npm start
```

## Runtime requirements (Pi)

- Raspberry Pi 5 with Camera Module
- `rpicam-vid`
- `ffmpeg` (`ffprobe` optional — warn only if missing)
- Python 3.11+

```sh
sudo apt update
sudo apt install -y ffmpeg
```

## Manual backend start (only if needed)

```sh
ssh andy76@<pi-ip>
cd /home/andy76/courtvision/backend
. .venv/bin/activate
PORT=5000 python app.py
```

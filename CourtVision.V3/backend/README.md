# CourtVision.V3 Raspberry Pi Backend

This Flask backend serves the mobile app and streams the real Raspberry Pi Camera Module.

## Runtime requirements

- Raspberry Pi 5
- Working `rpicam-vid` command
- `ffmpeg`
- Python 3.11+

Install system dependency:

```sh
sudo apt update
sudo apt install -y ffmpeg
```

Install Python dependency:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

Run:

```sh
python app.py
```

The app listens on `0.0.0.0:5000` by default.

## Camera preview

`POST /camera/state` starts or stops the HLS preview pipeline.

`GET /camera/stream` returns the live HLS playlist consumed by the Expo app.

The stream uses the Raspberry Pi Camera Module through `rpicam-vid`; it does not use fake images or the phone camera.

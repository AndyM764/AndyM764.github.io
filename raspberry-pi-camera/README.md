# Raspberry Pi Camera Remote Control

Minimal university prototype: control a Raspberry Pi Camera Module 3 from your phone over WiFi.

## Project structure

```
raspberry-pi-camera/
  pi_server.py          # Flask server (run on Raspberry Pi)
  requirements.txt      # Python dependencies
  mobile-app/
    App.js              # Expo app (single screen, 3 buttons)
    app.json
    package.json
    index.js
```

## 1. Raspberry Pi setup

Copy `pi_server.py` and `requirements.txt` to your Raspberry Pi, then run:

```bash
pip install -r requirements.txt
python3 pi_server.py
```

The server listens on `http://0.0.0.0:5000`.

### API endpoints

| Method | Endpoint   | Action                          |
|--------|------------|---------------------------------|
| POST   | `/start`   | Start recording video           |
| POST   | `/stop`    | Stop recording and save file    |
| GET    | `/download`| Download the latest `video.h264`|

## 2. Mobile app setup

On your development machine (laptop/PC with Node.js):

```bash
cd mobile-app
npm install
npx expo install expo-file-system
```

## 3. Run the mobile app

```bash
cd mobile-app
npx expo start
```

Scan the QR code with **Expo Go** on your phone. Make sure your phone is on the same WiFi network as the Raspberry Pi.

The app connects to: `http://10.136.19.4:5000`

To use a different Pi IP address, edit `PI_URL` at the top of `App.js`.

## Usage

1. Press **Start Recording** — the Pi begins recording.
2. Press **Stop Recording** — the Pi stops and saves `video.h264`.
3. Press **Download Video** — the video is saved to the phone's local storage.

## Notes

- No authentication, database, or cloud services.
- Video format is H.264 (`.h264`). Most phones can play this with a video player app.
- If the app cannot connect, confirm both devices are on the same WiFi and the Pi firewall allows port 5000.

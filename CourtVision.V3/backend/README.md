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

## Low-latency camera preview

CourtVision uses HLS for the React Native preview because it is supported by `expo-video` in Expo Go on iOS and Android without adding native streaming modules.

`POST /camera/state` starts or stops the low-latency HLS preview pipeline.

`GET /camera/stream.m3u8` returns the live HLS playlist consumed by the Expo app.

`GET /camera/stream` remains available as a compatibility alias.

The stream uses the Raspberry Pi Camera Module through `rpicam-vid`; it does not use fake images or the phone camera.

Default low-latency settings:

```txt
COURTVISION_HLS_SEGMENT_SECONDS=0.5
COURTVISION_HLS_LIST_SIZE=3
COURTVISION_CAMERA_INTRA_PERIOD=15
```

At 30 fps, an intra period of 15 requests a keyframe about every 0.5 seconds so HLS can create shorter live segments for local WiFi/hotspot viewing.

## Recording

The backend does not save raw `.h264` files as the final output.

`POST /recording/start` starts recording against the live Raspberry Pi camera stream.

`POST /recording/stop` finalizes the captured camera segments into a valid `.mp4` file using `ffmpeg`.

The final MP4 is transcoded to mobile-compatible H.264 video and written with `+faststart` so the `moov` atom is present and iOS/Android can play the downloaded file.

Download finalized recordings from:

```txt
GET /recordings/<filename>.mp4
```

By default, recordings are stored in:

```txt
/home/andy76/recordings
```

# CourtVision V4 Recording MVP

Priority: Pi Camera Module 3 records → valid MP4 → phone download → local save → playback.

## Hardening guarantees

| Requirement | Behavior |
|-------------|----------|
| Camera availability | `verify_camera_available()` runs before `rpicam-vid` starts; exact error if no camera |
| Recording watchdog | After 2 s, fail immediately if `rpicam-vid` or `ffmpeg` exited |
| MP4 finalization | `wait_for_file_stable()` waits until size stops changing, then `validate_mp4()` |
| ffprobe fallback | If `ffprobe` missing: require file exists and size > 100 KB; return `validation.warning`, not failure |
| Download integrity | App compares downloaded bytes to backend `fileSize`; fail on mismatch |
| Cleanup safety | Pi file deleted only after download succeeded, local file exists, local size > 0, sizes match |
| Backend restart recovery | Orphan PIDs from `/tmp/courtvision-active-recording.json` terminated on startup; state reset to IDLE |
| Logging | Camera detected, recording PIDs, duration, final size, download size, deletion success |

## Pi paths

| Purpose | Path |
|---------|------|
| Temp recordings | `/tmp/courtvision-recordings/` |
| Active recording state | `/tmp/courtvision-active-recording.json` |
| Filename pattern | `courtvision-YYYYMMDD-HHMMSS-<id>.mp4` |

## Phone paths

| Purpose | Path |
|---------|------|
| Saved videos | `<app documents>/CourtVision/<filename>.mp4` |

## API contracts

### `GET /status`

```json
{
  "status": "ok",
  "cameraState": "IDLE",
  "cameraStateConsistent": true,
  "cameraPreviewEnabled": false,
  "recordingActive": false,
  "ballMachinePower": "off"
}
```

### `POST /recording/start`

Success (HTTP 200):

```json
{
  "success": true,
  "recordingId": "courtvision-20260701-120000-a1b2c3d4",
  "filename": "courtvision-20260701-120000-a1b2c3d4.mp4",
  "processesRunning": true,
  "recordingActive": true,
  "cameraPid": 1234,
  "ffmpegPid": 1235,
  "cameraState": "RECORDING"
}
```

Failure (HTTP 500), exact message examples:

```json
{
  "success": false,
  "message": "Raspberry Pi camera is not detected. Connect Camera Module 3 and reboot if needed."
}
```

```json
{
  "success": false,
  "message": "Recording pipeline failed to start. rpicam-vid exited with code 1 ..."
}
```

### `POST /recording/stop`

Request:

```json
{
  "recordingId": "courtvision-20260701-120000-a1b2c3d4"
}
```

Success (HTTP 200):

```json
{
  "success": true,
  "recordingId": "courtvision-20260701-120000-a1b2c3d4",
  "filename": "courtvision-20260701-120000-a1b2c3d4.mp4",
  "downloadUrl": "/recordings/courtvision-20260701-120000-a1b2c3d4.mp4",
  "fileSize": 1234567,
  "recordingDurationSeconds": 5.12,
  "validation": {
    "fileExists": true,
    "fileSize": 1234567,
    "ffprobeAvailable": true,
    "duration": 5.0,
    "validVideoStream": true,
    "passed": true
  },
  "cameraState": "IDLE"
}
```

ffprobe missing (still success, HTTP 200):

```json
{
  "validation": {
    "fileExists": true,
    "fileSize": 1234567,
    "ffprobeAvailable": false,
    "duration": null,
    "validVideoStream": null,
    "passed": true,
    "warning": "ffprobe is not installed; validated file existence and minimum size only."
  }
}
```

### `GET /recordings/<filename>`

Success: HTTP 200, `Content-Type: video/mp4`, body size equals `fileSize` from stop response.

Failure (HTTP 404):

```json
{
  "success": false,
  "message": "Recording was not found on the Raspberry Pi."
}
```

### `DELETE /recordings/<filename>`

Request (only after confirmed phone download):

```json
{
  "downloaded": true
}
```

Success (HTTP 200):

```json
{
  "success": true,
  "message": "Recording deleted from Raspberry Pi."
}
```

## Exact manual test plan

Replace `<pi-ip>` with the Raspberry Pi address. Replace `<filename>` and `<recordingId>` with values returned by the API.

### Step 1 — Start backend

**Action**

```bash
cd /home/andy76/courtvision/backend
. .venv/bin/activate
PORT=5000 python app.py
```

**Expected API**

```bash
curl -s http://<pi-ip>:5000/status
```

```json
{
  "status": "ok",
  "cameraState": "IDLE",
  "cameraStateConsistent": true,
  "cameraPreviewEnabled": false,
  "recordingActive": false,
  "ballMachinePower": "off"
}
```

**Expected state**

| Layer | State |
|-------|-------|
| Backend `cameraState` | `IDLE` |
| Backend `recordingActive` | `false` |
| App `recordingState` | `idle` |
| Pi processes | no `rpicam-vid` / `ffmpeg` recording pair |

**Expected file size checks**

- No file required yet.

**Expected logs**

- Flask listening on `0.0.0.0:5000`
- If prior crash left orphans: `Terminated orphan recording process ...`

---

### Step 2 — Record 5 seconds

**Action**

- In app: tap **Record**
- Wait 5 seconds

Equivalent API:

```bash
curl -s -X POST http://<pi-ip>:5000/recording/start
```

**Expected API** (HTTP 200)

```json
{
  "success": true,
  "recordingId": "courtvision-YYYYMMDD-HHMMSS-xxxxxxxx",
  "filename": "courtvision-YYYYMMDD-HHMMSS-xxxxxxxx.mp4",
  "processesRunning": true,
  "recordingActive": true,
  "cameraPid": <positive integer>,
  "ffmpegPid": <positive integer>,
  "cameraState": "RECORDING"
}
```

```bash
curl -s http://<pi-ip>:5000/status
```

```json
{
  "status": "ok",
  "cameraState": "RECORDING",
  "cameraStateConsistent": true,
  "cameraPreviewEnabled": false,
  "recordingActive": true,
  "ballMachinePower": "off"
}
```

**Expected state**

| Layer | State |
|-------|-------|
| Backend `cameraState` | `RECORDING` |
| Backend `recordingActive` | `true` |
| App `recordingState` | `recording` |
| App `recordingId` | equals `recordingId` from start response |
| Pi processes | both `cameraPid` and `ffmpegPid` alive |

**Expected file size checks**

```bash
ls -l /tmp/courtvision-recordings/<filename>
```

- File exists.
- Size increases while recording (growing MP4).

**Expected logs**

- `Camera detected via rpicam-hello` or `rpicam-vid`
- `Recording started id=... camera_pid=... ffmpeg_pid=...`

---

### Step 3 — Stop

**Action**

- In app: tap **Stop**

Equivalent API:

```bash
curl -s -X POST http://<pi-ip>:5000/recording/stop \
  -H 'Content-Type: application/json' \
  -d '{"recordingId":"<recordingId>"}'
```

**Expected API** (HTTP 200)

```json
{
  "success": true,
  "recordingId": "<recordingId>",
  "filename": "<filename>",
  "downloadUrl": "/recordings/<filename>",
  "fileSize": <integer>,
  "recordingDurationSeconds": <number between 4 and 7>,
  "validation": {
    "fileExists": true,
    "fileSize": <same as fileSize>,
    "ffprobeAvailable": true,
    "duration": <number > 0>,
    "validVideoStream": true,
    "passed": true
  },
  "cameraState": "IDLE"
}
```

If `ffprobe` is not installed, `validation.warning` is present and `passed` remains `true` when `fileSize > 102400`.

**Expected state**

| Layer | State |
|-------|-------|
| During finalize | app `recordingState` = `saving` |
| After success | app `recordingState` = `idle` (after download completes in step 4) |
| Backend `cameraState` | `IDLE` |
| Backend `recordingActive` | `false` |
| Pi processes | recording `rpicam-vid` and `ffmpeg` exited cleanly |

**Expected file size checks**

```bash
ls -l /tmp/courtvision-recordings/<filename>
stat -c '%s' /tmp/courtvision-recordings/<filename>
```

- File exists on Pi.
- `fileSize` from stop response > 100 KB (`102400` bytes minimum without ffprobe).
- `validation.fileSize` equals `fileSize`.
- File size on disk equals `fileSize` and is stable (no further growth).

**Expected logs**

- `Recording file stabilized path=... size=...`
- `Recording stopped id=... duration=... final_size=... validation=...`

---

### Step 4 — Download

**Action**

- App automatically downloads after stop (or manual):

```bash
curl -s -o /tmp/test-download.mp4 \
  http://<pi-ip>:5000/recordings/<filename>
wc -c /tmp/test-download.mp4
```

**Expected API** (HTTP 200)

- `Content-Type: video/mp4`
- Response body byte count equals stop response `fileSize`

**Expected state**

| Layer | State |
|-------|-------|
| App `recordingState` | `saving` during download, then `idle` |
| Backend `cameraState` | `IDLE` |

**Expected file size checks**

- Downloaded bytes == `fileSize` from stop response.
- App throws error if `savedVideo.size !== stopResponse.fileSize`.

**Expected logs**

- `Download started filename=... size=...`
- `Download completed filename=... size=...`

---

### Step 5 — Save locally

**Action**

- App saves to `<documents>/CourtVision/<filename>.mp4`

**Expected API**

- No additional API call.

**Expected state**

| Layer | State |
|-------|-------|
| App `recordingState` | `idle` |
| App `lastSavedVideo` | populated with `path`, `filename`, `size` |

**Expected file size checks**

- Local file exists at saved path.
- `lastSavedVideo.size > 0`
- `lastSavedVideo.size === stopResponse.fileSize`
- `lastSavedVideo.size === validation.fileSize`

---

### Step 6 — Play locally

**Action**

- In app: play the saved recording with `expo-video`

**Expected API**

- None.

**Expected state**

| Layer | State |
|-------|-------|
| App `recordingState` | `idle` |
| Player | loads `lastSavedVideo.path` and plays H.264 MP4 |

**Expected file size checks**

- Same local file from step 5; size unchanged.

---

### Step 7 — Pi cleanup (automatic)

**Action**

- After successful local save, app calls:

```bash
curl -s -X DELETE http://<pi-ip>:5000/recordings/<filename> \
  -H 'Content-Type: application/json' \
  -d '{"downloaded": true}'
```

**Expected API** (HTTP 200)

```json
{
  "success": true,
  "message": "Recording deleted from Raspberry Pi."
}
```

**Expected state**

| Layer | State |
|-------|-------|
| Pi file | removed from `/tmp/courtvision-recordings/` |

**Expected file size checks**

```bash
test ! -f /tmp/courtvision-recordings/<filename> && echo "deleted"
```

- Pi file must not exist after successful delete.

**Expected logs**

- `Recording deleted from Pi filename=...`

**Cleanup is skipped when**

- Download failed
- Local file missing
- Local file size is 0
- Downloaded size does not match backend `fileSize`

## Success criteria

All must be true:

1. User tapped Record
2. Camera detected and both recording processes alive after 2 s watchdog
3. User tapped Stop after ~5 s
4. MP4 finalized (stable size) and validated
5. App downloaded file with matching byte count
6. File saved in phone `CourtVision` folder with size > 0
7. Video plays on phone
8. Pi temp file deleted only after verified local copy

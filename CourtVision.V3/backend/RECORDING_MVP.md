# CourtVision V4 Recording MVP — Final Hardening

End-to-end path: Phone UI → Expo → HTTP → Flask → Recording manager → `rpicam-vid` → `ffmpeg` → MP4 on Pi → download → local storage → playback.

## Protections implemented

| # | Protection | Where |
|---|------------|-------|
| 1 | Pi `/tmp` storage check before start | `verify_tmp_storage_available()` |
| 2 | 2s watchdog for `rpicam-vid` + `ffmpeg` | `DirectRecordingManager.start()` |
| 3 | Configurable max recording duration + auto-stop | `RECORDING_MAX_DURATION_SECONDS`, timer |
| 4 | MP4 finalization wait (stable size) | `wait_for_file_stable()` before validation |
| 5 | MP4 validation (exists, size, duration, 1 video stream) | `validate_mp4()` |
| 6 | Duration verification vs wall clock | `verify_recording_duration()` |
| 7 | Download size integrity | `VideoStorageService` + `useRecordingState` |
| 8 | Interrupted download recovery | retries, partial file cleanup, Pi file retained |
| 9 | Safe Pi cleanup | delete only after verified local copy |
| 10 | App restart recovery | `recoverActiveRecordingFromStatus()` on mount |
| 11 | Backend crash recovery | `cleanup_recording_processes_on_startup()` |
| 12 | Pi reboot / deploy recovery | registry + `/proc` scan kills stale PIDs on startup |
| 13 | Structured logging | camera, storage, PIDs, duration, sizes, validation, cleanup |
| 14 | Process registry | `/tmp/courtvision-recording-process-registry.json` |
| 15 | Start rejects existing processes | `verify_recording_processes_not_running()` |
| 16 | Stop confirms 0 processes | `confirm_recording_pipeline_stopped()` |
| 17 | Debug visibility | `GET /debug/processes` |

## Configuration (environment)

| Variable | Default | Purpose |
|----------|---------|---------|
| `COURTVISION_RECORDING_MIN_TMP_FREE_BYTES` | `209715200` (200 MB) | Minimum free `/tmp` space to start |
| `COURTVISION_RECORDING_MAX_DURATION_SECONDS` | `600` | Max recording length; `0` disables |
| `COURTVISION_RECORDING_DURATION_TOLERANCE_SECONDS` | `3.0` | Allowed delta between wall clock and MP4 duration |
| `COURTVISION_RECORDING_WATCHDOG_SECONDS` | `2` | Process alive check delay |
| `COURTVISION_MIN_MP4_SIZE_WITHOUT_FFPROBE` | `102400` | Minimum size when `ffprobe` missing |

## Endpoints changed

### `GET /status` (extended)

```json
{
  "status": "ok",
  "cameraState": "IDLE",
  "cameraStateConsistent": true,
  "cameraPreviewEnabled": false,
  "recordingActive": false,
  "ballMachinePower": "off",
  "maxRecordingDurationSeconds": 600,
  "activeRecordingId": "courtvision-20260701-120000-a1b2c3d4",
  "activeRecordingFilename": "courtvision-20260701-120000-a1b2c3d4.mp4",
  "recordingStartedAt": 1780000000.0
}
```

`activeRecordingId`, `activeRecordingFilename`, and `recordingStartedAt` are present only while `recordingActive` is `true`.

### `POST /recording/start` (camera pre-checks before any recording state)

**Order of checks (all must pass before `begin_recording()`, `rpicam-vid`, or `ffmpeg` start):**

1. No recording already active → else busy
2. Camera detected via `rpicam-hello` / `rpicam-vid --list-cameras`
3. `/tmp` free space ≥ `RECORDING_MIN_TMP_FREE_BYTES`
4. `rpicam-vid` and `ffmpeg` on PATH
5. `begin_recording()` only after checks 1–4 pass
6. Start `rpicam-vid`, verify alive (250 ms), then start `ffmpeg`
7. 2s watchdog — both processes must remain alive

**Success (HTTP 200):**

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

**Camera failure responses (exact messages):**

| Condition | HTTP | Response |
|-----------|------|----------|
| Camera module not detected | 500 | `{ "success": false, "message": "Raspberry Pi camera not detected." }` |
| Camera already busy (recording active or conflict) | 409 | `{ "success": false, "message": "Raspberry Pi camera is busy." }` |
| `rpicam-vid` / watchdog init failed | 500 | `{ "success": false, "message": "Failed to initialize Raspberry Pi camera." }` |

**Other failure (HTTP 500):**

```json
{ "success": false, "message": "Insufficient storage on Raspberry Pi." }
```

**Pre-start verification checks:**

| Check | Pass | Fail message |
|-------|------|--------------|
| `rpicam-hello --list-cameras` or `rpicam-vid --list-cameras` reports camera | continue | `Raspberry Pi camera not detected.` |
| No active recording / not in `RECORDING` state | continue | `Raspberry Pi camera is busy.` |
| `/tmp` free ≥ 200 MB (default) | continue | `Insufficient storage on Raspberry Pi.` |
| `rpicam-vid` alive 250 ms after spawn | start ffmpeg | `Failed to initialize Raspberry Pi camera.` |
| Both processes alive after 2s watchdog | return success | `Failed to initialize Raspberry Pi camera.` |
| `cameraState` after failed start | `IDLE` | no `recordingActive`, no persisted state file |

### `POST /recording/stop` (extended validation)

**Request:**

```json
{ "recordingId": "courtvision-20260701-120000-a1b2c3d4" }
```

**Success (HTTP 200) — only after stable file + validation:**

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
    "videoStreamCount": 1,
    "passed": true
  },
  "cameraState": "IDLE"
}
```

**Timeout auto-stop (HTTP 200):**

```json
{
  "success": true,
  "timedOut": true,
  "message": "Recording stopped automatically after reaching maximum duration of 600 seconds.",
  "fileSize": 1234567,
  "validation": { "passed": true }
}
```

**Failure examples (HTTP 500):**

```json
{ "success": false, "message": "No recording is in progress." }
```

```json
{ "success": false, "message": "Recording duration mismatch: recorded 5.12s but MP4 duration is 1.20s (tolerance 3.0s)." }
```

```json
{ "success": false, "message": "Recording MP4 must contain exactly one video stream, found 0." }
```

### `GET /debug/processes`

```json
{
  "success": true,
  "rpicamVidPids": [1234],
  "ffmpegPids": [1235],
  "processRegistry": {
    "recordingId": "courtvision-20260701-120000-a1b2c3d4",
    "cameraPid": 1234,
    "ffmpegPid": 1235
  },
  "recordingActive": true,
  "cameraState": "RECORDING",
  "managedProcessesRunning": true,
  "expectedProcessCount": 2,
  "actualProcessCount": 2,
  "recordingStateConsistent": true
}
```

While idle after stop: `rpicamVidPids: []`, `ffmpegPids: []`, `expectedProcessCount: 0`, `recordingStateConsistent: true`.

### `GET /recordings/<filename>` (unchanged; logs download size)

### `DELETE /recordings/<filename>` (unchanged; logs cleanup result)

## Validation logic

### Start

1. No active recording / not finalizing
2. Camera not busy
3. Camera detected (`verify_camera_available`)
4. `/tmp` free ≥ minimum
5. Commands available
6. `begin_recording()` — only after steps 1–5
7. Start `rpicam-vid` → verify alive 250 ms → start `ffmpeg`
8. Sleep 2s → both processes alive
9. Persist PIDs to `/tmp/courtvision-active-recording.json`
10. Start max-duration timer

### Stop

1. Terminate `rpicam-vid`, close `ffmpeg` stdin, wait for `ffmpeg`
2. `wait_for_file_stable()` — size unchanged for 3 consecutive checks (0.5s interval)
3. `validate_mp4()`:
   - **Always:** file exists, size > 0
   - **With ffprobe:** duration > 0, exactly 1 video stream (`codec_type=video`)
   - **Without ffprobe:** size > 100 KB, `validation.warning`, still `passed: true`
4. `verify_recording_duration()` — `|wall_clock - mp4_duration| ≤ tolerance` (skipped without ffprobe)
5. Return `downloadUrl` only after steps 2–4 pass

### Download (app)

1. Download with retries (default 3)
2. Remove partial local file before each retry
3. Local size > 0
4. Local size === backend `fileSize`
5. On failure: Pi file **not** deleted; tap Stop again to retry download

### Cleanup (app → Pi)

Delete Pi file only when **all** true:

- download succeeded
- local file exists
- local size > 0
- local size === backend `fileSize`

## Logging (backend)

| Event | Log line pattern |
|-------|------------------|
| Camera detected | `Camera detected via rpicam-hello` |
| Free storage | `Free storage in /tmp: N bytes` |
| Recording start | `Recording started id=... started_at=... camera_pid=... ffmpeg_pid=... free_storage=...` |
| Recording stop | `Recording stopped id=... duration=... final_size=... validation=...` |
| File stabilized | `Recording file stabilized path=... size=...` |
| ffprobe pass | `ffprobe validation passed ... video_streams=1` |
| Download | `Download started/completed filename=... download_size=...` |
| Cleanup | `Cleanup result=success filename=...` |
| Orphan recovery | `Terminated orphan recording process ...` |

## Exact manual test plan

Replace `<pi-ip>`, `<recordingId>`, `<filename>` with live values.

### Step 1 — Start backend

```bash
cd /home/andy76/courtvision/backend && . .venv/bin/activate && PORT=5000 python app.py
```

```bash
curl -s http://<pi-ip>:5000/status
```

| Check | Expected |
|-------|----------|
| HTTP | 200 |
| `cameraState` | `IDLE` |
| `recordingActive` | `false` |
| App `recordingState` | `idle` |

### Step 2 — Record ~5 seconds

```bash
curl -s -X POST http://<pi-ip>:5000/recording/start
```

| Check | Expected |
|-------|----------|
| HTTP | 200 |
| `success` | `true` |
| `processesRunning` | `true` |
| `cameraState` | `RECORDING` |
| App `recordingState` | `recording` |
| Pi file | exists, growing |
| Logs | camera detected, free storage, PIDs |

Wait 5 seconds. `GET /status` → `recordingActive: true`.

### Step 2a — Camera not detected (optional negative test)

Disconnect camera or disable in `raspi-config`, then:

```bash
curl -s -X POST http://<pi-ip>:5000/recording/start
```

| Check | Expected |
|-------|----------|
| HTTP | 500 |
| `success` | `false` |
| `message` | `Raspberry Pi camera not detected.` |
| `recordingActive` | `false` |
| Pi processes | no `rpicam-vid` / `ffmpeg` recording pair |

### Step 2b — Camera busy (optional negative test)

Start a recording, then while it is active:

```bash
curl -s -X POST http://<pi-ip>:5000/recording/start
```

| Check | Expected |
|-------|----------|
| HTTP | 409 |
| `message` | `Raspberry Pi camera is busy.` |
| `cameraState` | `RECORDING` (first recording unaffected) |

### Step 3 — Stop

```bash
curl -s -X POST http://<pi-ip>:5000/recording/stop \
  -H 'Content-Type: application/json' \
  -d '{"recordingId":"<recordingId>"}'
```

| Check | Expected |
|-------|----------|
| HTTP | 200 |
| `fileSize` | `> 102400` |
| `recordingDurationSeconds` | `4`–`7` |
| `validation.passed` | `true` |
| `validation.videoStreamCount` | `1` (if ffprobe) |
| `validation.duration` | within 3s of `recordingDurationSeconds` |
| `cameraState` | `IDLE` |
| Pi file size | equals `fileSize`, stable |

### Step 4 — Download

```bash
curl -s -o /tmp/test.mp4 http://<pi-ip>:5000/recordings/<filename>
wc -c /tmp/test.mp4
```

| Check | Expected |
|-------|----------|
| HTTP | 200 |
| Downloaded bytes | `== fileSize` |
| App | no size-mismatch error |

### Step 5 — Save locally

| Check | Expected |
|-------|----------|
| Path | `<documents>/CourtVision/<filename>.mp4` |
| Local size | `== fileSize` |
| App `recordingState` | `idle` |

### Step 6 — Play locally

| Check | Expected |
|-------|----------|
| Player | loads saved URI, plays H.264 MP4 |

### Step 7 — Pi cleanup (automatic)

| Check | Expected |
|-------|----------|
| Pi file | deleted after verified local copy |
| Log | `Cleanup result=success` |

## Recovery test scenarios

### App restart during recording

1. Start recording on Pi
2. Force-quit Expo app
3. Reopen app

| Check | Expected |
|-------|----------|
| `GET /status` | `recordingActive: true`, `activeRecordingId` set |
| App | recovers to `recording` with correct `recordingId` |

### Interrupted download

1. Complete stop successfully
2. Simulate network drop during download

| Check | Expected |
|-------|----------|
| Pi file | still present |
| App | error mentions retry; tap Stop again to retry download |
| Local partial | removed before retry |

### Backend crash during recording

1. Start recording
2. `kill -9` Flask process

| Check | Expected |
|-------|----------|
| Restart backend | orphan PIDs terminated, `cameraState: IDLE` |
| Log | `Terminated orphan recording process` |

### Insufficient storage

1. Fill `/tmp` below minimum
2. `POST /recording/start`

| Check | Expected |
|-------|----------|
| HTTP | 500 |
| Message | `Insufficient storage on Raspberry Pi.` |

## Success criteria

Success is reported only when **all** stages pass:

1. Start checks (camera, storage, watchdog)
2. Stop + finalize + validate (including duration when ffprobe available)
3. Download size matches backend
4. Local save verified
5. Playback works
6. Pi cleanup only after verified local copy

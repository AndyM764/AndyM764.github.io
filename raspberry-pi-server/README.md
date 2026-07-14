# CourtVision2 Raspberry Pi Server

Minimal local testing server for CourtVision2.

## Setup

```bash
cd raspberry-pi-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

The server binds to `0.0.0.0` on port `5000`, so it is reachable from the Raspberry Pi network IP.

## Endpoints

```text
GET /status
```

Response:

```json
{
  "status": "ok"
}
```

```text
POST /data
```

Logs the received JSON to the terminal and returns:

```json
{
  "received": true
}
```

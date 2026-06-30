#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: ./deploy.sh <pi-user@pi-host> <remote-backend-dir>"
  echo "Example: ./deploy.sh andy76@192.168.1.50 ~/courtvision/backend"
  exit 1
fi

PI_TARGET="$1"
REMOTE_DIR="$2"
LOCAL_BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE_STAGE_DIR="${REMOTE_DIR}.staging-$(date +%s)"
HEALTH_TIMEOUT_SECONDS="${COURTVISION_DEPLOY_HEALTH_TIMEOUT:-20}"

echo "Validating local backend layout..."
python3 -m py_compile "${LOCAL_BACKEND_DIR}/app.py"

echo "Uploading staged backend to ${PI_TARGET}:${REMOTE_STAGE_DIR}"
ssh "${PI_TARGET}" "mkdir -p '${REMOTE_STAGE_DIR}'"
scp -r "${LOCAL_BACKEND_DIR}/." "${PI_TARGET}:${REMOTE_STAGE_DIR}/"

echo "Starting staged backend health check on Pi..."
ssh "${PI_TARGET}" bash <<EOF
set -euo pipefail
cd '${REMOTE_STAGE_DIR}'

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

PORT=5001 python app.py >/tmp/courtvision-deploy-health.log 2>&1 &
HEALTH_PID=\$!
trap 'kill "\$HEALTH_PID" >/dev/null 2>&1 || true' EXIT

for attempt in \$(seq 1 ${HEALTH_TIMEOUT_SECONDS}); do
  if curl -fsS http://127.0.0.1:5001/status >/tmp/courtvision-deploy-status.json; then
    if python3 - <<'PY'
import json
from pathlib import Path

payload = json.loads(Path("/tmp/courtvision-deploy-status.json").read_text())
required = {"status", "cameraState", "cameraStateConsistent"}
missing = required - set(payload)
if missing:
    raise SystemExit(f"missing status fields: {', '.join(sorted(missing))}")
if payload.get("status") != "ok":
    raise SystemExit("status endpoint did not return ok")
if payload.get("cameraState") not in {"IDLE", "PREVIEW", "RECORDING"}:
    raise SystemExit("camera lock state is invalid")
if payload.get("cameraStateConsistent") is not True:
    raise SystemExit("camera state consistency check failed")
PY
    then
      echo "Staged backend health check passed."
      exit 0
    fi
  fi
  sleep 1
done

echo "Staged backend health check failed."
cat /tmp/courtvision-deploy-health.log || true
exit 1
EOF

echo "Promoting staged backend to ${REMOTE_DIR}"
ssh "${PI_TARGET}" bash <<EOF
set -euo pipefail
mkdir -p '${REMOTE_DIR}'
cp -a '${REMOTE_STAGE_DIR}/.' '${REMOTE_DIR}/'
rm -rf '${REMOTE_STAGE_DIR}'
EOF

echo "Deployment complete. Restart the production backend on port 5000 when ready."

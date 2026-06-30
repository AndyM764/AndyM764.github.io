#!/usr/bin/env bash
# CourtVision V4 — one-command deploy (run from Mac)
#
# Usage:
#   ./deploy-courtvision-v4.sh
#   ./deploy-courtvision-v4.sh andy76@192.168.1.50
#
# Environment overrides:
#   COURTVISION_BACKEND_DIR   Local backend source (default: Mac path below)
#   COURTVISION_PI_TARGET     SSH target, e.g. andy76@192.168.1.50
#   COURTVISION_REMOTE_DIR    Remote install dir (default: ~/courtvision/backend)
#   COURTVISION_PORT          Flask port on Pi (default: 5000)
#   COURTVISION_DEPLOY_HEALTH_TIMEOUT  Seconds to wait for health (default: 30)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_MAC_BACKEND="/Users/andymannikum/CourtVisionV4/CourtVision.V3/backend"

LOCAL_BACKEND_DIR="${COURTVISION_BACKEND_DIR:-}"
if [[ -z "${LOCAL_BACKEND_DIR}" ]]; then
  if [[ -d "${DEFAULT_MAC_BACKEND}" ]]; then
    LOCAL_BACKEND_DIR="${DEFAULT_MAC_BACKEND}"
  else
    LOCAL_BACKEND_DIR="${SCRIPT_DIR}"
  fi
fi

PI_TARGET="${COURTVISION_PI_TARGET:-${1:-}}"
REMOTE_DIR="${COURTVISION_REMOTE_DIR:-~/courtvision/backend}"
PORT="${COURTVISION_PORT:-5000}"
HEALTH_TIMEOUT_SECONDS="${COURTVISION_DEPLOY_HEALTH_TIMEOUT:-30}"
VERIFY_SCRIPT="${SCRIPT_DIR}/verify-courtvision-v4.sh"

PASS=0
FAIL=0

log() {
  printf '[deploy] %s\n' "$*"
}

pass() {
  PASS=$((PASS + 1))
  printf '  PASS  %s\n' "$*"
}

fail() {
  FAIL=$((FAIL + 1))
  printf '  FAIL  %s\n' "$*" >&2
}

die() {
  fail "$*"
  exit 1
}

print_summary() {
  echo
  echo "========================================"
  if [[ "${FAIL}" -eq 0 ]]; then
    echo "DEPLOY: PASS (${PASS} checks)"
  else
    echo "DEPLOY: FAIL (${FAIL} failed, ${PASS} passed)"
  fi
  echo "========================================"
}

on_exit() {
  local exit_code=$?
  if [[ "${exit_code}" -ne 0 && "${FAIL}" -eq 0 ]]; then
    fail "deploy exited unexpectedly (code ${exit_code})"
  fi
  print_summary
  if [[ "${FAIL}" -gt 0 ]]; then
    exit 1
  fi
}

trap on_exit EXIT

if [[ -z "${PI_TARGET}" ]]; then
  echo "Usage: $0 <pi-user@pi-host>"
  echo
  echo "Or set COURTVISION_PI_TARGET=andy76@192.168.1.50"
  exit 1
fi

if [[ ! -f "${LOCAL_BACKEND_DIR}/app.py" ]]; then
  die "backend source not found at ${LOCAL_BACKEND_DIR}/app.py"
fi

if [[ ! -x "${VERIFY_SCRIPT}" ]]; then
  chmod +x "${VERIFY_SCRIPT}" 2>/dev/null || true
fi

log "Local backend: ${LOCAL_BACKEND_DIR}"
log "Pi target:     ${PI_TARGET}"
log "Remote dir:    ${REMOTE_DIR}"
log "Port:          ${PORT}"

log "Step 1/6 — validate local backend"
if python3 -m py_compile "${LOCAL_BACKEND_DIR}/app.py"; then
  pass "local app.py compiles"
else
  die "local app.py failed to compile"
fi

if [[ -f "${LOCAL_BACKEND_DIR}/app.py" ]] && grep -q 'camera_server' "${LOCAL_BACKEND_DIR}/app.py" 2>/dev/null; then
  die "forbidden camera_server reference in app.py"
fi
pass "single-backend source check"

log "Step 2/6 — test SSH connection"
if ssh -o BatchMode=yes -o ConnectTimeout=10 "${PI_TARGET}" 'echo connected' >/dev/null 2>&1; then
  pass "SSH connection to ${PI_TARGET}"
else
  die "cannot SSH to ${PI_TARGET}"
fi

REMOTE_STAGE_DIR="${REMOTE_DIR}.staging-$(date +%s)"

log "Step 3/6 — upload staged backend"
ssh "${PI_TARGET}" "mkdir -p '${REMOTE_STAGE_DIR}'"
if scp -r "${LOCAL_BACKEND_DIR}/." "${PI_TARGET}:${REMOTE_STAGE_DIR}/"; then
  pass "uploaded backend to staging directory"
else
  die "scp upload failed"
fi

log "Step 4/6 — health-check staged backend on port 5001"
if ssh "${PI_TARGET}" bash -s <<EOF
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
    python3 - <<'PY'
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
    exit 0
  fi
  sleep 1
done

echo "Staged health check timed out"
cat /tmp/courtvision-deploy-health.log || true
exit 1
EOF
then
  pass "staged backend health check"
else
  die "staged backend health check failed"
fi

log "Step 5/6 — promote backend and start Flask on port ${PORT}"
if ssh "${PI_TARGET}" bash -s <<EOF
set -euo pipefail

REMOTE_DIR='${REMOTE_DIR}'
REMOTE_STAGE_DIR='${REMOTE_STAGE_DIR}'
PORT='${PORT}'

mkdir -p "\${REMOTE_DIR}"
cp -a "\${REMOTE_STAGE_DIR}/." "\${REMOTE_DIR}/"
rm -rf "\${REMOTE_STAGE_DIR}"

cd "\${REMOTE_DIR}"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

# Stop any existing CourtVision backend on this port
if command -v fuser >/dev/null 2>&1; then
  fuser -k "\${PORT}/tcp" >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti tcp:"\${PORT}" | xargs -r kill >/dev/null 2>&1 || true
fi

if [[ -f /tmp/courtvision-backend.pid ]]; then
  old_pid=\$(cat /tmp/courtvision-backend.pid)
  kill "\${old_pid}" >/dev/null 2>&1 || true
fi

nohup env PORT="\${PORT}" python app.py >/tmp/courtvision-backend.log 2>&1 &
echo \$! >/tmp/courtvision-backend.pid

for attempt in \$(seq 1 ${HEALTH_TIMEOUT_SECONDS}); do
  if curl -fsS "http://127.0.0.1:\${PORT}/status" >/tmp/courtvision-backend-status.json; then
  python3 - <<'PY'
import json
from pathlib import Path

payload = json.loads(Path("/tmp/courtvision-backend-status.json").read_text())
if payload.get("status") != "ok":
    raise SystemExit("production /status did not return ok")
PY
    exit 0
  fi
  sleep 1
done

echo "Production backend failed to start"
cat /tmp/courtvision-backend.log || true
exit 1
EOF
then
  pass "promoted backend and started Flask"
else
  die "failed to start production Flask backend"
fi

log "Step 6/6 — run route verification from Mac"
PI_HOST="${PI_TARGET#*@}"
PI_BASE_URL="http://${PI_HOST}:${PORT}"

if [[ -x "${VERIFY_SCRIPT}" ]]; then
  if COURTVISION_PI_URL="${PI_BASE_URL}" "${VERIFY_SCRIPT}"; then
    pass "remote route verification"
  else
    die "remote route verification failed (see output above)"
  fi
else
  fail "verify script not found at ${VERIFY_SCRIPT}"
fi

log "Backend URL: ${PI_BASE_URL}"
log "Logs on Pi:  ssh ${PI_TARGET} 'tail -f /tmp/courtvision-backend.log'"

# print_summary called by trap

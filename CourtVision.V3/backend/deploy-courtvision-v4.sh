#!/usr/bin/env bash
# CourtVision V4 — one-command deploy (run from Mac)
#
# Usage:
#   ./deploy-courtvision-v4.sh
#   ./deploy-courtvision-v4.sh andy76@192.168.1.50
#
# Environment overrides:
#   COURTVISION_BACKEND_DIR              Local backend source
#   COURTVISION_PI_TARGET                SSH target, e.g. andy76@192.168.1.50
#   COURTVISION_REMOTE_DIR               Remote install dir (default: ~/courtvision/backend)
#   COURTVISION_PORT                     Flask port on Pi (default: 5000)
#   COURTVISION_DEPLOY_HEALTH_TIMEOUT    Seconds to wait for health (default: 30)
#   COURTVISION_AUTO_CONFIRM=y           Skip interactive confirmation prompt

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
LOCAL_BACKEND_DIR="$(cd "${LOCAL_BACKEND_DIR}" && pwd)"

PI_TARGET="${COURTVISION_PI_TARGET:-${1:-}}"
REMOTE_DIR="${COURTVISION_REMOTE_DIR:-~/courtvision/backend}"
PORT="${COURTVISION_PORT:-5000}"
HEALTH_TIMEOUT_SECONDS="${COURTVISION_DEPLOY_HEALTH_TIMEOUT:-30}"
AUTO_CONFIRM="${COURTVISION_AUTO_CONFIRM:-}"
VERIFY_SCRIPT="${SCRIPT_DIR}/verify-courtvision-v4.sh"

PASS=0
FAIL=0

log() {
  printf '[deploy] %s\n' "$*"
}

pass() {
  PASS=$((PASS + 1))
  printf 'PASS: %s\n' "$*"
}

fail() {
  FAIL=$((FAIL + 1))
  printf 'FAIL: %s\n' "$*" >&2
}

fail_with_details() {
  local label="$1"
  local endpoint="$2"
  local http_status="$3"
  local response_body="$4"
  FAIL=$((FAIL + 1))
  printf 'FAIL: %s\n' "${label}" >&2
  printf '  endpoint: %s\n' "${endpoint}" >&2
  printf '  HTTP status: %s\n' "${http_status}" >&2
  printf '  response body: %s\n' "${response_body}" >&2
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

echo "CourtVision V4 deployment plan"
echo "=============================="
echo "Backend directory: ${LOCAL_BACKEND_DIR}"
echo "Pi target:         ${PI_TARGET}"
echo "Remote directory:  ${REMOTE_DIR}"
echo "Flask port:        ${PORT}"
echo

if [[ "${AUTO_CONFIRM}" != "y" && "${AUTO_CONFIRM}" != "Y" ]]; then
  read -r -p "Continue? (y/n) " confirm
  if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
    echo "Deployment cancelled."
    exit 0
  fi
fi

echo

log "Step 1/7 — validate local backend"
if python3 -m py_compile "${LOCAL_BACKEND_DIR}/app.py"; then
  pass "local app.py compiles"
else
  die "local app.py failed to compile"
fi

if grep -q 'camera_server' "${LOCAL_BACKEND_DIR}/app.py" 2>/dev/null; then
  die "forbidden camera_server reference in app.py"
fi
pass "single-backend source check"

log "Step 2/7 — test SSH connection"
if ssh -o BatchMode=yes -o ConnectTimeout=10 "${PI_TARGET}" 'echo connected' >/dev/null 2>&1; then
  pass "SSH connection to ${PI_TARGET}"
else
  fail_with_details \
    "SSH connection" \
    "ssh ${PI_TARGET}" \
    "unavailable" \
  "$(ssh -o BatchMode=yes -o ConnectTimeout=10 "${PI_TARGET}" 'echo connected' 2>&1 || true)"
  exit 1
fi

REMOTE_STAGE_DIR="${REMOTE_DIR}.staging-$(date +%s)"
BACKUP_DIR="~/courtvision-backup-$(date +%Y%m%d-%H%M%S)"

log "Step 3/7 — upload staged backend"
ssh "${PI_TARGET}" "mkdir -p '${REMOTE_STAGE_DIR}'"
if scp -r "${LOCAL_BACKEND_DIR}/." "${PI_TARGET}:${REMOTE_STAGE_DIR}/"; then
  pass "uploaded backend to staging directory"
else
  fail_with_details \
    "backend upload" \
    "scp ${LOCAL_BACKEND_DIR}/. -> ${PI_TARGET}:${REMOTE_STAGE_DIR}/" \
    "failed" \
    "scp command failed"
  exit 1
fi

log "Step 4/7 — health-check staged backend on port 5001"
STAGED_HEALTH_OUTPUT="$(ssh "${PI_TARGET}" bash -s <<EOF
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
  HTTP_CODE=\$(curl -sS -m 5 -o /tmp/courtvision-deploy-status.json -w '%{http_code}' http://127.0.0.1:5001/status || true)
  if [[ "\${HTTP_CODE}" == "200" ]]; then
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
    echo "STAGED_HEALTH_OK"
    cat /tmp/courtvision-deploy-status.json
    exit 0
  fi
  sleep 1
done

echo "STAGED_HEALTH_FAIL"
echo "endpoint: GET http://127.0.0.1:5001/status"
echo "HTTP status: \${HTTP_CODE:-timeout}"
echo "response body: \$(cat /tmp/courtvision-deploy-status.json 2>/dev/null || echo '<empty>')"
echo "process log:"
cat /tmp/courtvision-deploy-health.log 2>/dev/null || true
exit 1
EOF
)" || true

if grep -q '^STAGED_HEALTH_OK$' <<<"${STAGED_HEALTH_OUTPUT}"; then
  pass "staged backend health check"
else
  STAGED_STATUS="$(echo "${STAGED_HEALTH_OUTPUT}" | sed -n 's/^HTTP status: //p' | head -n1)"
  STAGED_BODY="$(echo "${STAGED_HEALTH_OUTPUT}" | sed -n 's/^response body: //p' | head -n1)"
  if [[ -z "${STAGED_STATUS}" ]]; then
    STAGED_STATUS="failed"
    STAGED_BODY="${STAGED_HEALTH_OUTPUT}"
  fi
  fail_with_details \
    "staged backend health check" \
    "GET http://127.0.0.1:5001/status" \
    "${STAGED_STATUS}" \
    "${STAGED_BODY}"
  exit 1
fi

log "Step 5/7 — backup existing backend and promote staged build"
PROMOTE_OUTPUT="$(ssh "${PI_TARGET}" bash -s <<EOF
set -euo pipefail

REMOTE_DIR='${REMOTE_DIR}'
REMOTE_STAGE_DIR='${REMOTE_STAGE_DIR}'
BACKUP_DIR='${BACKUP_DIR}'

if [[ -d "\${REMOTE_DIR}" ]]; then
  cp -a "\${REMOTE_DIR}" "\${BACKUP_DIR}"
  echo "BACKUP_CREATED \${BACKUP_DIR}"
else
  echo "BACKUP_SKIPPED no existing backend"
fi

mkdir -p "\${REMOTE_DIR}"
cp -a "\${REMOTE_STAGE_DIR}/." "\${REMOTE_DIR}/"
rm -rf "\${REMOTE_STAGE_DIR}"
echo "PROMOTE_OK"
EOF
)" || {
  fail_with_details \
    "backend promotion" \
    "ssh ${PI_TARGET} promote ${REMOTE_DIR}" \
    "failed" \
    "${PROMOTE_OUTPUT:-unknown error}"
  exit 1
}

if grep -q '^BACKUP_CREATED ' <<<"${PROMOTE_OUTPUT}"; then
  BACKUP_PATH="$(echo "${PROMOTE_OUTPUT}" | awk '/^BACKUP_CREATED /{print $2}')"
  pass "backup created at ${BACKUP_PATH}"
elif grep -q '^BACKUP_SKIPPED ' <<<"${PROMOTE_OUTPUT}"; then
  pass "no existing backend to backup"
else
  fail_with_details \
    "backend backup" \
    "ssh ${PI_TARGET} backup ${REMOTE_DIR}" \
    "failed" \
    "${PROMOTE_OUTPUT}"
  exit 1
fi

pass "promoted staged backend to ${REMOTE_DIR}"

log "Step 6/7 — start Flask on port ${PORT}"
START_OUTPUT="$(ssh "${PI_TARGET}" bash -s <<EOF
set -euo pipefail

REMOTE_DIR='${REMOTE_DIR}'
PORT='${PORT}'

cd "\${REMOTE_DIR}"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

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
  HTTP_CODE=\$(curl -sS -m 5 -o /tmp/courtvision-backend-status.json -w '%{http_code}' "http://127.0.0.1:\${PORT}/status" || true)
  if [[ "\${HTTP_CODE}" == "200" ]]; then
    python3 - <<'PY'
import json
from pathlib import Path

payload = json.loads(Path("/tmp/courtvision-backend-status.json").read_text())
if payload.get("status") != "ok":
    raise SystemExit("production /status did not return ok")
PY
    echo "FLASK_STARTED_OK"
    cat /tmp/courtvision-backend-status.json
    exit 0
  fi
  sleep 1
done

echo "FLASK_STARTED_FAIL"
echo "endpoint: GET http://127.0.0.1:\${PORT}/status"
echo "HTTP status: \${HTTP_CODE:-timeout}"
echo "response body: \$(cat /tmp/courtvision-backend-status.json 2>/dev/null || echo '<empty>')"
echo "process log:"
cat /tmp/courtvision-backend.log 2>/dev/null || true
exit 1
EOF
)" || true

if grep -q '^FLASK_STARTED_OK$' <<<"${START_OUTPUT}"; then
  pass "Flask started on port ${PORT}"
else
  START_STATUS="$(echo "${START_OUTPUT}" | sed -n 's/^HTTP status: //p' | head -n1)"
  START_BODY="$(echo "${START_OUTPUT}" | sed -n 's/^response body: //p' | head -n1)"
  if [[ -z "${START_STATUS}" ]]; then
    START_STATUS="failed"
    START_BODY="${START_OUTPUT}"
  fi
  fail_with_details \
    "Flask started" \
    "GET http://${PI_TARGET#*@}:${PORT}/status" \
    "${START_STATUS}" \
    "${START_BODY}"
  exit 1
fi

log "Step 7/7 — run route verification from Mac"
PI_HOST="${PI_TARGET#*@}"
PI_BASE_URL="http://${PI_HOST}:${PORT}"

if [[ -x "${VERIFY_SCRIPT}" ]]; then
  if COURTVISION_PI_URL="${PI_BASE_URL}" COURTVISION_SKIP_FLASK_CHECK=1 "${VERIFY_SCRIPT}"; then
    pass "remote route verification"
  else
    fail_with_details \
      "remote route verification" \
      "${PI_BASE_URL}" \
      "failed" \
      "see VERIFY output above"
    exit 1
  fi
else
  fail_with_details \
    "verify script" \
    "${VERIFY_SCRIPT}" \
    "missing" \
    "verify-courtvision-v4.sh not found or not executable"
  exit 1
fi

echo
log "Backend URL: ${PI_BASE_URL}"
if grep -q '^BACKUP_CREATED ' <<<"${PROMOTE_OUTPUT}"; then
  log "Rollback backup: ssh ${PI_TARGET} 'ls -d ${BACKUP_PATH}'"
fi
log "Logs on Pi: ssh ${PI_TARGET} 'tail -f /tmp/courtvision-backend.log'"

#!/usr/bin/env bash
# CourtVision V4 — one-command deploy (run from Mac)
#
# Usage:
#   ./deploy.sh andy76@<pi-ip>
#
# Raspberry Pi OS Bookworm (PEP 668): all Python packages install into
# /home/andy76/courtvision/backend/.venv — never system Python.
#
# Environment overrides:
#   COURTVISION_AUTO_CONFIRM=y   Skip interactive confirmation prompt
#   COURTVISION_SSH_DEBUG=1        Print SSH auth method trace (ssh -v)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_BACKEND_DIR="${SCRIPT_DIR}"

PI_TARGET="${1:-}"
REMOTE_DIR="/home/andy76/courtvision/backend"
REMOTE_VENV="${REMOTE_DIR}/.venv"
REMOTE_PYTHON="${REMOTE_VENV}/bin/python"
PORT="5000"
HEALTH_TIMEOUT_SECONDS="${COURTVISION_DEPLOY_HEALTH_TIMEOUT:-30}"
AUTO_CONFIRM="${COURTVISION_AUTO_CONFIRM:-}"
SSH_DEBUG="${COURTVISION_SSH_DEBUG:-}"
VERIFY_SCRIPT="${SCRIPT_DIR}/verify.sh"

DEPLOY_RESULT="PASS"
VERIFY_RESULT="PASS"
BACKUP_PATH=""
ROLLBACK_CMD=""

log() {
  printf '[deploy] %s\n' "$*"
}

warn() {
  printf 'WARN: %s\n' "$*"
}

pi_ssh_print_config() {
  log "SSH effective configuration for ${PI_TARGET}:"
  ssh -G "${PI_TARGET}" 2>/dev/null | grep -iE '^(user |hostname |port |identityfile |preferredauthentications |pubkeyauthentication |passwordauthentication |kbdinteractiveauthentication |batchmode )' || true
}

pi_ssh_print_auth_trace() {
  local trace_file="$1"
  log "SSH authentication trace:"
  grep -iE 'authenticat|Offering|Trying|publickey|password|keyboard-interactive|identity file|Agent|Permission denied|Authenticated to' "${trace_file}" \
    || cat "${trace_file}"
}

# Uses the same ssh invocation as a manual terminal session (no BatchMode).
pi_ssh() {
  if [[ "${SSH_DEBUG}" == "1" ]]; then
    pi_ssh_print_config
    log "SSH command: ssh ${PI_TARGET} $*"
    local trace_file
    trace_file="$(mktemp)"
    if ssh -v "${PI_TARGET}" "$@" 2>"${trace_file}"; then
      pi_ssh_print_auth_trace "${trace_file}"
      rm -f "${trace_file}"
      return 0
    fi
    pi_ssh_print_auth_trace "${trace_file}"
    rm -f "${trace_file}"
    return 1
  fi

  ssh "${PI_TARGET}" "$@"
}

pi_ssh_bash() {
  if [[ "${SSH_DEBUG}" == "1" ]]; then
    pi_ssh_print_config
    log "SSH command: ssh ${PI_TARGET} bash -s"
  fi
  ssh "${PI_TARGET}" bash -s
}

pi_scp() {
  if [[ "${SSH_DEBUG}" == "1" ]]; then
    log "SCP command: scp -v $*"
    scp -v "$@"
    return $?
  fi

  scp "$@"
}

fail_deploy() {
  DEPLOY_RESULT="FAIL"
  local label="$1"
  local endpoint="$2"
  local http_status="$3"
  local response_body="$4"
  printf 'FAIL: %s\n' "${label}" >&2
  printf '  endpoint: %s\n' "${endpoint}" >&2
  printf '  HTTP status: %s\n' "${http_status}" >&2
  printf '  response body: %s\n' "${response_body}" >&2
}

print_final_summary() {
  echo
  echo "========================================"
  echo "DEPLOY: ${DEPLOY_RESULT}"
  echo "VERIFY: ${VERIFY_RESULT}"
  echo "========================================"
  if [[ -n "${ROLLBACK_CMD}" ]]; then
    echo "Rollback:"
    echo "  ${ROLLBACK_CMD}"
  fi
}

on_exit() {
  print_final_summary
  if [[ "${DEPLOY_RESULT}" == "FAIL" || "${VERIFY_RESULT}" == "FAIL" ]]; then
    exit 1
  fi
}

trap on_exit EXIT

if [[ -z "${PI_TARGET}" ]]; then
  echo "Usage: $0 <pi-user@pi-host>"
  echo "Example: $0 andy76@192.168.1.50"
  exit 1
fi

if [[ ! -f "${LOCAL_BACKEND_DIR}/app.py" ]]; then
  fail_deploy "local backend" "${LOCAL_BACKEND_DIR}/app.py" "missing" "app.py not found"
  exit 1
fi

chmod +x "${VERIFY_SCRIPT}" 2>/dev/null || true

echo "CourtVision V4 deployment"
echo "========================="
echo "Backend directory: ${LOCAL_BACKEND_DIR}"
echo "Pi target:         ${PI_TARGET}"
echo "Remote directory:  ${REMOTE_DIR}"
echo "Port:              ${PORT}"
echo

if [[ "${AUTO_CONFIRM}" != "y" && "${AUTO_CONFIRM}" != "Y" ]]; then
  read -r -p "Continue? (y/n) " confirm
  if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
    echo "Deployment cancelled."
    trap - EXIT
    exit 0
  fi
fi

echo

log "Validate local backend"
if ! python3 -m py_compile "${LOCAL_BACKEND_DIR}/app.py"; then
  fail_deploy "local app.py compile" "${LOCAL_BACKEND_DIR}/app.py" "failed" "python compile error"
  exit 1
fi

log "Single-backend layout check"
if [[ -f "${LOCAL_BACKEND_DIR}/camera_server.py" ]]; then
  fail_deploy \
    "single-backend check" \
    "${LOCAL_BACKEND_DIR}/camera_server.py" \
    "forbidden" \
    "legacy camera_server.py must not exist; use backend/app.py only"
  exit 1
fi

LEGACY_BACKEND_FILE="$(find "${LOCAL_BACKEND_DIR}/.." -maxdepth 4 -name 'camera_server.py' \
  -not -path '*/node_modules/*' \
  -not -path '*/.venv/*' \
  -not -path '*/.git/*' \
  2>/dev/null | head -n1 || true)"
if [[ -n "${LEGACY_BACKEND_FILE}" ]]; then
  fail_deploy \
    "single-backend check" \
    "${LEGACY_BACKEND_FILE}" \
    "forbidden" \
    "legacy camera_server.py must not exist; use backend/app.py only"
  exit 1
fi

log "Test SSH connection"
SSH_TEST_ERR="$(mktemp)"
if ! pi_ssh 'echo connected' 2>"${SSH_TEST_ERR}"; then
  fail_deploy \
    "SSH connection" \
    "ssh ${PI_TARGET}" \
    "failed" \
    "$(cat "${SSH_TEST_ERR}")"
  rm -f "${SSH_TEST_ERR}"
  exit 1
fi
rm -f "${SSH_TEST_ERR}"

log "Check ffprobe on Pi (warning only)"
if pi_ssh 'command -v ffprobe >/dev/null 2>&1'; then
  log "ffprobe is installed on Pi"
else
  warn "ffprobe is not installed on Pi — recording validation will use file size only"
fi

REMOTE_STAGE_DIR="/home/andy76/courtvision/backend.staging-$(date +%s)"
BACKUP_DIR="/home/andy76/courtvision-backup-$(date +%Y%m%d-%H%M%S)"

log "Upload staged backend"
pi_ssh "mkdir -p '${REMOTE_STAGE_DIR}'"
if ! pi_scp -r "${LOCAL_BACKEND_DIR}/." "${PI_TARGET}:${REMOTE_STAGE_DIR}/"; then
  fail_deploy \
    "backend upload" \
    "scp ${LOCAL_BACKEND_DIR}/. -> ${PI_TARGET}:${REMOTE_STAGE_DIR}/" \
    "failed" \
    "scp command failed"
  exit 1
fi

log "Health-check staged backend on port 5001"
STAGED_HEALTH_OUTPUT="$(pi_ssh_bash <<EOF
set -euo pipefail
cd '${REMOTE_STAGE_DIR}'

setup_venv() {
  local work_dir="\$1"
  cd "\${work_dir}"

  if [[ ! -d .venv ]]; then
    echo "[deploy-remote] Creating virtual environment at \${work_dir}/.venv"
    if ! python3 -m venv .venv; then
      echo "VENV_CREATE_FAIL"
      exit 1
    fi
    echo "VENV_CREATED"
  else
    echo "VENV_EXISTS"
  fi

  # shellcheck disable=SC1091
  source .venv/bin/activate

  echo "PYTHON_WHICH=\$(which python)"
  echo "PYTHON_VERSION=\$(python --version 2>&1)"
  echo "PIP_VERSION=\$(pip --version 2>&1)"

  if ! python -m pip install --upgrade pip; then
    echo "PIP_UPGRADE_FAIL"
    exit 1
  fi
  echo "PIP_UPGRADE_OK"

  if ! pip install -r requirements.txt; then
    echo "REQUIREMENTS_INSTALL_FAIL"
    exit 1
  fi
  echo "REQUIREMENTS_INSTALL_OK"
}

setup_venv '${REMOTE_STAGE_DIR}'

VENV_PYTHON='${REMOTE_STAGE_DIR}/.venv/bin/python'
PORT=5001 "\${VENV_PYTHON}" app.py >/tmp/courtvision-deploy-health.log 2>&1 &
HEALTH_PID=\$!
trap 'kill "\$HEALTH_PID" >/dev/null 2>&1 || true' EXIT

for attempt in \$(seq 1 ${HEALTH_TIMEOUT_SECONDS}); do
  HTTP_CODE=\$(curl -sS -m 5 -o /tmp/courtvision-deploy-status.json -w '%{http_code}' http://127.0.0.1:5001/status || true)
  if [[ "\${HTTP_CODE}" == "200" ]]; then
    "\${VENV_PYTHON}" - <<'PY'
import json
from pathlib import Path

payload = json.loads(Path("/tmp/courtvision-deploy-status.json").read_text())
if payload.get("status") != "ok":
    raise SystemExit("status endpoint did not return ok")
if payload.get("cameraState") not in {"IDLE", "PREVIEW", "RECORDING"}:
    raise SystemExit("cameraState invalid")
if payload.get("cameraStateConsistent") is not True:
    raise SystemExit("cameraStateConsistent is not true")
PY
    echo "STAGED_HEALTH_OK"
    exit 0
  fi
  sleep 1
done

echo "STAGED_HEALTH_FAIL"
echo "HTTP status: \${HTTP_CODE:-timeout}"
echo "response body: \$(cat /tmp/courtvision-deploy-status.json 2>/dev/null || echo '<empty>')"
cat /tmp/courtvision-deploy-health.log 2>/dev/null || true
exit 1
EOF
)" || true

if grep -q '^VENV_CREATE_FAIL$' <<<"${STAGED_HEALTH_OUTPUT}"; then
  fail_deploy \
    "virtual environment creation" \
    "python3 -m venv ${REMOTE_STAGE_DIR}/.venv" \
    "failed" \
    "$(echo "${STAGED_HEALTH_OUTPUT}" | tail -n 20)"
  exit 1
fi

if grep -q '^PIP_UPGRADE_FAIL$' <<<"${STAGED_HEALTH_OUTPUT}"; then
  fail_deploy \
    "pip upgrade" \
    "python -m pip install --upgrade pip" \
    "failed" \
    "$(echo "${STAGED_HEALTH_OUTPUT}" | tail -n 20)"
  exit 1
fi

if grep -q '^REQUIREMENTS_INSTALL_FAIL$' <<<"${STAGED_HEALTH_OUTPUT}"; then
  fail_deploy \
    "requirements installation" \
    "pip install -r requirements.txt" \
    "failed" \
    "$(echo "${STAGED_HEALTH_OUTPUT}" | tail -n 20)"
  exit 1
fi

while IFS= read -r line; do
  case "${line}" in
    PYTHON_WHICH=*|PYTHON_VERSION=*|PIP_VERSION=*|VENV_*|PIP_*|REQUIREMENTS_*)
      log "${line}"
      ;;
  esac
done <<<"${STAGED_HEALTH_OUTPUT}"

if ! grep -q '^STAGED_HEALTH_OK$' <<<"${STAGED_HEALTH_OUTPUT}"; then
  fail_deploy \
    "staged backend health check" \
    "GET http://127.0.0.1:5001/status" \
    "$(echo "${STAGED_HEALTH_OUTPUT}" | sed -n 's/^HTTP status: //p' | head -n1 || echo failed)" \
    "$(echo "${STAGED_HEALTH_OUTPUT}" | sed -n 's/^response body: //p' | head -n1 || echo "${STAGED_HEALTH_OUTPUT}")"
  exit 1
fi

log "Backup existing backend and promote staged build"
PROMOTE_OUTPUT="$(pi_ssh_bash <<EOF
set -euo pipefail

REMOTE_DIR='${REMOTE_DIR}'
REMOTE_STAGE_DIR='${REMOTE_STAGE_DIR}'
BACKUP_DIR='${BACKUP_DIR}'

mkdir -p /home/andy76/courtvision

if [[ -d "\${REMOTE_DIR}" ]]; then
  cp -a "\${REMOTE_DIR}" "\${BACKUP_DIR}"
  echo "BACKUP_CREATED \${BACKUP_DIR}"
else
  echo "BACKUP_SKIPPED"
fi

mkdir -p "\${REMOTE_DIR}"
cp -a "\${REMOTE_STAGE_DIR}/." "\${REMOTE_DIR}/"
rm -rf "\${REMOTE_DIR}/.venv"
rm -rf "\${REMOTE_STAGE_DIR}"
echo "PROMOTE_OK"
EOF
)" || {
  fail_deploy \
    "backend promotion" \
    "ssh ${PI_TARGET}" \
    "failed" \
    "${PROMOTE_OUTPUT:-unknown error}"
  exit 1
}

if grep -q '^BACKUP_CREATED ' <<<"${PROMOTE_OUTPUT}"; then
  BACKUP_PATH="$(echo "${PROMOTE_OUTPUT}" | awk '/^BACKUP_CREATED /{print $2}')"
  ROLLBACK_CMD="ssh ${PI_TARGET} 'rm -rf ${REMOTE_DIR} && cp -a ${BACKUP_PATH} ${REMOTE_DIR} && fuser -k ${PORT}/tcp 2>/dev/null || true; PORT=${PORT} nohup ${REMOTE_PYTHON} ${REMOTE_DIR}/app.py >/tmp/courtvision-backend.log 2>&1 &'"
fi

log "Stop old backend and start Flask on port ${PORT}"
START_OUTPUT="$(pi_ssh_bash <<EOF
set -euo pipefail

REMOTE_DIR='${REMOTE_DIR}'
REMOTE_PYTHON='${REMOTE_PYTHON}'
PORT='${PORT}'

cd "\${REMOTE_DIR}"

setup_venv() {
  local work_dir="\$1"
  cd "\${work_dir}"

  if [[ ! -d .venv ]]; then
    echo "[deploy-remote] Creating virtual environment at \${work_dir}/.venv"
    if ! python3 -m venv .venv; then
      echo "VENV_CREATE_FAIL"
      exit 1
    fi
    echo "VENV_CREATED"
  else
    echo "VENV_EXISTS"
  fi

  # shellcheck disable=SC1091
  source .venv/bin/activate

  echo "PYTHON_WHICH=\$(which python)"
  echo "PYTHON_VERSION=\$(python --version 2>&1)"
  echo "PIP_VERSION=\$(pip --version 2>&1)"

  if ! python -m pip install --upgrade pip; then
    echo "PIP_UPGRADE_FAIL"
    exit 1
  fi
  echo "PIP_UPGRADE_OK"

  if ! pip install -r requirements.txt; then
    echo "REQUIREMENTS_INSTALL_FAIL"
    exit 1
  fi
  echo "REQUIREMENTS_INSTALL_OK"
}

setup_venv "\${REMOTE_DIR}"

if [[ ! -x "\${REMOTE_PYTHON}" ]]; then
  echo "VENV_PYTHON_MISSING"
  exit 1
fi

if command -v fuser >/dev/null 2>&1; then
  fuser -k "\${PORT}/tcp" >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti tcp:"\${PORT}" | xargs -r kill >/dev/null 2>&1 || true
fi

if [[ -f /tmp/courtvision-backend.pid ]]; then
  old_pid=\$(cat /tmp/courtvision-backend.pid)
  kill "\${old_pid}" >/dev/null 2>&1 || true
fi

nohup env PORT="\${PORT}" "\${REMOTE_PYTHON}" "\${REMOTE_DIR}/app.py" >/tmp/courtvision-backend.log 2>&1 &
echo \$! >/tmp/courtvision-backend.pid

for attempt in \$(seq 1 ${HEALTH_TIMEOUT_SECONDS}); do
  HTTP_CODE=\$(curl -sS -m 5 -o /tmp/courtvision-backend-status.json -w '%{http_code}' "http://127.0.0.1:\${PORT}/status" || true)
  if [[ "\${HTTP_CODE}" == "200" ]]; then
    "\${REMOTE_PYTHON}" - <<'PY'
import json
from pathlib import Path

payload = json.loads(Path("/tmp/courtvision-backend-status.json").read_text())
if payload.get("status") != "ok":
    raise SystemExit("production /status did not return ok")
PY
    echo "FLASK_STARTED_OK"
    exit 0
  fi
  sleep 1
done

echo "FLASK_STARTED_FAIL"
echo "HTTP status: \${HTTP_CODE:-timeout}"
echo "response body: \$(cat /tmp/courtvision-backend-status.json 2>/dev/null || echo '<empty>')"
cat /tmp/courtvision-backend.log 2>/dev/null || true
exit 1
EOF
)" || true

if grep -q '^VENV_CREATE_FAIL$' <<<"${START_OUTPUT}"; then
  fail_deploy \
    "virtual environment creation" \
    "python3 -m venv ${REMOTE_VENV}" \
    "failed" \
    "$(echo "${START_OUTPUT}" | tail -n 20)"
  exit 1
fi

if grep -q '^VENV_PYTHON_MISSING$' <<<"${START_OUTPUT}"; then
  fail_deploy \
    "virtual environment python" \
    "${REMOTE_PYTHON}" \
    "missing" \
    "venv python binary not found or not executable"
  exit 1
fi

if grep -q '^PIP_UPGRADE_FAIL$' <<<"${START_OUTPUT}"; then
  fail_deploy \
    "pip upgrade" \
    "python -m pip install --upgrade pip" \
    "failed" \
    "$(echo "${START_OUTPUT}" | tail -n 20)"
  exit 1
fi

if grep -q '^REQUIREMENTS_INSTALL_FAIL$' <<<"${START_OUTPUT}"; then
  fail_deploy \
    "requirements installation" \
    "pip install -r requirements.txt" \
    "failed" \
    "$(echo "${START_OUTPUT}" | tail -n 20)"
  exit 1
fi

while IFS= read -r line; do
  case "${line}" in
    PYTHON_WHICH=*|PYTHON_VERSION=*|PIP_VERSION=*|VENV_*|PIP_*|REQUIREMENTS_*)
      log "${line}"
      ;;
  esac
done <<<"${START_OUTPUT}"

if ! grep -q '^FLASK_STARTED_OK$' <<<"${START_OUTPUT}"; then
  fail_deploy \
    "Flask production start" \
    "GET http://${PI_TARGET#*@}:${PORT}/status" \
    "$(echo "${START_OUTPUT}" | sed -n 's/^HTTP status: //p' | head -n1 || echo failed)" \
    "$(echo "${START_OUTPUT}" | sed -n 's/^response body: //p' | head -n1 || echo "${START_OUTPUT}")"
  exit 1
fi

log "Run verification"
PI_HOST="${PI_TARGET#*@}"
PI_BASE_URL="http://${PI_HOST}:${PORT}"

if [[ -x "${VERIFY_SCRIPT}" ]]; then
  if ! COURTVISION_PI_URL="${PI_BASE_URL}" "${VERIFY_SCRIPT}"; then
    VERIFY_RESULT="FAIL"
    exit 1
  fi
else
  VERIFY_RESULT="FAIL"
  fail_deploy \
    "verify script" \
    "${VERIFY_SCRIPT}" \
    "missing" \
    "verify.sh not found or not executable"
  exit 1
fi

echo
log "Backend URL: ${PI_BASE_URL}"
log "Pi logs: ssh ${PI_TARGET} 'tail -f /tmp/courtvision-backend.log'"

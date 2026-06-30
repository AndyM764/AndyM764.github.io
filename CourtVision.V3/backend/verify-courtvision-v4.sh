#!/usr/bin/env bash
# CourtVision V4 — route verification (run from Mac or Pi)
#
# Usage:
#   ./verify-courtvision-v4.sh
#   ./verify-courtvision-v4.sh http://192.168.1.50:5000
#
# Environment overrides:
#   COURTVISION_PI_URL            Base URL (default: http://127.0.0.1:5000)
#   COURTVISION_VERIFY_TIMEOUT    Per-request timeout seconds (default: 10)
#   COURTVISION_SKIP_FLASK_CHECK  Set to 1 to skip Flask reachability check

set -euo pipefail

BASE_URL="${COURTVISION_PI_URL:-${1:-http://127.0.0.1:5000}}"
BASE_URL="${BASE_URL%/}"
TIMEOUT_SECONDS="${COURTVISION_VERIFY_TIMEOUT:-10}"
SKIP_FLASK_CHECK="${COURTVISION_SKIP_FLASK_CHECK:-0}"

PASS=0
FAIL=0
RECORDING_ID=""
RESPONSE_FILE=""
LAST_METHOD=""
LAST_ENDPOINT=""

log() {
  printf '[verify] %s\n' "$*"
}

pass_item() {
  PASS=$((PASS + 1))
  printf 'PASS: %s\n' "$*"
}

fail_item() {
  FAIL=$((FAIL + 1))
  local label="$1"
  printf 'FAIL: %s\n' "${label}" >&2
  printf '  endpoint: %s %s%s\n' "${LAST_METHOD}" "${BASE_URL}" "${LAST_ENDPOINT}" >&2
  printf '  HTTP status: %s\n' "${HTTP_CODE:-none}" >&2
  printf '  response body: %s\n' "${HTTP_BODY:-<empty>}" >&2
}

cleanup() {
  if [[ -n "${RESPONSE_FILE}" && -f "${RESPONSE_FILE}" ]]; then
    rm -f "${RESPONSE_FILE}"
  fi
}

print_summary() {
  echo
  echo "========================================"
  if [[ "${FAIL}" -eq 0 ]]; then
    echo "VERIFY: PASS (${PASS} checks)"
  else
    echo "VERIFY: FAIL (${FAIL} failed, ${PASS} passed)"
  fi
  echo "========================================"
}

on_exit() {
  if [[ -n "${RECORDING_ID}" ]]; then
    log "Cleaning up active verification recording (${RECORDING_ID})"
    curl -sS -m "${TIMEOUT_SECONDS}" \
      -X POST \
      -H "Content-Type: application/json" \
      -d "{\"recordingId\":\"${RECORDING_ID}\"}" \
      "${BASE_URL}/recording/stop" >/dev/null 2>&1 || true
  fi
  cleanup
  print_summary
  if [[ "${FAIL}" -gt 0 ]]; then
    exit 1
  fi
}

trap on_exit EXIT

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  LAST_METHOD="${method}"
  LAST_ENDPOINT="${path}"
  RESPONSE_FILE="$(mktemp)"
  HTTP_CODE="000"
  HTTP_BODY=""

  local curl_args=(
    -sS
    -m "${TIMEOUT_SECONDS}"
    -X "${method}"
    -H "Accept: application/json"
    -o "${RESPONSE_FILE}"
    -w "%{http_code}"
  )

  if [[ -n "${body}" ]]; then
    curl_args+=(-H "Content-Type: application/json" -d "${body}")
  fi

  if ! HTTP_CODE="$(curl "${curl_args[@]}" "${BASE_URL}${path}" 2>"${RESPONSE_FILE}.err")"; then
    HTTP_BODY="$(cat "${RESPONSE_FILE}.err" 2>/dev/null || true)"
    if [[ -z "${HTTP_BODY}" && -f "${RESPONSE_FILE}" ]]; then
      HTTP_BODY="$(cat "${RESPONSE_FILE}")"
    fi
    rm -f "${RESPONSE_FILE}.err"
    return 1
  fi

  rm -f "${RESPONSE_FILE}.err"
  HTTP_BODY="$(cat "${RESPONSE_FILE}")"
  return 0
}

json_field() {
  local field="$1"
  python3 - "${field}" "${RESPONSE_FILE}" <<'PY'
import json
import sys
from pathlib import Path

field = sys.argv[1]
path = Path(sys.argv[2])
try:
    payload = json.loads(path.read_text())
except json.JSONDecodeError:
    print("")
    sys.exit(0)
value = payload.get(field, "")
print(value if value is not None else "")
PY
}

json_field_nonempty() {
  local field="$1"
  local value
  value="$(json_field "${field}")"
  [[ -n "${value}" ]]
}

log "Target: ${BASE_URL}"
echo

if [[ "${SKIP_FLASK_CHECK}" != "1" ]]; then
  log "Check — Flask started"
  LAST_METHOD="GET"
  LAST_ENDPOINT="/status"

  if request GET /status; then
    if [[ "${HTTP_CODE}" =~ ^[0-9]+$ && "${HTTP_CODE}" != "000" ]]; then
      pass_item "Flask started"
    else
      fail_item "Flask started"
    fi
  else
    fail_item "Flask started"
  fi
fi

log "Check — GET /status"
if request GET /status; then
  if [[ "${HTTP_CODE}" == "200" ]] && json_field status | grep -qx "ok" && json_field_nonempty cameraState; then
    pass_item "/status OK"
  else
    fail_item "/status OK"
  fi
else
  fail_item "/status OK"
fi

log "Check — GET /info"
if request GET /info; then
  if [[ "${HTTP_CODE}" == "200" ]] && json_field_nonempty hostname && json_field_nonempty ip; then
    pass_item "/info OK (hostname=$(json_field hostname), ip=$(json_field ip))"
  else
    fail_item "/info OK"
  fi
else
  fail_item "/info OK"
fi

log "Check — POST /camera/state"
if request POST /camera/state '{"enabled":false}'; then
  if [[ "${HTTP_CODE}" == "404" ]]; then
    fail_item "/camera/state exists"
  else
    pass_item "/camera/state exists"
  fi
else
  fail_item "/camera/state exists"
fi

log "Check — POST /recording/start"
if request POST /recording/start; then
  if [[ "${HTTP_CODE}" == "404" ]]; then
    fail_item "/recording/start exists"
  else
    pass_item "/recording/start exists"
    if [[ "${HTTP_CODE}" == "200" ]]; then
      RECORDING_ID="$(json_field recordingId)"
      if [[ -z "${RECORDING_ID}" ]]; then
        fail_item "/recording/start returned recordingId"
      fi
    fi
  fi
else
  fail_item "/recording/start exists"
fi

log "Check — POST /recording/stop"
if [[ -n "${RECORDING_ID}" ]]; then
  stop_body="{\"recordingId\":\"${RECORDING_ID}\"}"
else
  stop_body="{}"
fi

if request POST /recording/stop "${stop_body}"; then
  if [[ "${HTTP_CODE}" == "404" ]]; then
    fail_item "/recording/stop exists"
  else
    pass_item "/recording/stop exists"
    if [[ -n "${RECORDING_ID}" && "${HTTP_CODE}" == "200" ]]; then
      RECORDING_ID=""
    fi
  fi
else
  fail_item "/recording/stop exists"
fi

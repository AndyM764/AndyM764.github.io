#!/usr/bin/env bash
# CourtVision V4 — route verification (run from Mac or Pi)
#
# Usage:
#   ./verify-courtvision-v4.sh
#   ./verify-courtvision-v4.sh http://192.168.1.50:5000
#
# Environment overrides:
#   COURTVISION_PI_URL   Base URL (default: http://127.0.0.1:5000)
#   COURTVISION_VERIFY_TIMEOUT  Per-request timeout seconds (default: 10)

set -euo pipefail

BASE_URL="${COURTVISION_PI_URL:-${1:-http://127.0.0.1:5000}}"
BASE_URL="${BASE_URL%/}"
TIMEOUT_SECONDS="${COURTVISION_VERIFY_TIMEOUT:-10}"

PASS=0
FAIL=0
RECORDING_ID=""
RESPONSE_FILE=""

log() {
  printf '[verify] %s\n' "$*"
}

pass() {
  PASS=$((PASS + 1))
  printf '  PASS  %s\n' "$*"
}

fail() {
  FAIL=$((FAIL + 1))
  printf '  FAIL  %s\n' "$*" >&2
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
  RESPONSE_FILE="$(mktemp)"
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

  HTTP_CODE="$(curl "${curl_args[@]}" "${BASE_URL}${path}")"
  HTTP_BODY="$(cat "${RESPONSE_FILE}")"
}

json_field() {
  local field="$1"
  python3 - "${field}" "${RESPONSE_FILE}" <<'PY'
import json
import sys
from pathlib import Path

field = sys.argv[1]
path = Path(sys.argv[2])
payload = json.loads(path.read_text())
value = payload.get(field, "")
print(value if value is not None else "")
PY
}

log "Target: ${BASE_URL}"

log "Check 1/4 — GET /status"
request GET /status

if [[ "${HTTP_CODE}" != "200" ]]; then
  fail "GET /status expected HTTP 200, got ${HTTP_CODE}"
else
  STATUS_VALUE="$(json_field status)"
  CAMERA_STATE="$(json_field cameraState)"

  if [[ "${STATUS_VALUE}" == "ok" && "${CAMERA_STATE}" =~ ^(IDLE|PREVIEW|RECORDING)$ ]]; then
    pass "GET /status returns ok with cameraState=${CAMERA_STATE}"
  else
    fail "GET /status response payload invalid"
  fi
fi

log "Check 2/4 — POST /camera/state"
request POST /camera/state '{"enabled":false}'

if [[ "${HTTP_CODE}" == "404" ]]; then
  fail "POST /camera/state route missing (404)"
else
  pass "POST /camera/state route exists (HTTP ${HTTP_CODE})"
fi

log "Check 3/4 — POST /recording/start"
request POST /recording/start

if [[ "${HTTP_CODE}" == "404" ]]; then
  fail "POST /recording/start route missing (404)"
elif [[ "${HTTP_CODE}" == "200" ]]; then
  RECORDING_ID="$(json_field recordingId)"
  if [[ -n "${RECORDING_ID}" ]]; then
    pass "POST /recording/start route exists and accepted request"
  else
    fail "POST /recording/start returned 200 without recordingId"
  fi
else
  pass "POST /recording/start route exists (HTTP ${HTTP_CODE})"
fi

log "Check 4/4 — POST /recording/stop"
if [[ -n "${RECORDING_ID}" ]]; then
  stop_body="{\"recordingId\":\"${RECORDING_ID}\"}"
else
  stop_body="{}"
fi

request POST /recording/stop "${stop_body}"

if [[ "${HTTP_CODE}" == "404" ]]; then
  fail "POST /recording/stop route missing (404)"
elif [[ -n "${RECORDING_ID}" && "${HTTP_CODE}" == "200" ]]; then
  pass "POST /recording/stop finalized active verification recording"
  RECORDING_ID=""
elif [[ -z "${RECORDING_ID}" && "${HTTP_CODE}" == "400" ]]; then
  pass "POST /recording/stop route exists and validates payload (HTTP 400)"
else
  pass "POST /recording/stop route exists (HTTP ${HTTP_CODE})"
fi

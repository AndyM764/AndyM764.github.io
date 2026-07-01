#!/usr/bin/env bash
# CourtVision V4 — backend verification (run from Mac or Pi)
#
# Usage:
#   ./verify.sh
#   ./verify.sh http://192.168.1.50:5000
#
# Environment overrides:
#   COURTVISION_PI_URL            Base URL (default: http://127.0.0.1:5000)
#   COURTVISION_VERIFY_TIMEOUT    Per-request timeout seconds (default: 15)

set -euo pipefail

BASE_URL="${COURTVISION_PI_URL:-${1:-http://127.0.0.1:5000}}"
BASE_URL="${BASE_URL%/}"
TIMEOUT_SECONDS="${COURTVISION_VERIFY_TIMEOUT:-15}"

PASS=0
FAIL=0
RECORDING_ID=""
RECORDING_FILENAME=""
RESPONSE_FILE=""
LAST_METHOD=""
LAST_ENDPOINT=""
VERIFY_RESULT="PASS"

log() {
  printf '[verify] %s\n' "$*"
}

pass_endpoint() {
  PASS=$((PASS + 1))
  printf 'PASS: %s %s — HTTP %s\n' "${LAST_METHOD}" "${LAST_ENDPOINT}" "${HTTP_CODE}"
}

fail_endpoint() {
  FAIL=$((FAIL + 1))
  VERIFY_RESULT="FAIL"
  printf 'FAIL: %s %s\n' "${LAST_METHOD}" "${LAST_ENDPOINT}" >&2
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
    echo "VERIFY: PASS"
  else
    echo "VERIFY: FAIL"
  fi
  echo "========================================"
}

on_exit() {
  if [[ -n "${RECORDING_ID}" ]]; then
    log "Cleaning up verification recording (${RECORDING_ID})"
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
if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value if value is not None else "")
PY
}

json_bool_is_true() {
  [[ "$(json_field "$1")" == "true" ]]
}

json_field_nonempty() {
  local value
  value="$(json_field "$1")"
  [[ -n "${value}" ]]
}

validate_camera_status_payload() {
  local camera_state
  local consistent

  camera_state="$(json_field cameraState)"
  consistent="$(json_field cameraStateConsistent)"

  if [[ ! "${camera_state}" =~ ^(IDLE|PREVIEW|RECORDING)$ ]]; then
    return 1
  fi

  if [[ "${consistent}" != "true" ]]; then
    return 1
  fi

  return 0
}

log "Target: ${BASE_URL}"
echo

log "GET /status"
if request GET /status; then
  if [[ "${HTTP_CODE}" == "200" ]] && json_field status | grep -qx "ok" && validate_camera_status_payload; then
    pass_endpoint
  else
    fail_endpoint
  fi
else
  fail_endpoint
fi

log "GET /info"
if request GET /info; then
  if [[ "${HTTP_CODE}" == "200" ]] && json_field_nonempty hostname && json_field_nonempty ip; then
    pass_endpoint
  else
    fail_endpoint
  fi
else
  fail_endpoint
fi

log "POST /camera/state"
if request POST /camera/state '{"enabled":false}'; then
  if [[ "${HTTP_CODE}" == "404" ]]; then
    fail_endpoint
  else
    pass_endpoint
  fi
else
  fail_endpoint
fi

log "POST /recording/start"
if request POST /recording/start; then
  if [[ "${HTTP_CODE}" == "404" ]]; then
    fail_endpoint
  else
    pass_endpoint

    if [[ "${HTTP_CODE}" == "200" ]]; then
      RECORDING_ID="$(json_field recordingId)"

      if [[ -z "${RECORDING_ID}" ]]; then
        LAST_ENDPOINT="/recording/start (recordingId missing)"
        fail_endpoint
      elif ! json_bool_is_true processesRunning; then
        LAST_ENDPOINT="/recording/start (processesRunning)"
        HTTP_BODY="${HTTP_BODY}"
        fail_endpoint
      else
        log "Validate recording process state via GET /status"
        if request GET /status; then
          if [[ "${HTTP_CODE}" == "200" ]] \
            && json_bool_is_true recordingActive \
            && [[ "$(json_field cameraState)" == "RECORDING" ]]; then
            pass_endpoint
          else
            LAST_ENDPOINT="/status (recordingActive)"
            fail_endpoint
          fi
        else
          LAST_ENDPOINT="/status (recordingActive)"
          fail_endpoint
        fi

        sleep 1

        log "POST /recording/stop (finalize verification recording)"
        if request POST /recording/stop "{\"recordingId\":\"${RECORDING_ID}\"}"; then
          if [[ "${HTTP_CODE}" == "200" ]]; then
            pass_endpoint
            RECORDING_FILENAME="$(json_field filename)"
            FILE_SIZE="$(json_field fileSize)"

            if [[ -z "${RECORDING_FILENAME}" ]]; then
              LAST_ENDPOINT="/recording/stop (filename missing)"
              fail_endpoint
            elif [[ -z "${FILE_SIZE}" || "${FILE_SIZE}" -le 0 ]]; then
              LAST_ENDPOINT="/recording/stop (fileSize)"
              fail_endpoint
            else
              log "GET /recordings/${RECORDING_FILENAME} (file size check)"
              RECORDING_TMP="$(mktemp)"
              LAST_METHOD="GET"
              LAST_ENDPOINT="/recordings/${RECORDING_FILENAME}"
              HTTP_CODE="$(curl -sS -m "${TIMEOUT_SECONDS}" -o "${RECORDING_TMP}" -w '%{http_code}' "${BASE_URL}/recordings/${RECORDING_FILENAME}" || echo "000")"
              DOWNLOAD_SIZE="$(wc -c < "${RECORDING_TMP}" | tr -d ' ')"
              HTTP_BODY="(binary mp4, ${DOWNLOAD_SIZE} bytes)"
              rm -f "${RECORDING_TMP}"

              if [[ "${HTTP_CODE}" == "200" && "${DOWNLOAD_SIZE}" -gt 0 ]]; then
                pass_endpoint
                RECORDING_ID=""
              else
                fail_endpoint
              fi
            fi
          else
            fail_endpoint
          fi
        else
          fail_endpoint
        fi
      fi
    fi
  fi
else
  fail_endpoint
fi

if [[ -z "${RECORDING_ID}" ]]; then
  log "POST /recording/stop (route existence)"
  if request POST /recording/stop '{}'; then
    if [[ "${HTTP_CODE}" == "404" ]]; then
      fail_endpoint
    else
      pass_endpoint
    fi
  else
    fail_endpoint
  fi
fi

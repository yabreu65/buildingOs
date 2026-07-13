#!/usr/bin/env bash
set -euo pipefail

# Usage (recommended):
#   source scripts/qa/get_token.sh
# Optional env overrides:
#   AUTH_BASE_URL=http://localhost:4000
#   LOGIN_EMAIL=admin@demo.com
#   LOGIN_PASSWORD=Admin123!

AUTH_BASE_URL="${AUTH_BASE_URL:-http://localhost:4000}"
LOGIN_EMAIL="${LOGIN_EMAIL:-admin@demo.com}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-Admin123!}"

RESP_FILE="/tmp/qa_auth_login_response.json"

HTTP_CODE=$(curl -sS -o "${RESP_FILE}" -w "%{http_code}" \
  -X POST "${AUTH_BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${LOGIN_EMAIL}\",\"password\":\"${LOGIN_PASSWORD}\"}")

if [[ "${HTTP_CODE}" != "201" && "${HTTP_CODE}" != "200" ]]; then
  echo "[QA][ERROR] Login failed with HTTP ${HTTP_CODE}" >&2
  cat "${RESP_FILE}" >&2 || true
  return 1 2>/dev/null || exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[QA][ERROR] jq is required for token extraction" >&2
  return 1 2>/dev/null || exit 1
fi

TOKEN_VALUE=$(jq -r '.accessToken // .token // .jwt // empty' "${RESP_FILE}")
TENANT_VALUE=$(jq -r '.memberships[0].tenantId // empty' "${RESP_FILE}")

if [[ -z "${TOKEN_VALUE}" ]]; then
  echo "[QA][ERROR] Token not found in login response (checked accessToken/token/jwt)" >&2
  cat "${RESP_FILE}" >&2 || true
  return 1 2>/dev/null || exit 1
fi

export TOKEN="${TOKEN_VALUE}"
if [[ -n "${TENANT_VALUE}" ]]; then
  export QA_TENANT_ID="${TENANT_VALUE}"
fi

MASKED="${TOKEN:0:12}...${TOKEN: -6}"
echo "[QA] TOKEN exported (masked): ${MASKED}"
if [[ -n "${QA_TENANT_ID:-}" ]]; then
  echo "[QA] QA_TENANT_ID exported: ${QA_TENANT_ID}"
fi
echo "[QA] Login route used: ${AUTH_BASE_URL}/auth/login"

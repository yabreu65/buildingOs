#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${QA_BRIDGE_BASE_URL:-http://localhost:4000}"
TENANT_ID="${QA_TENANT_ID:-}"
TOKEN="${QA_TOKEN:-}"
MESSAGE="${1:-dame deuda del edificio A}"

if [[ -z "${TENANT_ID}" ]]; then
  echo "[QA][ERROR] Missing QA_TENANT_ID env var"
  exit 1
fi

if [[ -z "${TOKEN}" ]]; then
  echo "[QA][ERROR] Missing QA_TOKEN env var"
  exit 1
fi

URL="${BASE_URL}/tenants/${TENANT_ID}/assistant/chat"
RESP_FILE="/tmp/qa_bridge_4000_chat.json"

echo "[QA] Sending POST ${URL}"
HTTP_CODE=$(curl -sS -o "${RESP_FILE}" -w "%{http_code}" -X POST "${URL}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "x-tenant-id: ${TENANT_ID}" \
  -d "{\"message\":\"${MESSAGE}\",\"page\":\"/tenant/finanzas\"}")

echo "[QA] HTTP ${HTTP_CODE}"
cat "${RESP_FILE}"

echo
echo "[QA] Key metadata"
if command -v jq >/dev/null 2>&1; then
  jq '{
    traceId: (.provenance?.sources?.[0]?.metadata?.traceId // .metadata?.traceId),
    resolvedIntentCode: (.provenance?.sources?.[0]?.metadata?.resolvedIntentCode // .metadata?.resolvedIntentCode),
    fallbackPath: (.provenance?.sources?.[0]?.metadata?.fallbackPath // .metadata?.fallbackPath),
    missingEntities: (.provenance?.sources?.[0]?.metadata?.missingEntities // .metadata?.missingEntities),
    gatewayOutcome: (.provenance?.sources?.[0]?.metadata?.gatewayOutcome // .metadata?.gatewayOutcome)
  }' "${RESP_FILE}"
else
  echo "jq not found; raw response saved at ${RESP_FILE}"
fi

echo
echo "[QA] Done. Response file: ${RESP_FILE}"

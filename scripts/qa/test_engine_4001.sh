#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${QA_ENGINE_BASE_URL:-http://localhost:4001}"
MESSAGE="${1:-dame deuda del edificio A}"

echo "[QA] Checking engine health at ${BASE_URL}/health"
curl -sS "${BASE_URL}/health" | tee /tmp/qa_engine_4001_health.json

echo
 echo "[QA] Sending POST ${BASE_URL}/assistant/chat"
RESP_FILE="/tmp/qa_engine_4001_chat.json"
curl -sS -X POST "${BASE_URL}/assistant/chat" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"${MESSAGE}\",\"context\":{\"appId\":\"buildingos\",\"tenantId\":\"tenant-test\",\"userId\":\"user-qa\",\"role\":\"TENANT_ADMIN\"}}" \
  | tee "${RESP_FILE}"

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

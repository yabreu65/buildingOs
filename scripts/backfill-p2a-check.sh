#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:4000}
EMAIL=${EMAIL:-}
PASSWORD=${PASSWORD:-}
TENANT_ID=${TENANT_ID:-}
FROM_PERIOD=${FROM_PERIOD:-2026-01}
TO_PERIOD=${TO_PERIOD:-2026-03}

require_env() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "ERROR: missing required env var: $name"
    exit 1
  fi
}

require_env "EMAIL" "$EMAIL"
require_env "PASSWORD" "$PASSWORD"
require_env "TENANT_ID" "$TENANT_ID"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

echo "[1/3] Login -> $BASE_URL/auth/login"
LOGIN_RESPONSE=$(curl -sS -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg email "$EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password}')")

TOKEN=$(jq -r '.accessToken // .token // .jwt // empty' <<<"$LOGIN_RESPONSE")
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: login failed, token is empty"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi
echo "Login OK. Token prefix: ${TOKEN:0:20}..."

echo "[2/3] Backfill -> $BASE_URL/admin/snapshots/backfill-range"
BACKFILL_RESPONSE=$(curl -sS -X POST "$BASE_URL/admin/snapshots/backfill-range" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg tenantId "$TENANT_ID" --arg fromPeriod "$FROM_PERIOD" --arg toPeriod "$TO_PERIOD" '{tenantId:$tenantId,fromPeriod:$fromPeriod,toPeriod:$toPeriod}')")

echo "$BACKFILL_RESPONSE" | jq .

PERIODS_PROCESSED=$(jq -r '.periodsProcessed // 0' <<<"$BACKFILL_RESPONSE")
if [[ "$PERIODS_PROCESSED" -le 0 ]]; then
  echo "ERROR: periodsProcessed must be > 0 (got: $PERIODS_PROCESSED)"
  exit 1
fi

echo "[3/3] Verify DB snapshot counts"
DB_COUNTS=$(cd "$REPO_ROOT/apps/api" && node -e 'require("dotenv").config({ path: "prisma/.env" }); const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient(); (async () => { const unit = await p.unitBalanceMonthlySnapshot.count(); const building = await p.buildingBalanceMonthlySnapshot.count(); console.log(JSON.stringify({ unit, building })); })().finally(() => p.$disconnect());')

UNIT_COUNT=$(jq -r '.unit // 0' <<<"$DB_COUNTS")
BUILDING_COUNT=$(jq -r '.building // 0' <<<"$DB_COUNTS")

echo "unitBalanceMonthlySnapshot: $UNIT_COUNT"
echo "buildingBalanceMonthlySnapshot: $BUILDING_COUNT"

if [[ "$UNIT_COUNT" -le 0 || "$BUILDING_COUNT" -le 0 ]]; then
  echo "ERROR: snapshot counts must be > 0"
  exit 1
fi

echo "OK"

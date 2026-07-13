# How To Test Assistant (4000 vs 4001)

## Which service to use

- Use `:4001` (yoryi ai-assistant-api) when you want to validate the **engine behavior only** (intent resolution, fallback path, metadata) without BuildingOS auth/bridge complexity.
- Use `:4000` (BuildingOS API) when you want to validate the **real product integration** (JWT auth, tenant scoping, bridge to yoryi, and final API contract).

## Endpoints summary

- Engine direct (`4001`): `POST /assistant/chat` (no JWT required)
- BuildingOS bridge (`4000`): `POST /tenants/:tenantId/assistant/chat` (JWT required)

## Metadata to inspect

Always check these fields in response/logs:

- `resolvedIntentCode`
- `fallbackPath`
- `missingEntities`
- `gatewayOutcome`
- `traceId`

## Quick test commands

### 1) Engine direct (4001)

Health:

```bash
curl -sS "http://localhost:4001/health"
```

Chat:

```bash
curl -sS -X POST "http://localhost:4001/assistant/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "dame deuda del edificio A",
    "context": {
      "appId": "buildingos",
      "tenantId": "tenant-test",
      "userId": "user-qa",
      "role": "TENANT_ADMIN"
    }
  }'
```

### 2) BuildingOS bridge (4000, requires JWT)

```bash
export QA_TOKEN="<JWT>"
export QA_TENANT_ID="<tenantId>"

curl -sS -X POST "http://localhost:4000/tenants/${QA_TENANT_ID}/assistant/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${QA_TOKEN}" \
  -H "x-tenant-id: ${QA_TENANT_ID}" \
  -d '{
    "message": "dame deuda del edificio A",
    "page": "/tenant/finanzas"
  }'
```

## Suggested QA flow

1. Run engine test on `4001` first to verify intent/metadata behavior.
2. Run bridge test on `4000` to verify auth + tenancy + integration behavior.
3. Compare metadata fields across both responses.

## One-command scripts

- Engine QA: `scripts/qa/test_engine_4001.sh`
- Bridge QA: `scripts/qa/test_bridge_4000.sh`

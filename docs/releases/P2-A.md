# P2-A Release Notes — Historial / Tendencias (Snapshot)

**Release Date:** 2026-04-25
**Contract Version:** 2026-05-buildingos-p2-manifest-v1  
**Response Version:** 2026-05-p2-response-v2

---

## What's Included

### 1. Contract V2 (answerSource="snapshot")

- **Source types:** `live_data` | `snapshot` | `clarification`
- **Breaking change:** Requires `responseContractVersion: "2026-05-p2-response-v2"` to use P2 tools
- **V1 remains strict:** still rejects snapshot for P0/P1 tools

### 2. Database Schema

Tables created in BuildingOS (`apps/api/prisma/schema.prisma`):

- `UnitBalanceMonthlySnapshot` — per-unit monthly aggregation
- `BuildingBalanceMonthlySnapshot` — per-building monthly aggregation

Indexes:
- unique: `(tenantId, unitId, period, currency)`, `(tenantId, buildingId, period, currency)`
- index: `(tenantId, buildingId, period)`, `(tenantId, period)`, `(tenantId, asOf)`

### 3. Job: Snapshot Generation

- **Service:** `SnapshotGenerationService`
- **Cron:** Monthly Day 1 @ 02:00 UTC (`ENABLE_CRON_MONTHLY_SNAPSHOTS`)
- **Idempotent:** upsert by unique key
- **Backfill API:**
  - `POST /admin/snapshots/backfill-range` — bulk backfill
  - `POST /admin/snapshots/recompute-period` — single period regenerate

### 4. Tools P2

| Tool Name | Intent Code | Input | Output |
|----------|------------|-------|---------|
| `get_unit_debt_trend` | GET_UNIT_DEBT_TREND | unitId, months, metric | series with coverage |
| `get_building_debt_trend` | GET_BUILDING_DEBT_TREND | buildingId, months, metric | series with coverage |
| `get_collections_trend` | GET_COLLECTIONS_TREND | months, buildingId? | charged/collected/collectionRateBp |

**Metrics:** `outstanding` | `overdue` | `charged` | `collected` | `collection_rate`

**Clamping:** months 1-24 (default: 6)

### 5. Router P2

- **Manifest:** `buildingos.p2.json` (10 routes)
- **Features:**
  - Extracts `months` from natural language ("último año", "12 meses", "6 meses")
  - Extracts `metric` from query ("deuda vencida" → overdue, "cobros" → collected)
  - Clarification when building required in multi-building tenant
- **Defaults:** months=6, maxMonths=24, maxClarifications=2

---

## Smoke Tests

### 16 P2 Router Tests (all passing)

```bash
npm run test --workspace=@yoryi/ai-adapters -- src/buildingos/buildingos-p2-router.spec.ts
```

### Contract Tests in BuildingOS

```bash
# Run P2 snapshot tools tests
cd apps/api && npm test -- --testPathPattern=tools.p2-snapshot
```

---

## How to Run

### Enable Monthly Snapshot Job

```bash
# Set environment variable (before starting API)
export ENABLE_CRON_MONTHLY_SNAPSHOTS=true

# Or in docker-compose/docker/.env
ENABLE_CRON_MONTHLY_SNAPSHOTS=true
```

### Run Backfill Manually

```bash
# Backfill 6 months for a tenant
curl -X POST http://localhost:4000/admin/snapshots/backfill-range \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-123",
    "fromPeriod": "2025-10",
    "toPeriod": "2026-03"
  }'

# Recompute single period
curl -X POST http://localhost:4000/admin/snapshots/recompute-period \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-123",
    "period": "2026-03"
  }'
```

### Smoke P2 End-to-End (Router Only)

```bash
cd packages/ai-adapters && node -e "
const { BuildingOSP2Router } = require('./dist/buildingos/buildingos-p2-router');
const router = new BuildingOSP2Router();

const qs = [
  'Evolución deuda unidad 12-8 Torre A últimos 6 meses',
  'Tendencia deuda del edificio X últimos 12 meses',
  'Cobranzas últimos 6 meses'
];

qs.forEach(q => {
  const r = router.route(q, { buildingCount: 1 });
  console.log('Q:', q, '->', r?.toolName);
});
"
```

---

## Migration: P1 → P2

For tenants wanting to use trends and historical data:

1. **Ensure snapshots exist:** Run backfill or wait for first cron job
2. **Use responseContractVersion:** Pass `"2026-05-p2-response-v2"` in API calls
3. **No breaking changes:** P0/P1 remain on V1 (`live_data` only)

---

## Invariants Enforced

- ✅ No `knowledge` fallback for P2 tools
- ✅ Tenant isolation (all queries scoped by tenantId)
- ✅ maxClarifications=2
- ✅ months clamped 1–24
- ✅ answerSource=snapshot only with V2 contract
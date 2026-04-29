# QA Checklist P3 — Cross Query (TPL-01, TPL-05, TPL-10)

## Entorno: ____ (local/staging)

## Criterio GO/NO-GO: TODOS los 10 casos críticos deben pasar (Pass)

---

## CASOS CRÍTICOS (P0) — Deben pasar todos

| ID | Caso | Pasos | Resultado esperado | Evidencia | Pass/Fail |
|----|------|-------|---------------------|-------------------|-----------|-----------|
| C01 | **Tenant isolation: usuario accede solo a datos de su tenant** | 1. Autenticarse como tenant-A (user@test-a.com)<br>2. Ejecutar `cross_query(TPL-01)`<br>3. Verificar respuesta | Solo datos con `tenantId == tenant-A` | | |
| C02 | **Role denied: OPERATOR no puede acceder a TPL-10** | 1. Autenticarse como OPERATOR<br>2. Ejecutar `cross_query(TPL-10)`<br>3. Verificar denegación | HTTP 403 o `responseType: error` con `errorCode: role_denied` | | |
| C03 | **Role denied: RESIDENT no puede acceder a TPL-01** | 1. Autenticarse como RESIDENT<br>2. Ejecutar `cross_query(TPL-01)`<br>3. Verificar denegación | HTTP 403 o `responseType: error` | | |
| C04 | **Contract mismatch: templateId inválido** | 1. Ejecutar `cross_query(templateId: "TPL-99")`<br>2. Verificar respuesta | `responseType: error` con `errorCode: contract_mismatch` | | |
| C05 | **Building required clarification: multi-building sin buildingId** | 1. Tenant con 3+ edificios<br>2. Ejecutar `cross_query(TPL-01)` sin buildingId<br>3. Verificar clarification | `responseType: clarification` con mensaje sobre edificio | | |
| C06 | **Clamps: topN > 50 limitado a 50** | 1. Ejecutar `cross_query(TPL-01, topN: 100)`<br>2. Verificar topN efectivo | `params.topN` = 50 | | |
| C07 | **Clamps: limit > 50 limitado a 50** | 1. Ejecutar `cross_query(TPL-05, limit: 100)`<br>2. Verificar limit efectivo | `params.limit` = 50 | | |
| C08 | **Clamps: monthsBack > 24 limitado a 24** | 1. Ejecutar `cross_query(TPL-10, monthsBack: 30)`<br>2. Verificar monthsBack efectivo | `params.monthsBack` = 24 | | |
| C09 | **No knowledge fallback: answerSource determinístico** | 1. Ejecutar `cross_query(TPL-01)`<br>2. Verificar answerSource | `answerSource` = `snapshot` (NO `knowledge`, NO `fallback`) | | |
| C10 | **TPL-05 paginación estable: page1/page2 sin overlap** | 1. Ejecutar `cross_query(TPL-05, limit: 2)` → page1<br>2. Obtener cursor<br>3. Ejecutar con cursor → page2<br>4. Verificar IDs únicos | Page1 IDs ∩ Page2 IDs = ∅ | | |

| ID | Caso | Pasos | Resultado esperado | Evidencia | Pass/Fail |
|----|------|-------|---------------------|-------------------|-----------|-----------|
| C11 | **AnswerSource determinístico: TPL-01 = snapshot** | 1. Ejecutar `cross_query(TPL-01)`<br>2. Verificar answerSource | `answerSource` = `snapshot` | | |
| C12 | **AnswerSource determinístico: TPL-05 = live_data** | 1. Ejecutar `cross_query(TPL-05)`<br>2. Verificar answerSource | `answerSource` = `live_data` | | |
| C13 | **Cursor expirado: error controlado** | 1. Usar cursor de query antigua (>24h)<br>2. Ejecutar con cursor<br>3. Verificar respuesta | empty array o `responseType: error` con `errorCode: cursor_expired` | | |
| C14 | **TPL-10 asOf globales coherente** | 1. Ejecutar `cross_query(TPL-10)`<br>2. Verificar `asOf` global | `asOf` >= max(section.asOf) | | |
| C15 | **Todas las secciones tienen asOf** | 1. Ejecutar cualquier template<br>2. Verificar cada section | Cada section con `data.asOf` | | |

---

## CASOS NORMALES (P1)

| ID | Caso | Pasos | Resultado esperado | Evidencia | Pass/Fail |
|----|------|-------|---------------------|-------------------|-----------|-----------|
| N01 | **TPL-01: variants de wording sinónimos** | 1. "deuda por unidad"<br>2. "estado de cuenta"<br>3. "deuda y ocupación" | Mismo templateId TPL-01 | | |
| N02 | **TPL-05: "dame más" para pagination** | 1. Ejecutar workqueue<br>2. Pedir "dame más"<br>3. Verificar cursor | `params.cursor: "next"` | | |
| N03 | **TPL-05: monthsBack 12 = último año** | 1. Ejecutar `cross_query(TPL-05, monthsBack: 12)`<br>2. Verificar items recientes | Solo items de últimos 12 meses | | |
| N04 | **TPL-10: monthsBack = "último año"** | 1. Ejecutar con wording "último año"<br>2. Verificar monthsBack | `params.monthsBack` = 12 | | |
| N05 | **TPL-01: building específico vs sin building** | 1. tenant single-building: sin buildingId = ok<br>2. Pasar buildingId explícito | Ambos funcionan | | |
| N06 | **TPL-05: filtros combinados** | 1. Ejecutar con topN=10, limit=15<br>2. Verificar valores | topN=10, limit=15 | | |
| N07 | **TPL-10: 5 secciones dashboard** | 1. Ejecutar `cross_query(TPL-10)`<br>2. Verificar sections.length | sections.length = 5 | | |
| N08 | **TPL-01: occupancy section live data** | 1. Ejecutar TPL-01<br>2. Verificar sections[1].type | `section.type` = "live_data" | | |
| N09 | **Clarification max 2 preguntas** | 1. Multi-building sin buildingId<br>2. Primera clarification<br>3. Segunda clarification<br>4. Tercera debe bloquearse | clarificationCount <= 2 | | |
| N10 | **Response format: todas las secciones con metadata** | 1. Ejecutar cualquier template<br>2. Verificar estructura | `templateId`, `answerSource`, `asOf`, `responseType` presentes | | |

---

## Schema de Respuesta Esperado (TPL-01)

```json
{
  "templateId": "TPL-01",
  "templateName": "UNIT_DEBT_OCCUPANCY",
  "answerSource": "snapshot",
  "asOf": "2026-03-31T23:59:59.000Z",
  "scope": {
    "tenantId": "...",
    "buildingId": "...",
    "currency": "ARS",
    "role": "TENANT_ADMIN"
  },
  "responseType": "list",
  "sections": [
    {
      "title": "debt_snapshot",
      "type": "snapshot",
      "data": {
        "period": "2026-03",
        "asOf": "2026-03-31T23:59:59.000Z",
        "coverage": { "from": "2025-10", "to": "2026-03", "points": 6 },
        "kpis": {
          "totalDebt": 500000,
          "totalOverdue": 150000,
          "totalCharged": 800000,
          "totalCollected": 650000,
          "collectionRateBp": 8125
        },
        "series": [...],
        "topUnits": [...]
      },
      "notes": ["source:snapshot"]
    },
    {
      "title": "occupancy",
      "type": "live_data",
      "data": {
        "asOf": "2026-04-25T12:00:00.000Z",
        "totalUnits": 100,
        "occupiedUnits": 85,
        "vacantUnits": 15,
        "occupancyRateBp": 8500,
        "occupantsSummary": {
          "residents": 60,
          "owners": 25,
          "assignments": 85,
          "uniqueOccupants": 80
        }
      },
      "notes": ["source:live_data"]
    }
  ],
  "coverage": {
    "from": "2025-10",
    "to": "2026-03",
    "completeness": 1
  },
  "pagination": {
    "limit": 20,
    "nextCursor": "...",
    "hasMore": false
  }
}
```

---

## Schema de Respuesta Esperado (TPL-05)

```json
{
  "templateId": "TPL-05",
  "templateName": "OPEN_WORKQUEUE_CROSS_MODULE",
  "answerSource": "live_data",
  "asOf": "2026-04-25T12:00:00.000Z",
  "responseType": "list",
  "sections": [
    {
      "title": "workqueue_summary",
      "type": "kpi",
      "data": {
        "byType": { "process": 5, "ticket": 3, "payment": 2 },
        "topN": 5,
        "monthsBack": 6,
        "asOf": "2026-04-25T12:00:00.000Z"
      },
      "notes": ["source:live_data"]
    },
    {
      "title": "workqueue",
      "type": "list",
      "data": [
        {
          "type": "process",
          "id": "proc-123",
          "title": "Validar expensa abril",
          "priority": 3,
          "createdAt": "2026-04-20T10:00:00.000Z",
          "linkRef": "process:proc-123",
          "status": "PENDING",
          "overdueSla": true
        }
      ],
      "notes": ["source:live_data", "sort:priority_desc,overdueSla_desc,createdAt_asc,sourceType_asc,id_asc"]
    }
  ],
  "pagination": {
    "limit": 20,
    "nextCursor": "...",
    "hasMore": true
  }
}
```

---

## Schema de Respuesta Esperado (TPL-10)

```json
{
  "templateId": "TPL-10",
  "templateName": "EXECUTIVE_DASHBOARD_CROSS_MODULE",
  "answerSource": "snapshot",
  "asOf": "2026-04-25T12:00:00.000Z",
  "responseType": "dashboard",
  "sections": [
    {
      "title": "debt",
      "type": "kpi",
      "data": {
        "asOf": "2026-03-31T23:59:59.000Z",
        "outstandingMinor": 150000,
        "overdueMinor": 50000
      },
      "notes": ["source:snapshot"]
    },
    {
      "title": "collections",
      "type": "kpi",
      "data": {
        "asOf": "2026-03-31T23:59:59.000Z",
        "chargedMinor": 800000,
        "collectedMinor": 650000,
        "collectionRateBp": 8125
      },
      "notes": ["source:snapshot"]
    },
    {
      "title": "processes",
      "type": "kpi",
      "data": {
        "asOf": "2026-04-25T12:00:00.000Z",
        "open": 5,
        "overdueSla": 2
      },
      "notes": ["source:live_data"]
    },
    {
      "title": "tickets",
      "type": "kpi",
      "data": {
        "asOf": "2026-04-25T12:00:00.000Z",
        "open": 3,
        "byPriority": { "urgent": 0, "high": 1, "medium": 2, "low": 0 }
      },
      "notes": ["source:live_data"]
    },
    {
      "title": "pendingPayments",
      "type": "kpi",
      "data": {
        "asOf": "2026-04-25T12:00:00.000Z",
        "submittedCount": 2,
        "submittedAmountMinor": 50000
      },
      "notes": ["source:live_data"]
    }
  ],
  "coverage": {
    "from": "2025-10",
    "to": "2026-03",
    "completeness": 1
  }
}
```

---

## Rollout Checklist

- [ ] Todos los 15 casos críticos pasan (Pass)
- [ ] Tests unitarios pasan: `npm test --workspace=@yoryi/ai-adapters -- buildingos-p3-router.spec.ts`
- [ ] Manifiesto P3 cargado en staging
- [ ] Logs de producción revisados para errores
- [ ] Métricas de uso capturadas (si aplica)

---

## Notas Adicionales

| Item | Valor |
|------|-------|
| Tenant ID test | `cmobqvd5b0000243ux3pqpsk4` |
| Building IDs test | `cmobqvd5e0002243u8gx4vm1n` (Torre A), `cmobqvd5h0004243uyphbn8sh` (Torre B) |
| Usuario test | `admin@sancristobal.test` / `DevPass!123` (TENANT_ADMIN) |
| Roles disponibles | TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT |
| API Key header | `x-api-key` (via env ASSISTANT_READONLY_API_KEYS) |
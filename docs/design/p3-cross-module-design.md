# Diseño P3 — Cross-module Plantillas Oficiales (BuildingOS + yoryi-ai-core)

## Estado
EXPERIMENTAL (feature-flagged). Implementación disponible pero deshabilitada por defecto.

### Habilitación controlada (canary)

P3 solo se evalúa si:

- `ASSISTANT_P3_ENABLED=true`
- y el tenant está habilitado por canary (`ASSISTANT_YORYI_CANARY_TENANTS`), cuando esa lista está configurada.

Ejemplo:

```bash
ASSISTANT_P3_ENABLED=true
ASSISTANT_YORYI_CANARY_TENANTS=tenant-alpha,tenant-beta
```

## Objetivo
Definir consultas cross-module READ-ONLY v1 usando plantillas oficiales deterministas, auditables y sin joins libres.

---

## Normalizaciones Globales (PM obligatorio)

### Moneda
- `currency` default: moneda del tenant.
- Si tenant multi-moneda y no viene `currency`: **clarification** (prioridad 1).
- Todos los montos en `minor units` (`*_Minor`).

### Revenue — Definición única
- `chargedMinor`: emitidogenerado en período (deuda emitida).
- `collectedMinor`: imputadocobro aplicado al período.
- `collectionRateBp`: **basis points**, nulleable.
  - Regla: `null` si `chargedMinor = 0`
  - Caso contrario: `round((collectedMinor * 10000) / chargedMinor)`

### Fuentes de verdad (no recalcular si ya existe)
- Deuda/trends: **P2-A** (`analytics_debt_by_tower`, `analytics_debt_aging`, `get_unit_debt_trend`, `get_building_debt_trend`, `get_collections_trend`, snapshots mensuales).
- Procesos: **P2-B** (`search_processes`, `get_process_summary`, `search_claims`).
- Pagos/tickets: **P1** (`search_payments`, `search_tickets`, `get_unit_payments`).

---

## Contrato Tool Input (P3)

```typescript
type TemplateId =
  | 'TPL-01' | 'TPL-02' | 'TPL-03' | 'TPL-04' | 'TPL-05'
  | 'TPL-06' | 'TPL-07' | 'TPL-08' | 'TPL-09' | 'TPL-10';

interface CrossQueryInput {
  templateId: TemplateId;
  params: {
    buildingId?: string;          // requerido si multi-building y template lo exige
    period?: string;              // YYYY-MM (mutuamente excluyente con monthsBack)
    monthsBack?: number;         // default 6, clamp 1..24 (mutuamente excluyente)
    topN?: number;              // default 5, clamp 1..50
    currency?: string;           // default tenant currency
    limit?: number;             // default 20, clamp 1..50
    cursor?: string;
    assignedToUserId?: string;
    processTypes?: string[];
    statuses?: string[];
    overdueSla?: boolean;
    createdAfter?: string;
    asOf?: string;              // ISO date para aging
  };
}
```

### Regla period vs monthsBack
- **Mutuamente excluyentes**.
- Si vienen ambos: gana `period` (explícito) y se ignora `monthsBack` con warning en metadata.
- Defaults:
  - templates **trend** (TPL-06, TPL-10): `monthsBack=6`
  - templates **mensuales**: `period=LAST_CLOSED_MONTH`

---

## Contrato Tool Output (estándar único)

```typescript
interface CrossQueryOutput {
  templateId: string;
  templateName: string;
  answerSource: 'snapshot' | 'live_data';
  asOf: string;                              // ISO timestamp
  scope: {
    tenantId: string;
    buildingId: string | null;
    currency: string;
    role: string;
  };
  responseType: 'list' | 'kpi' | 'dashboard' | 'clarification' | 'no_data' | 'error';
  errorCode?: 'role_denied' | 'tenant_denied' | 'contract_mismatch' | 'unavailable' | 'invalid_params';
  sections: Array<{
    title: string;
    type: 'table' | 'kpi' | 'timeseries' | 'distribution' | 'list' | 'text';
    data: unknown;
    notes?: string[];
  }>;
  coverage?: {
    from: string;
    to: string;
    completeness: number;    // 0.0 a 1.0
  };
  pagination?: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}
```

### Reglas de respuesta
- `coverage`: obligatorio en templates snapshot/trend.
- `pagination`: obligatorio en templates listables.
- Si sin datos: `responseType=no_data` + `answerSource` conservado.
- Si error: `responseType=error` + `errorCode` obligatorio.

---

## Plantillas Oficiales (TPL-01..TPL-10)

### TPL-01 — UNIT_DEBT_OCCUPANCY

- **answerSource**: `snapshot`
- Descripción: deuda por unidad con ocupación vigente y riesgo de mora.
- Inputs: `buildingId?`, `period` default LAST_CLOSED_MONTH, `topN` 5 (1..50), `currency`, `limit` 20 (1..50), `cursor`.
- Outputs: `kpi` + `table(units debt/occupancy)`, `coverage` obligatorio, `pagination` en lista.
- Fuentes: P2-A snapshots (`UnitBalanceMonthlySnapshot`) + `UnitOccupant` activo.
- Clarifications: building, period, currency (máx 2).
- Guardrails: `maxRows=500`, joins: `UnitBalance -> Unit -> UnitOccupant -> Building`, `cacheTtl=120`.

### TPL-02 — PAYMENT_CHARGE_MISMATCH

- **answerSource**: `live_data`
- Descripción: pagos no aplicados o con asignación inconsistente para conciliación.
- Inputs: `buildingId?`, `period` default LAST_CLOSED_MONTH, `currency`, `limit` 20, `cursor`.
- Outputs: `kpi` + `list(unmatchedPayments)`, `pagination` obligatorio.
- Fuentes: P1 pagos (`search_payments`) + `PaymentAllocation` null + `Unit`.
- Clarifications: building, period, currency.
- Guardrails: `maxRows=1000`, joins: `Payment -> PaymentAllocation(left) -> Unit -> Building`, `cacheTtl=60`.

### TPL-03 — CHARGED_COLLECTED_BY_UNIT_CATEGORY

- **answerSource**: `snapshot`
- Descripción: charged/collected por categoría de unidad con collectionRateBp.
- Inputs: `buildingId?`, `period` default LAST_CLOSED_MONTH, `topN` 5 (1..50), `currency`.
- Outputs: `distribution(byCategory)` + `kpi(totals)`, `coverage` obligatorio.
- Fuentes: P2-A snapshots agregados por unidad/categoría.
- Clarifications: building, period, currency.
- Guardrails: `maxRows=200`, joins: `UnitBalance -> Unit -> UnitCategory`, `cacheTtl=300`.

### TPL-04 — PROCESS_LOAD_BY_BUILDING

- **answerSource**: `live_data`
- Descripción: carga operativa de procesos por edificio (status/tipo/SLA).
- Inputs: `buildingId?`, `period?` default meses atrás (`monthsBack=1`), `processTypes?`, `statuses?`, `overdueSla?`, `topN` 5.
- Outputs: `kpi` + `table(byBuilding, byStatus, byType, overdue)`, `coverage` opcional.
- Fuentes: P2-B (`get_process_summary` + `search_processes`).
- Clarifications: building, period.
- Guardrails: `maxRows=500`, joins: `ProcessInstance -> Building`, `cacheTtl=90`.

### TPL-05 — OPEN_WORKQUEUE_CROSS_MODULE

- **answerSource**: `live_data`
- Descripción: cola unificada de pendientes (tickets abiertos + procesos pendientes).
- Inputs: `buildingId?`, `assignedToUserId?`, `period` optional monthsBack=1, `limit` 20, `cursor`, `topN` 5.
- Outputs: `list(workqueue)` + `kpi(byType/byAssignee)`, `pagination` obligatorio.
- Fuentes: P1 (`search_tickets`) + P2-B (`search_processes` status PENDING/IN_PROGRESS).
- **Orden determinista** (sort estable):
  1. `priority DESC`
  2. `overdueSla DESC`
  3. `createdAt ASC`
  4. `sourceType ASC`
  5. `id ASC`
- Clarifications: building, period.
- Guardrails: `maxRows=1000`, merge aplicativo determinista, `cacheTtl=30`.

### TPL-06 — REVENUE_OCCUPANCY_TREND

- **answerSource**: `snapshot`
- Descripción: tendencia de ocupación vs charged/collected y collectionRateBp.
- Inputs: `buildingId?`, `monthsBack` default 6 (1..24), `currency`.
- Outputs: `timeseries` + `kpi(promedios)`, `coverage` obligatorio.
- Fuentes: P2-A (`get_building_debt_trend` + `get_collections_trend` + snapshots).
- Clarifications: building, currency (period no aplica con monthsBack).
- Guardrails: `maxRows=24` puntos, joins: `BuildingBalanceMonthlySnapshot`, `cacheTtl=600`.

### TPL-07 — DEBT_AGING_BY_BUILDING

- **answerSource**: `live_data` (v1)
- Descripción: bucketización de deuda por antigüedad para gestión.
- Inputs: `buildingId?`, `asOf` default today (UTC), `currency`, `topN` 5.
- Outputs: `distribution(aging buckets)` + `table(byBuilding)`, `coverage` requerido con asOf.
- Fuentes: P2-A (`analytics_debt_aging` preferred).
- Clarifications: building, currency.
- Guardrails: `maxRows=300`, joins: salida P2-A + Building label, `cacheTtl=180`.

> **Nota**: snapshot aging pasa a v2.

### TPL-08 �� PROCESS_TURNAROUND_BY_TYPE

- **answerSource**: `live_data`
- Descripción: tiempos de resolución (avg/min/p95/max) por tipo de proceso.
- Inputs: `buildingId?`, `period?` default mes actual, `monthsBack` 3 (1..12), `processTypes?`.
- Outputs: `table(metricsByType)` + `kpi(globalResolution)`, `coverage` obligatorio.
- Fuentes: P2-B + cálculo through módulo procesos.
- Clarifications: building, period.
- Guardrails: `maxRows=200`, joins: `ProcessInstance -> ProcessAudit` (fixed), `cacheTtl=120`.

### TPL-09 — COLLECTION_EFFICIENCY_BY_OCCUPANT_TYPE

- **answerSource**: `snapshot`
- Descripción: eficiencia de cobranza por tipo de ocupante (owner/tenant) con collectionRateBp.
- Inputs: `buildingId?`, `period` default LAST_CLOSED_MONTH, `topN` 5, `currency`.
- Outputs: `distribution(byOccupantType)` + `kpi(efficiency)`, `coverage` obligatorio.
- Fuentes: P2-A snapshots + `UnitOccupant` activo.
- Clarifications: building, period, currency.
- Guardrails: `maxRows=100`, joins: `Unit -> UnitOccupant` + métricas P2-A por unidad/building, `cacheTtl=300`.

### TPL-10 — EXECUTIVE_DASHBOARD_CROSS_MODULE

- **answerSource**: `snapshot`
- Descripción: vista ejecutiva consolidada financieras, ocupación y operación.
- Inputs: `buildingId?`, `period?` default mes actual o `monthsBack` 6 (1..12), `currency`.
- Outputs: `kpi(financial)` + `kpi(occupancy)` + `kpi(operations)` + `notes`, sin pagination.
- Fuentes: P2-A snapshots + P1 tickets + P2-B procesos.
- Clarifications: building, period, currency.
- Guardrails: `maxRows=1` agregado, merge determinista por período, `cacheTtl=900`.

---

## Allowlist (template → roles + params)

```typescript
const CROSS_TEMPLATE_ALLOWLIST = {
  'TPL-01': { roles: ['TENANT_OWNER','TENANT_ADMIN','OPERATOR'], params: ['buildingId','period','topN','currency','limit','cursor'] },
  'TPL-02': { roles: ['TENANT_OWNER','TENANT_ADMIN'], params: ['buildingId','period','currency','limit','cursor'] },
  'TPL-03': { roles: ['TENANT_OWNER','TENANT_ADMIN'], params: ['buildingId','period','topN','currency'] },
  'TPL-04': { roles: ['TENANT_OWNER','TENANT_ADMIN','OPERATOR'], params: ['buildingId','period','monthsBack','processTypes','statuses','overdueSla','topN'] },
  'TPL-05': { roles: ['TENANT_OWNER','TENANT_ADMIN','OPERATOR'], params: ['buildingId','assignedToUserId','monthsBack','limit','cursor','topN'] },
  'TPL-06': { roles: ['TENANT_OWNER','TENANT_ADMIN'], params: ['buildingId','monthsBack','currency'] },
  'TPL-07': { roles: ['TENANT_OWNER','TENANT_ADMIN'], params: ['buildingId','asOf','currency','topN'] },
  'TPL-08': { roles: ['TENANT_OWNER','TENANT_ADMIN'], params: ['buildingId','period','monthsBack','processTypes'] },
  'TPL-09': { roles: ['TENANT_OWNER','TENANT_ADMIN'], params: ['buildingId','period','topN','currency'] },
  'TPL-10': { roles: ['TENANT_OWNER','SUPER_ADMIN'], params: ['buildingId','period','monthsBack','currency'] }
} as const;
```

---

## Router/Manifest P3 (yoryi-ai-core)

```json
{
  "contractVersion": "2026-05-buildingos-p3-manifest-v1",
  "defaults": {
    "limit": 20,
    "maxLimit": 50,
    "topN": 5,
    "maxTopN": 50,
    "monthsBack": 6,
    "maxMonthsBack": 24,
    "maxClarifications": 2,
    "requireBuildingWhenMultiBuilding": true
  },
  "templates": [
    { "templateId": "TPL-01", "displayName": "Deuda unitaria con ocupación", "keywords": ["deuda por unidad","ocupacion","estado cuenta"], "required": ["period"], "answerSource": "snapshot" },
    { "templateId": "TPL-02", "displayName": "Pagos sin cargo", "keywords": ["pagos no aplicados","pagos sin cargo","conciliacion"], "required": ["period"], "answerSource": "live_data" },
    { "templateId": "TPL-03", "displayName": "Ingresos por categoría", "keywords": ["ingresos por categoria","charged collected categoria"], "required": ["period"], "answerSource": "snapshot" },
    { "templateId": "TPL-04", "displayName": "Carga de procesos por edificio", "keywords": ["procesos por edificio","carga operativa procesos"], "required": [], "answerSource": "live_data" },
    { "templateId": "TPL-05", "displayName": "Cola de trabajo cruzada", "keywords": ["pendientes","workqueue","acciones pendientes"], "required": [], "answerSource": "live_data" },
    { "templateId": "TPL-06", "displayName": "Tendencia ocupación vs cobranza", "keywords": ["tendencia ocupacion","evolucion cobranza","tendencia"], "required": ["monthsBack|period"], "answerSource": "snapshot" },
    { "templateId": "TPL-07", "displayName": "Antigüedad de deuda por edificio", "keywords": ["aging deuda","antiguedad mora"], "required": ["asOf|period"], "answerSource": "live_data" },
    { "templateId": "TPL-08", "displayName": "Tiempo de resolución de procesos", "keywords": ["tiempo resolucion","turnaround"], "required": ["period|monthsBack"], "answerSource": "live_data" },
    { "templateId": "TPL-09", "displayName": "Eficiencia de cobranza por ocupante", "keywords": ["eficiencia cobranza","owner tenant"], "required": ["period"], "answerSource": "snapshot" },
    { "templateId": "TPL-10", "displayName": "Dashboard ejecutivo", "keywords": ["dashboard","ejecutivo","resumen"], "required": ["period|monthsBack"], "answerSource": "snapshot" }
  ]
}
```

### Reglas clarify (máx 2)
1. `building` (si tenant multi-building y falta buildingId).
2. `period/currency/topN` (según template).

Si no alcanza en 2: `responseType=clarification` + safe fallback.

---

## Diseño de Tests (sin implementar)

### Tool tests (P3.1)
- Allowlist: template válido/inválido.
- Tenant isolation: siempre scoped por tenant.
- Role denied: matriz por template.
- No_data: formato conservado.
- Clamps: topN≤50, limit≤50, monthsBack≤24.
- Clarification cap: nunca >2.
- answerSource determinístico por template.

### Router tests (P3.2)
- Keyword principal → templateId correcto.
- Extracción params: building/period/topN/currency.
- requireBuildingWhenMultiBuilding=true.
- No intents por filtro.

### Smoke CI (P3.2)
- Job obligatorio **sin continue-on-error**.
- Gates: router contracts + tool contracts + 1 smoke happy path por template.
- Cualquiera falla → pipeline fail.

---

## Backlog por Fases

| Fase | Entregables | Criterio Done |
|------|-----------|--------------|
| **P3.1** | Tool `cross_query` + allowlist + adaptadores a P1/P2-A/P2-B + tool tests | 100% templates ejecutables, tenant isolation y role denied verdes |
| **P3.2** | Manifest + Router P3 + contract tests + smoke CI enforcing | Resolución determinista de template, clarifications cap=2 |
| **P3.3** | QA checklist + GO/NO-GO | staging PASS críticos, audit trail completo |

---

## Ajustes Realizados vs Diseño Anterior

| Ajuste | Antes | Ahora |
|--------|------|-------|
| collectionRate | 0 si charged=0 | **null** si charged=0, BP otherwise |
| answerSource | “live_data o snapshot” (ambiguo) | **Fijo por template** (determinístico) |
| period/monthsBack | “period\|monthsBack” ambiguo | **Mutuamente excluyentes** con precedencia |
| output error | genérico | **responseType + errorCode** obligatorio |
| TPL-05 orden | merge determinista | **sortKey fijo** (priority+overdue+createdAt+source+id) |
| TPL-07 snapshot | ambiguous | **live_data v1** (snapshot v2) |

---

## Metadata

- **Versión**: 1.0.0 (post PM approvals)
- **Creado**: 2026-04-25
- **Actualizado**: 2026-04-26
- **Owner**: Architecture Team
- **Estado**: Diseño/listo para implementación
- **Revisión**: Aprobado PM

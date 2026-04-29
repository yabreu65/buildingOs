# AI Priority Levels (P0–P3) — Estado canónico actual

> Fecha de consolidación: 2026-04-29  
> Alcance: **descriptivo** (no redefine contrato; consolida lo que ya existe en código/docs)

## 1) Definición actual (hoy)

## P0

**Definición actual:** capa operativa base read-only para consultas operativas directas (deuda unitaria, morosos, pagos pendientes, tickets abiertos, residente principal), con respuesta operativa priorizada y controlada.

**Evidencia:**
- Runtime/operación P0 y restricción de knowledge fallback: [`current-state.md`](./current-state.md#assistant-operativo-estado-actual), líneas 55–57.
- Decisión local de enforcement P0: [`local-decisions.md`](./local-decisions.md), BLD-DEC-010.
- Manifest de rutas/intents P0: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p0.json`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p0.json).
- Router P0: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p0-router.ts`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p0-router.ts).

**Intent codes representativos (existentes):** `GET_OVERDUE_UNITS`, `GET_PENDING_PAYMENTS`, `GET_OPEN_TICKETS`, `GET_UNIT_DEBT`, `GET_UNIT_PRIMARY_RESIDENT`.

---

## P1

**Definición actual:** capa operativa extendida (todavía read-only) para unitarias y agregadas operativas con más cobertura de cobranzas/tickets (ej. aging, deuda por torre, pagos sin comprobante, último pago, evolución por período), con clarificación cuando corresponde.

**Evidencia:**
- Manifest P1: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p1.json`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p1.json).
- Router P1: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p1-router.ts`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p1-router.ts).
- Release P1 router/observability (registro técnico): [`../../../yoryi-ai-core/docs/release-notes/P1-router-clarification-observability.md`](../../../yoryi-ai-core/docs/release-notes/P1-router-clarification-observability.md).

**Intent codes representativos (existentes):** `GET_LAST_PAYMENT`, `GET_DEBT_AGING`, `GET_DEBT_BY_TOWER`, `GET_UNIT_BALANCE_BY_PERIOD`, `GET_URGENT_UNASSIGNED_TICKETS` (además de intents heredados de P0).

---

## P2-A

**Definición actual:** historial/tendencias (snapshot) para deuda/cobranzas con ventana temporal (months-based), métricas y clamping de período.

**Evidencia:**
- Estado de módulo en current state: [`current-state.md`](./current-state.md#modulos-operativos-phase-2), línea 61.
- Release notes P2-A: [`../releases/P2-A.md`](../releases/P2-A.md) (contrato, tools, router, invariantes).
- Manifest P2-A: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p2.json`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p2.json).
- Router P2-A: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p2-router.ts`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p2-router.ts).

**Intent codes representativos (existentes):** `GET_UNIT_DEBT_TREND`, `GET_BUILDING_DEBT_TREND`, `GET_COLLECTIONS_TREND`, `GET_COLLECTION_RATE_TREND`.

---

## P2-B

**Definición actual:** process tracking con filtros complejos en modo **read-only** (liquidaciones, validaciones/aprobaciones, claims/reclamos), sin mutaciones de estado.

**Evidencia:**
- Estado de módulo en current state: [`current-state.md`](./current-state.md#modulos-operativos-phase-2), línea 62.
- Diseño P2-B (read-only explícito): [`p2-b-process-design.md`](./p2-b-process-design.md), líneas 10–15.
- Release P2-B: [`../releases/release-p2b.md`](../releases/release-p2b.md), alcance/invariantes.
- Manifest P2-B: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p2b.json`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p2b.json).
- Router P2-B: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p2b-router.ts`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p2b-router.ts).

**Intent codes representativos (existentes):** `SEARCH_PROCESSES`, `GET_PROCESS_SUMMARY`, `SEARCH_CLAIMS`, `SEARCH_LIQUIDATIONS`, `GET_OVERDUE_PROCESSES`.

---

## P3

**Definición actual:** consultas cross-module / dashboard (plantillas, workqueue y vistas ejecutivas) para síntesis operacional de más alto nivel.

**Evidencia:**
- Manifest P3: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p3.json`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/contracts/manifests/buildingos.p3.json).
- Router P3: [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p3-router.ts`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos-p3-router.ts).
- Diseño de referencia P3 (cross-module templates): [`../design/p3-cross-module-design.md`](../design/p3-cross-module-design.md).

**Intent codes representativos (existentes):** `EXECUTIVE_DASHBOARD`, `PENDING_ACTIONS`, `UNIT_DEBT_OCCUPANCY`, `DEBT_AGING_BY_BUILDING`, `COLLECTION_EFFICIENCY`.

---

## 2) Qué significa “P0 enforcement”

Enforcement P0 significa que, para consultas P0, se exige respuesta operativa válida y **no se acepta knowledge fallback**.

**Efecto operativo observado:**
- Si `ASSISTANT_P0_ENFORCEMENT_ENABLED=true`, en familia P0 sólo se permite `answerSource=live_data`; para otras familias se permite `live_data|snapshot`.
- En modo no enforced, se permite además `knowledge`.

**Evidencia:**
- Regla de política local: [`local-decisions.md`](./local-decisions.md), BLD-DEC-010.
- Estado operativo: [`current-state.md`](./current-state.md#assistant-operativo-estado-actual), línea 56.
- Implementación de validación: [`apps/api/src/assistant/assistant.service.ts`](../../apps/api/src/assistant/assistant.service.ts) (`isAllowedYoryiAnswerSource`, líneas 727–736).

---

## 3) Ejemplos reales por P (con intentCodes existentes)

- **P0 (Pagos/Reclamos):**
  - “¿Cuántas unidades morosas hay?” → `GET_OVERDUE_UNITS`
  - “Mostrame tickets abiertos” → `GET_OPEN_TICKETS`
- **P1 (Pagos unitarios / cobranzas operativas):**
  - “Último pago de la unidad A-1203 torre A” → `GET_LAST_PAYMENT`
  - “Deuda por antigüedad” → `GET_DEBT_AGING`
- **P2-A (Tendencias):**
  - “Evolución de morosidad últimos 6 meses” → `GET_BUILDING_DEBT_TREND`
  - “Tasa de cobranza del último año” → `GET_COLLECTION_RATE_TREND`
- **P2-B (Procesos/Reclamos):**
  - “Liquidaciones pendientes del período 2026-03” → `SEARCH_LIQUIDATIONS`
  - “Reclamos sin respuesta hace 7 días” → `SEARCH_CLAIMS`
- **P3 (Dashboards/Cross-query):**
  - “Dashboard ejecutivo” → `EXECUTIVE_DASHBOARD`
  - “Cola de trabajo” → `PENDING_ACTIONS`

Fuentes de ejemplos/intents: manifests y routers enlazados en cada sección, más checklist de consultas en [`../releases/release-p2b.md`](../releases/release-p2b.md).

---

## 4) Orden oficial de precedencia runtime

Orden oficial vigente:

`P0 → P1 → P2B → P2 → P3 → fallbacks`

**Evidencia en orquestador:**
- [`../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos.adapter.ts`](../../../yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos.adapter.ts)
  - `p0Route` (línea ~459)
  - `p1Route` (línea ~599)
  - `p2bRoute` (línea ~686)
  - `p2Route` (línea ~719)
  - `p3Route` (línea ~764)
  - luego `paymentFallback` y `readOnlyIntentClassifier`.

---

## 5) Nota de desambiguación

**Importante:**
- **“P de AI” (P0–P3 en routing/intents)** **NO** es lo mismo que
- **“P de roadmap”** o **“P de incidentes/SLA”**.

Evidencia de otras taxonomías con el mismo prefijo:
- Roadmap de producto (prioridad de entrega): [`../roadmap/ROADMAP_6M.md`](../roadmap/ROADMAP_6M.md) (“Priority Legend”).
- Severidad operativa de incidentes: [`../release/PILOT_SLA.md`](../release/PILOT_SLA.md) (P1/P2/P3 incident severity).


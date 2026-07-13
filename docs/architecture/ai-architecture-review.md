# AI Architecture Review — BuildingOS + yoryi-ai-core

Fecha: 2026-04-30
Repos revisados:
- `/Users/yoryiabreu/proyectos/buildingos`
- `/Users/yoryiabreu/proyectos/yoryi-ai-core`

## Context docs consultados

- `/Users/yoryiabreu/proyectos/buildingos/AGENTS.md`
- `/Users/yoryiabreu/proyectos/buildingos/docs/architecture/current-state.md`
- `/Users/yoryiabreu/proyectos/buildingos/docs/architecture/constraints.md`
- `/Users/yoryiabreu/proyectos/buildingos/docs/architecture/local-decisions.md`
- `/Users/yoryiabreu/proyectos/yoryi-core-architecture/AGENTS.md`
- `/Users/yoryiabreu/proyectos/yoryi-core-architecture/checks/architecture/planning-quality-scorecard.md`

## Fase 0 — Diagnóstico as-is

### Flujo real

```text
BuildingOS UI
  -> BuildingOS API /tenants/:tenantId/assistant/chat
  -> AssistantService valida tenant/roles/rate limit
  -> tryYoryiReadOnlyResponse()
  -> yoryi engine /assistant/chat
  -> yoryi ChatService prioriza adapter.resolveDataBackedAnswer()
  -> BuildingOSAdapter aplica Intent Library / routers / tools / fallback
  -> provenance.sources[0].metadata vuelve al bridge
  -> yoryi-bridge.mapper normaliza a CanonicalAssistantResponse
  -> BuildingOS bloquea respuestas operativas no-live_data y aplica HITL si corresponde
```

### Responsabilidades

- BuildingOS: bridge, API pública, auth/tenant context, UI/HITL/ops, persistencia operacional.
- yoryi-ai-core: engine, orquestación, Intent Library, matcher, defaults semánticos, tools read-only y metadata de decisión.
- Bridge/UI: no inventan clarificaciones de negocio; sólo renderizan `missingEntities`/respuesta del engine.

### Evidence map

| Path | Regla/hecho actual |
| --- | --- |
| `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/assistant.controller.ts` | Expone `/tenants/:tenantId/assistant/chat` con guards de JWT/tenant/feature. |
| `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/assistant.service.ts` | Bridge llama al engine y bloquea knowledge fallback para respuestas operativas. |
| `/Users/yoryiabreu/proyectos/buildingos/apps/api/src/assistant/yoryi-bridge.mapper.ts` | Normaliza metadata desde provenance y fallback root metadata. |
| `/Users/yoryiabreu/proyectos/yoryi-ai-core/apps/ai-assistant-api/src/assistant/assistant.controller.ts` | Expone `/assistant/chat`. |
| `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-core/src/chat.service.ts` | Ejecuta `resolveDataBackedAnswer()` antes de conocimiento/fallback. |
| `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos.adapter.ts` | Implementa precedencia real: prechecks, Intent Library, P0/P1/P2B/P2/P3/fallbacks. |
| `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/intent-matcher.ts` | Matcher semántico P0/P1. |
| `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/tool-executor.ts` | Ejecuta tools read-only desde bindings de intents. |
| `/Users/yoryiabreu/proyectos/buildingos/apps/api/prisma/schema.prisma` | Schema incluye `AssistantHandoff`, `AssistantMessage`, `OpsAlert`. |
| `/Users/yoryiabreu/proyectos/buildingos/scripts/pre-commit-deny-dangerous.sh` | Gate local contra comandos peligrosos de reset. |

### Drift detectado

- `apps/api/package.json` exponía `migrate:reset` con `prisma migrate reset --force`; queda removido.
- Ops consultaba columnas/tables recientes sin readiness guard; queda agregado `schema:check` y manejo controlado de drift.
- Metadata estable y debug estaban mezcladas; se separa contrato estable vs debug/canary.

## Fase 1 — Families + gates

### Cambio ejecutado

- Agregado `family?: IntentFamily` en `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/schema.ts`.
- Familias cargadas en:
  - `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/intent-library.p0.json`
  - `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/intent-library.p1.json`
- Gate previo al scoring en `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/intent-matcher.ts`.

### Backward compatibility

- Intents sin `family` siguen elegibles como `LEGACY`/sin familia.
- `matchedUtterance` y `topCandidates` siguen internos/debug; no son contrato estable.
- `familyChosen` sí entra al contrato estable desde esta línea de trabajo.

### Tests obligatorios

- `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/__tests__/intent-matcher.family.spec.ts`
- `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/qa/family-confusion-matrix.spec.ts`

## Fase 2 — Clarifications + defaults

### Qué ya existía

- `applyMissingEntityDefaults` ya existía en `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos.adapter.ts`.
- Clarificaciones por entity ya estaban en Intent Library JSON mediante `clarificationQuestions`.

### Gap real cerrado

- Defaults ahora se aplican antes de decidir clarificación.
- `missingEntities` se recalcula después de defaults.
- `defaultsApplied` queda en metadata.
- Si quedan entities faltantes, no se ejecuta tool.

### Tabla entity faltante

| Entity | Mensaje fuente | Default |
| --- | --- | --- |
| `period` en `TOTAL`, `OVERDUE`, `AGING`, `TOP_N`, `BREAKDOWN` | `missingPeriod` si no aplica default | `today` snapshot actual |
| `period` en `TREND` | `missingPeriod` si negocio requiere explícito | mes actual `YYYY-MM` |
| `buildingId` | `missingBuildingId` | sin default; pedir edificio |
| `unitId` | `missingUnitId` | sin default; pedir unidad |
| `towerId` | `missingTowerId` | sin default; pedir torre |

### Tests obligatorios

- `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/__tests__/intent-library.defaults.spec.ts`
- Existing defaults specs actualizados en `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/buildingos.adapter.spec.ts`.

## Fase 3 — Contrato de observabilidad

### Contrato estable

- `traceId`
- `tenantId`
- `role`
- `resolvedLevel`
- `resolvedIntentCode`
- `familyChosen`
- `fallbackPath`
- `gatewayOutcome`
- `missingEntities`
- `defaultsApplied`

### Debug/canary only

- `matchedUtterance`
- `topCandidates`

### ADR

ADR requerido: sí. Motivo: `resolvedPath` cambia contrato cross-repo y debe quedar versionado entre engine y bridge. Hasta aprobar ese ADR, `resolvedPath` queda fuera del contrato estable. La implementación mantiene `matchedUtterance/topCandidates` fuera del contrato estable.

### Response válido

```json
{
  "answer": "Deuda total del edificio: $70.000",
  "answerSource": "live_data",
  "responseType": "exact",
  "provenance": {
    "sources": [
      {
        "metadata": {
          "traceId": "TR-1",
          "tenantId": "tenant-1",
          "role": "TENANT_ADMIN",
          "resolvedLevel": "P0",
          "resolvedIntentCode": "GET_BUILDING_DEBT_TOTAL",
          "familyChosen": "TOTAL",
          "fallbackPath": "cache_miss",
          "gatewayOutcome": "cache_miss",
          "missingEntities": [],
          "defaultsApplied": ["period"]
        }
      }
    ]
  }
}
```

## Fase 4 — QA de regresión

### Confusion matrix

- Dataset admin: `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/qa/families-admin.qa.json`
- Dataset resident: `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/qa/families-resident.qa.json`
- Dataset robustness: `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/qa/families-robustness.qa.json`
- Runner: `/Users/yoryiabreu/proyectos/yoryi-ai-core/packages/ai-adapters/src/buildingos/intent-library/qa/family-confusion-matrix.spec.ts`

### PASS/FAIL

- FAIL si `actualFamily !== expectedFamily` en casos determinísticos.
- FAIL hard si `TOP_N` cae en `BREAKDOWN`.
- `topCandidates` sólo se exige en tests debug/canary, nunca como contrato estable.

### Reporte `.md`

Formato recomendado: matriz `expectedFamily x actualFamily`, total de casos, fallos por id, y sección `hard_failures`.

## Fase 5 — DB/Ops

| Error | Causa | Fix | Migración/guard |
| --- | --- | --- | --- |
| `AssistantMessage` inexistente | Migración no aplicada | Alinear schema/migración incremental | `schema:check` valida tabla |
| `resolvedAt`/`assignedAt` inexistente | Drift schema vs queries | Migración incremental existente + safe query handling | `schema:check` valida columnas |
| Worker en loop por drift | Job reintenta excepción no controlada | Worker clasifica drift y loguea una vez | Guard en `OpsMetricsWorker` |
| Reset destructivo expuesto | Script `migrate:reset` | Removido y precommit bloquea patrones | `pre-commit-deny-dangerous.sh` |

### Comandos seguros

- `npm run migrate:status -w apps/api`
- `npm run migrate:deploy -w apps/api`
- `npm run schema:check -w apps/api`
- No usar `prisma migrate reset`, `--force-reset` ni scripts equivalentes.

## Plan por PRs

1. Documento + ADR baseline.
2. Families + matcher gates.
3. Clarifications/defaults hardening.
4. QA runner por families.
5. ADR + observability contract para `resolvedPath` si corresponde.
6. DB/Ops hardening.

## Riesgos y mitigaciones

- Riesgo: false positives del gate por familias. Mitigación: confusion matrix determinística y robustness dataset.
- Riesgo: drift cross-repo del contrato. Mitigación: bloquear `resolvedPath` como estable hasta ADR + `assistant-turn-metadata.contract.spec.ts` + mapper tests.
- Riesgo: romper intents legacy sin family. Mitigación: compatibilidad para `undefined`/`LEGACY`.
- Riesgo: jobs ops en loop. Mitigación: readiness guard + errores controlados.

## Checklist de salida por fase

- Fase 0: evidence map completo y gaps explícitos.
- Fase 1: `familyChosen` estable, TOP_N no cae en BREAKDOWN.
- Fase 2: defaults antes de clarificación, `missingEntities` recalculado, `defaultsApplied` emitido.
- Fase 3: ADR requerido registrado antes de promover `resolvedPath` a contrato estable; debug fuera de contrato.
- Fase 4: confusion matrix falla con mismatch determinístico.
- Fase 5: reset removido, schema guard agregado, worker no explota en loop por drift.

## ADR required / not required

- Required: contrato cross-repo de observabilidad que promueva `resolvedPath` a metadata estable.
- Not required: agregar `family` a intents y gates internos; es decisión de matching interna compatible hacia atrás.
- Not required: hardening de defaults; refactor de implementación existente sin excepción arquitectónica.
- Required si cambia: cualquier excepción permanente al orden oficial `Prechecks → Intent Library → P0 → P1 → P2B → P2 → P3(flag) → fallbacks → HITL`.

## Planning quality scorecard

- Context coverage: 2/2
- Evidence traceability: 2/2
- Anti-hallucination discipline: 2/2
- Decision quality: 2/2
- Governance compliance: 2/2
- Execution readiness: 2/2
- Total: 12/12

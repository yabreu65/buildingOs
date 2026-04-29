# Release P2-B — Procesos (Read-Only) con filtros complejos

## Estado
✅ DONE — QA críticos PASS (C01–C11)

## Objetivo
Habilitar consultas operativas sobre **procesos** (liquidaciones, aprobaciones y reclamos/tickets) con **filtros combinables**, en modo **READ-ONLY**, con respuesta data-backed y sin fallback doctrinal.

## Alcance (v1)
- Modelo mínimo: `ProcessInstance` + `ProcessAudit` con soporte SLA.
- Tools read-only:
  - `search_processes(filters)`
  - `get_process_summary(filters)`
  - `search_claims(filters)` (si aplica)
- Router/manifest P2-B en yoryi-ai-core con extracción de filtros:
  - status, processType, period(YYYY-MM), createdAfter (ISO), overdueSla, assigned, priority
- Paginación: `limit + cursor` (cursor-first), `hasMore`, `totalCount` opcional.
- Respuestas:
  - `answerSource=live_data`
  - siempre `asOf`
  - metadata de observabilidad (traceId, latency, outcome, etc.)

## Invariantes (NO negociables)
- **No intents por filtro**: todo filtro va en `toolInput`, no se crean intents tipo `SEARCH_PENDING_LIQUIDATIONS`.
  - Ejemplo: "liquidaciones pendientes" => `SEARCH_PROCESSES + {processTypes:[LIQUIDATION], statuses:[PENDING]}`
- Multi-tenant estricto: no cross-tenant.
- RBAC env-driven (sin hardcode por rol).
- No knowledge fallback para consultas operativas: solo `live_data`, `clarification` o `no_data`.
- Max clarifications = 2.

## Ejemplos de preguntas soportadas
- "Liquidaciones pendientes de aprobación del período 2026-03"
- "Reclamos sin respuesta hace 7 días"
- "Procesos vencidos fuera de SLA"
- "Procesos urgentes sin asignar del edificio X"
- "Resumen de procesos pendientes del edificio X"
- "Dame más resultados" (cursor)

## QA / GO-NO-GO
Checklist: `docs/qa/qa-checklist-p2b.md`

GO si:
- Casos críticos C01–C11 = PASS

## Cómo probar (local)
- Correr tests del router P2-B (yoryi-ai-core): `vitest run src/buildingos/buildingos-p2b-router.spec.ts`
- Correr tests tools P2-B (BuildingOS): (comando del repo)
- Smoke manual:
  1) "Liquidaciones pendientes de aprobación del período 2026-03"
  2) "Reclamos sin respuesta hace 7 días"
  3) "Procesos vencidos fuera de SLA"
  4) "Dame más resultados"

## Notas técnicas
- READ-ONLY v1: no ejecuta aprobaciones ni cambios de estado.
- Cursor-first: offset solo legacy si existe.
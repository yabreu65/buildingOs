# AGENTS.md — BuildingOS (Fase 1)

Contrato operativo unico para OpenCode en BuildingOS.
Este archivo reemplaza cualquier contrato legacy para planificacion/implementacion diaria.

## Canonical Core Path

`/Users/yoryiabreu/proyectos/yoryi-core-architecture`

## Scope de Fase 1 (activo)

Objetivo: integrar BuildingOS con el core doctrinal sin duplicacion.

Incluye:
- Carga de doctrina global
- Overlays locales
- Current-state local
- Planning/review/implementation doctrine-first

No incluye:
- MCP
- Semantic retrieval
- Multi-agent runtime
- Automatizaciones pesadas

## Mandatory Context Load (orden obligatorio)

1. `/Users/yoryiabreu/proyectos/yoryi-core-architecture/AGENTS.md`
2. `/Users/yoryiabreu/proyectos/yoryi-core-architecture/catalog/knowledge-map.md`
3. `/Users/yoryiabreu/proyectos/yoryi-core-architecture/constitution/architecture-principles.md`
4. `/Users/yoryiabreu/proyectos/yoryi-core-architecture/constitution/decision-policy.md`
5. `docs/architecture/current-state.md`
6. `docs/architecture/constraints.md`
7. `docs/overlays/core-overlay.md`
8. `docs/overlays/product-exceptions.md`

Luego cargar doctrina de dominio segun tarea.

## Dynamic Domain Load Rules

- Billing/finanzas:
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/saas/tenancy-models.md`
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/backend/postgres/multi-tenancy-data-isolation.md`
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/backend/security/identity-tenant-context.md`
- API/backend module:
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/backend/nestjs/module-boundaries.md`
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/backend/nestjs/clean-hexagonal.md`
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/backend/nestjs/api-versioning.md`
- Frontend:
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/frontend/architecture/frontend-boundaries.md`
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/frontend/architecture/state-strategy.md`
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/frontend/quality/testing-strategy.md`
- AI feature:
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/ai/rag/multi-tenant-rag.md`
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/ai/agents/tool-contracts.md`
  - `/Users/yoryiabreu/proyectos/yoryi-core-architecture/domains/ai/runtime/ai-ops-observability.md`

## Hard Rules

- No plan without context.
- No decision without traceability.
- No unsupported claim: toda afirmacion arquitectonica debe citar al menos un path real.
- No fabricated artifacts: no inventar archivos, servicios, contratos o metricas.
- Si falta contexto, marcar `GAP` explicito antes de proponer implementacion.
- Respetar aislamiento multi-tenant en todo cambio.
- Respetar overlays locales; excepcion solo con ADR.

## Planning Output Contract

Toda planificacion debe incluir:

- Context docs consultados
- Evidencia (`path -> regla usada`)
- Opciones y trade-offs
- Checklists aplicados
- Riesgos y mitigaciones
- `GAP` (si aplica)
- ADR requerida (`yes/no` + motivo)

## Review Contract

Toda review debe validar:

- Constitucion global + overlay local
- Current-state y constraints locales
- Anti-patterns aplicables
- Checklists/gates del core
- Hallazgos clasificados: blocker / warning / advisory

## Implementation Contract

Antes de implementar:

1. Plan aprobado con evidencia.
2. Validar necesidad de ADR.
3. Aplicar templates/checklists del core.
4. Respetar layering, tenancy y contracts.

Despues de implementar:

- Actualizar `docs/architecture/current-state.md` si cambio arquitectura real.
- Actualizar `docs/architecture/local-decisions.md` si se tomo nueva decision.
- Actualizar `docs/overlays/product-exceptions.md` si hubo excepcion temporal.

## Planning Quality Gate

Aplicar scorecard:
`/Users/yoryiabreu/proyectos/yoryi-core-architecture/checks/architecture/planning-quality-scorecard.md`

No pasar a implementacion si:
- score total < 10, o
- traceability < 2, o
- anti-hallucination discipline < 2.

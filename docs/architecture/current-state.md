# BuildingOS Current State

## Estado del sistema (Fase 1)

- Producto: BuildingOS
- Tipo: SaaS multi-tenant
- Etapa de integracion doctrinal: Fase 1 (integracion simple)

## Stack actual confirmado

- Monorepo npm workspaces (`apps/*`, `packages/*`)
- Backend: NestJS + Prisma (`apps/api`)
- Frontend: Next.js (`apps/web`)
- DB principal: PostgreSQL (via Prisma)
- Infra local: Docker Compose en `infra/docker/*`

## Tenancy y seguridad (estado actual conocido)

- Multi-tenant obligatorio
- Regla operacional existente: datos aislados por `tenantId`
- Roles de negocio existentes (documentados en repo): `SUPER_ADMIN`, `TENANT_OWNER`, `TENANT_ADMIN`, `OPERATOR`, `RESIDENT`
- Restriccion critica: prohibido cross-tenant access
- Tenant context: en transicion a resolucion centralizada (`resolveTenantId`) en modulos criticos
- DB isolation: RLS piloto inicial habilitado en tablas sensibles con rollout gradual
- RLS mode toggle disponible (`permissive`/`strict`) para endurecimiento por canary sin big-bang

## Fronteras de aplicacion (alto nivel)

- `apps/api`: contratos backend, dominio, persistencia, authz/authn
- `apps/web`: UI, consumo de APIs, flujos de usuario
- `infra/`: entorno y ejecucion operativa local

## Deuda de contexto (importante)

El repositorio tiene alto volumen de documentacion legacy en raiz.
Para OpenCode diario, la fuente operativa prioritaria es:

1. Core doctrinal global
2. `docs/architecture/*` (este folder)
3. `docs/overlays/*` (este folder)

## Gaps actuales a vigilar

- Mapa de bounded contexts detallado aun no consolidado en un solo doc local.
- Matriz formal de contratos API criticos por modulo aun no centralizada.
- Lista canonica de ADRs locales aun incipiente.

## Operacion automatizada (estado actual)

- Cronjobs operativos de finanzas/tickets quedan en modo opt-in por variables de entorno.
- Triggers manuales de cron en dev/staging requieren habilitacion explicita por env y rol admin (`SUPER_ADMIN`/`TENANT_OWNER`/`TENANT_ADMIN`).

## Assistant operativo (estado actual)

- Runtime P0 con priorizacion de engine externo (`yoryi-ai-core`) por flag de entorno.
- Respuestas operativas P0 rechazan `answerSource=knowledge`; fallback local solo por indisponibilidad/disable del engine primario.
- Endpoint interno tools-based disponible en `apps/api/src/assistant/tools.controller.ts` con allowlist y auditoria por tenant.

## Modulos operativos (Phase 2)

- **P2-A**: Debt & Collections (read-only, months-based) — DONE
- **P2-B**: Process Tracking (read-only, filters) — DONE
- **P2-C**: (pendiente)

## Regla de actualizacion

Actualizar este archivo cuando cambie:
- arquitectura real
- fronteras de modulos
- stack principal
- constraints operacionales relevantes

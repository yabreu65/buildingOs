# BuildingOS Constraints

## Objetivo

Documentar restricciones no negociables para planificacion y ejecucion.

## Restricciones tecnicas (hard)

- Mantener monorepo npm workspaces (sin migrar de package manager en Fase 1).
- Backend en NestJS + Prisma.
- Frontend en Next.js.
- PostgreSQL como store transaccional principal.
- Cambios de schema solo con migraciones Prisma.

## Restricciones de seguridad y tenancy (hard)

- Todo acceso de datos debe estar scoped por `tenantId`.
- Prohibido acceso cross-tenant.
- Validacion de permisos por rol obligatoria.
- Secretos solo por variables de entorno (nunca hardcode).

## Restricciones de integracion doctrinal (hard)

- Core doctrinal es fuente unica global:
  `/Users/yoryiabreu/proyectos/yoryi-core-architecture`
- Prohibido copiar docs del core dentro de BuildingOS.
- Overlays locales no pueden reemplazar constitucion global.
- Excepciones locales requieren ADR + expiracion.

## Restricciones de operacion de agentes (hard)

- Evidence paths obligatorios en planning/review.
- Si falta contexto: marcar `GAP`, no inventar.
- Planning quality gate obligatorio antes de implementar.

## Fuera de alcance en Fase 1

- MCP
- Semantic retrieval
- Multi-agent runtime
- Orquestacion compleja
- Automatizacion pesada de governance

## Restricciones de documentacion

- `current-state.md`: estado real, no vision especulativa.
- `local-decisions.md`: decisiones locales con fecha y motivo.
- `product-exceptions.md`: solo excepciones activas y vigentes.

## Regla de cambio

Si una constraint cambia:
1. actualizar este archivo,
2. validar impacto en overlays,
3. registrar decision en `local-decisions.md` y ADR si aplica.

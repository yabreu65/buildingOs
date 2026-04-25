# BuildingOS Core Overlay

## Proposito

Explicar como BuildingOS aplica la doctrina global del core sin duplicarla.

Core canonico:
`/Users/yoryiabreu/proyectos/yoryi-core-architecture`

## Herencia global (obligatoria)

BuildingOS hereda sin cambios:

- `constitution/architecture-principles.md`
- `constitution/decision-policy.md`
- `checks/delivery/release-gates.md`
- `checks/architecture/planning-quality-scorecard.md`

## Aplicacion local por dominio

### SaaS / Tenancy

- Regla global: tenant safety first.
- Aplicacion BuildingOS: todo flujo de datos se diseña con scoping por `tenantId`.
- Enforcement local: cualquier plan que no pruebe tenant boundary se bloquea.

### Backend / NestJS

- Regla global: module boundaries + contracts over coupling.
- Aplicacion BuildingOS: evitar imports cruzados de internals entre modulos.
- Enforcement local: cambios API/modulo pasan por checklist + review.

### Frontend

- Regla global: limites de arquitectura frontend + estrategia de estado.
- Aplicacion BuildingOS: separar UI state, client state y server state; no acoplar UI a infraestructura.

### Operaciones

- Regla global: incident response + migration rollout.
- Aplicacion BuildingOS: cambios criticos se preparan con playbooks y rollback explicito.

## Carga recomendada por tipo de tarea

- Billing: tenancy + backend + security + release gates.
- Modulo frontend: frontend architecture + testing + observability.
- Seguridad/auth: tenant context + release gates + anti-patterns.
- Cambio operativo: operations playbooks + governance docs.

## Politica de conflictos

Si overlay local contradice constitucion global:
1. gana constitucion global,
2. salvo ADR explicita y vigente.

## Regla anti-deriva

Este overlay solo mapea aplicacion local.
No define principios globales nuevos.

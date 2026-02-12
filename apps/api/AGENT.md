# AGENT — API (BuildingOS)

## Propósito
Backend multi-tenant y RBAC. Fuente de verdad de reglas críticas y contratos de datos.

## Alcance (sí hacemos)
- Endpoints (REST/GraphQL según stack)
- Autenticación y autorización por roles:
  - SUPER_ADMIN, TENANT_OWNER, TENANT_ADMIN, OPERATOR, RESIDENT
- Aislamiento multi-tenant en todas las operaciones
- Validaciones/constraints (unicidad, integridad)
- Auditoría mínima (logs de acciones sensibles)

## Fuera de alcance (no hacemos)
- Lógica duplicada por tipo de tenant (ADMINISTRADORA vs AUTOGESTION)
- Reglas hardcodeadas por “cliente grande/chico”
- UI/Rendering (eso es frontend)
- Persistir “nombres libres” donde deben ser relaciones (ej. residentName)

## Reglas obligatorias
- Todas las entidades deben estar scoping por `tenantId`
- Prohibido cross-tenant access (siempre validar tenant)
- Units:
  - `buildingId` obligatorio
  - `label` único por building (normalize: trim+lowercase)
  - `unitCode` único por building si existe
- Relación Unit↔Resident:
  - `UnitResident` histórico con `endAt` (no texto libre)
  - máximo 1 activo por unidad (endAt null)

## Contratos (lo que API expone)
- Tenants (cuando toque capa SUPER_ADMIN → full stack)
- Buildings:
  - GET /buildings
  - POST /buildings
- Units:
  - POST /buildings/:buildingId/units
  - GET /buildings/:buildingId/units
  - PATCH /units/:unitId
  - DELETE /units/:unitId (según regla)
- UnitResidents:
  - POST /units/:unitId/residents (assign)
  - PATCH /units/:unitId/residents/:id (endAt)

## Convenciones
- Errores: mensajes claros + códigos consistentes
- Validaciones: server-side siempre (frontend solo UX)
- Logs: acciones sensibles (suspender tenant, cambios de plan, etc.)

## Checklist PR
- [ ] Tenant scoping en queries/commands
- [ ] Autorización por rol en endpoints
- [ ] Tests relevantes (unit/integration)
- [ ] No rompe contratos existentes (o versión/documentación)
- [ ] Documentación de endpoints actualizada

## Owners
- Owner: Backend Lead
- Reviewers: Tech Lead + PM (cuando afecta reglas)

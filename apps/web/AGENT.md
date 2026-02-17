# AGENT — Frontend (BuildingOS)

## Propósito
UI Web del SaaS con navegación por capas:
SUPER_ADMIN → TENANT → BUILDINGS → UNITS → RESIDENTS

## Alcance (sí hacemos)
- Pantallas, formularios, tablas, modales
- Validaciones UX (pre-checks) + manejo de errores
- Integración con storage (MVP localStorage) o API (full stack)
- Guards de acceso por rol + contexto (activeTenantId)

## Fuera de alcance (no hacemos)
- Reglas críticas (unicidad real, permisos finales) sin backend (en full stack)
- Hardcode por tipo/tamaño de tenant
- Guardar datos “free text” cuando deben ser entidades (ej. residentName)

## Reglas obligatorias
- Siempre operar bajo `activeTenantId`
- Units siempre bajo un Building (no “Units global”)
- Inputs:
  - label trim
  - unitCode empty→undefined
- Residente:
  - mostrar “residente actual” via relación UnitResident (activo endAt null)

## Convenciones
- Formularios: React Hook Form + Zod
- Estado: hooks + storage tick (`emitBoStorageChange` / `useBoStorageTick`)
- Copys:
  - “Property ID” → “Código/External ID”
  - “Residente” nunca es texto libre

## Cómo correr
- dev/test/build: según scripts del repo

## Checklist PR
- [ ] Respeta navegación por capas (sin pantallas “sueltas”)
- [ ] Respeta multi-tenant (keys con tenantId o calls con tenantId)
- [ ] Inputs limpiados antes de persistir
- [ ] QA checklist adjunto (si aplica)

## Owners
- Owner: Frontend Lead
- Reviewers: Tech Lead + PM

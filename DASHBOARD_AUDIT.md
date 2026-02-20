# Auditoría de dashboards jerárquicos vs estado actual del repositorio

## Resumen ejecutivo

El repositorio hoy **sí tiene base de multi-tenant y autenticación** (login, JWT, memberships y roles), pero **todavía no implementa** dashboards por nivel (SUPER_ADMIN, TENANT, BUILDING, UNIT), navegación jerárquica, ni la capa de Asistente contextual.

## Lo que ya existe (base sólida)

- Login con `email/password` y endpoint `/auth/login`.
- JWT con flag `isSuperAdmin` en el payload.
- Modelo de membresías por tenant con múltiples roles por usuario.
- Permisos RBAC iniciales y helper `can()`.

## Brechas contra el diseño propuesto

### 1) Flujo macro de navegación por contexto

**Esperado**: `Login -> Tenant -> Building -> Unit`, con contexto activo.

**Actual**:
- El backend devuelve memberships por tenant en login.
- No existe mecanismo completo de `buildingId` / `unitId` como contexto activo en API.
- No hay frontend implementado en este repo para representar selectors y dashboards.

### 2) Dashboard SUPER_ADMIN

**Esperado**:
- KPIs globales SaaS, gestión de tenants, billing, soporte, auditoría global, config global.

**Actual**:
- Solo existe inferencia de superadmin por rol (`SUPER_ADMIN`) en auth.
- No hay módulos/entidades para tickets globales, incidentes, billing SaaS ni auditoría global.

### 3) Dashboard TENANT

**Esperado**:
- Selector de edificios, bandeja unificada, usuarios/roles por scope, configuración e integraciones por tenant.

**Actual**:
- Existe membresía por tenant y roles del usuario.
- No existen entidades de edificio, bandejas operativas, ni APIs de configuración tenant.

### 4) Dashboard BUILDING

**Esperado**:
- Operación diaria (reclamos, comunicados, unidades, residentes, proveedores, finanzas).

**Actual**:
- No existe modelo `Building` ni `Unit` en Prisma actual.
- Tampoco endpoints para reclamos/comunicados/finanzas/documentos.

### 5) Dashboard UNIT + residente

**Esperado**:
- Estado de cuenta, reclamos, comunicados, perfil de convivientes/autorizados.

**Actual**:
- Existe rol `RESIDENT`, pero no existe scope por unidad ni módulos funcionales asociados.

### 6) Asistente transversal contextual

**Esperado**:
- Asistente visible en todos los dashboards con contexto tenant/building/unit y permisos.

**Actual**:
- No hay módulo de asistente ni endpoints para consultas contextuales.

## Reglas críticas: estado actual

- Regla “toda request de negocio requiere `tenantId`”: **parcial** (solo auth/memberships; no capa de negocio completa).
- Regla de pertenencia `buildingId/unitId` al tenant activo: **no implementada**.
- Multi-rol por usuario: **sí soportado** a nivel de membresía+roles.
- UI mostrando solo acciones permitidas: **no evaluable** (sin frontend funcional en repo).

## Recomendación de implementación por fases

1. **Modelo de datos**: agregar `Building`, `Unit`, `ResidentProfile`, `Ticket`, `Communication`, `Invoice/Payment`, `AuditLog`.
2. **Contexto obligatorio**: middleware/guard para validar `tenantId` y pertenencia de `buildingId/unitId`.
3. **RBAC por scope**: extender permisos actuales a recursos building/unit.
4. **APIs de dashboards**: endpoints agregados por nivel (superadmin/tenant/building/unit).
5. **Frontend navegable**: selectors de contexto + dashboards jerárquicos.
6. **Asistente transversal**: endpoint único con inyección de contexto activo y policy checks.

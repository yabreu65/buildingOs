# BuildingOS — Memoria Viva del Proyecto (Single Source of Truth)
Última actualización: 2026-02-15

## 0) Objetivo de esta memoria
Evitar ambigüedad. Mantener consistencia técnica y de producto.
Todo prompt a Claude debe basarse en esta memoria.

---

## 1) Stack & Runtime
- Frontend: Next.js (App Router)
- Backend: NestJS
- ORM: Prisma
- DB: PostgreSQL (local)
- Web: http://localhost:3000
- API: http://localhost:4000

---

## 2) Producto & Multi-tenancy
- Un solo SaaS multi-tenant.
- Tenant = organización cliente.
- Tipos de tenant:
  - ADMINISTRADORA
  - EDIFICIO_AUTOGESTION
- Aislamiento estricto por tenant en:
  - usuarios / memberships
  - edificios
  - unidades
  - pagos
  - reclamos
  - comunicaciones
  - configuración
- Prohibido cross-tenant (en backend y frontend).

---

## 3) Roles & RBAC
Roles:
- SUPER_ADMIN (dueño del SaaS)
- TENANT_OWNER
- TENANT_ADMIN
- OPERATOR (opcional)
- RESIDENT

Reglas:
- Un usuario puede tener múltiples roles (mínimo dentro del tenant).
- RBAC se aplica en: backend guards + queries + routing/layout + UI.
- Nunca renderizar UI ni fetchear data antes de validar rol/tenant.

---

## 4) Rutas (App Router)
### 4.1 Super Admin
- Base: /super-admin
- Subrutas conocidas:
  - /super-admin/tenants
  - /super-admin/overview (si existe)
  - /super-admin/audit-logs (si existe)
  - /super-admin/users (si existe)

### 4.2 Tenant (actual)
- Base actual: /[tenantId]/...
- Ejemplos usados en tests:
  - /{tenantId}/dashboard
  - /{tenantId}/buildings
  - /{tenantId}/buildings/{buildingId}/units

⚠️ Nota de spec (posible migración):
- Spec deseada: /t/[tenantId]/b/[buildingId]/units (pendiente decisión/migración)

---

## 5) Layout Guards (separación crítica)
Objetivo: separación TOTAL SUPER_ADMIN vs TENANT.
- SUPER_ADMIN:
  - Login → redirect a /super-admin
  - Si intenta rutas tenant → bloquea y redirect a /super-admin
  - No debe existir “flash/flicker” de UI tenant
  - No debe hacer API calls a endpoints tenant

- TENANT_ADMIN (o roles tenant):
  - Login → redirect a /{tenantId}/dashboard
  - Si intenta /super-admin → bloquea (preferido: /login o volver a tenant)
  - Refresh en rutas profundas tenant debe persistir sin redirect incorrecto

Archivos relevantes mencionados:
- apps/web/features/auth/useAuth.ts
- apps/web/app/(tenant)/[tenantId]/layout.tsx
- apps/web/app/super-admin/layout.tsx
- apps/web/shared/components/layout/Sidebar.tsx

---

## 6) Credenciales Seed (DEV)
SUPER_ADMIN:
- Email: superadmin@demo.com
- Password: SuperAdmin123!

(Agregar aquí users tenant reales del seed)
TENANT_ADMIN:
- Email: TODO
- Password: TODO

---

## 7) Modelo de Datos (Prisma) — (completar con tu schema real)
Entidades mínimas esperadas:
- User
- Tenant
- Membership (user ↔ tenant + roles)
- Building
- Unit
- Resident (o UnitResident)
- Payment (si existe)
- AuditEvent (si existe)

Reglas DB:
- Todas las entidades “tenant-owned” deben tener tenantId.
- Queries SIEMPRE filtran tenantId según la sesión/membership.
- SUPER_ADMIN NO debe leer data tenant por defecto.

---

## 8) Convenciones de Ingeniería
- No hardcode por tamaño de cliente.
- Configuración + permisos.
- Nada crítico en frontend: el backend enforcea tenant+RBAC.
- Cualquier fetch tenant requiere:
  1) sesión válida
  2) membership valida
  3) tenantId autorizado

---

## 9) Manual Test Suite (criterio de aceptación)
Documento: "Manual Testing Execution: SUPER_ADMIN vs TENANT Separation"
Estado: pendiente / en ejecución manual.
Criterios críticos FAIL:
- cualquier flash de UI incorrecta
- API calls cross-role (ver Network)
- loops de redirect
- errores en consola relacionados a auth/roles

# BuildingOS — Canonical Architecture

Fecha: 2026-02-22  
Fuente: Engram (project: BuildingOS)

## 1) Overview
BuildingOS es un SaaS multi-tenant para administración de condominios/edificios, con aislamiento estricto por tenant y permisos enforceados en backend.

## 2) Multi-tenancy (invariante)
- Cada entidad de dominio tiene `tenantId`.
- Toda query filtra por `tenantId`.
- El backend valida acceso del usuario al tenant (Membership).
- Nunca confiar en frontend para aislamiento.
- Violación cross-tenant = bug crítico de seguridad.

## 3) Contexto por URL (contrato)
- `/super-admin` → contexto global (sin tenant)
- `/(tenant)/[tenantId]/...` → contexto tenant
- `/(tenant)/[tenantId]/buildings/[buildingId]/...` → contexto building
- `/(tenant)/[tenantId]/units/[unitId]/...` → contexto unit

Regla: si hay `buildingId` o `unitId`, validar pertenencia al `tenantId`.

## 4) RBAC (enforced backend)
Roles canónicos:
- SUPER_ADMIN
- TENANT_OWNER
- TENANT_ADMIN
- OPERATOR
- RESIDENT

- Los permisos se evalúan en backend (guards).
- Frontend solo refleja permisos.
- Scopes finos (building/unit) se implementan con `buildingScope` y/o memberships de unidad.

## 5) Domain model (canon)
Jerarquía:
- Tenant (Condominio/Administradora)
  - Building/Property (Edificio)
    - Unit (Unidad)
      - UnitMembership (ocupación / roles en unidad)

## 6) Stack
- Frontend: Next.js + React + Tailwind + React Query
- Backend: NestJS + Prisma
- DB: PostgreSQL
- Infra local: Docker Compose (Postgres, Redis, MinIO)
- Auth: JWT + Passport

## 7) Implementation workflow (slices)
- Slice 0: Tenancy + RBAC + Auth
- Slice 1: Structure (Building/Unit/UnitMembership)
- Slice 2: Finance
- Slice 3: Operations

Flujo: Prisma model → migration → services → controllers → guards → UI → tests → docs.
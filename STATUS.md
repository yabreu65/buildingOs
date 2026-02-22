# BuildingOS – Status

Fecha: 2026-02-22

---

## Contexto
- Países objetivo: VE / AR / CO
- MVP pagos: transferencia/depósito + comprobante + aprobación
- Source of truth financiero: ledger por unidad
- Tenancy activo por ruta `/(tenant)/[tenantId]/...`

---

## Slice actual
NOW: Slice 0 — Core Platform (Tenancy + RBAC + Auth)  
Estado: 🟨 Parcialmente implementado

**Estado Engram:**
- Arquitectura multi-tenant definida
- RBAC backend definido
- Dominio jerárquico definido
- Backend NestJS + Prisma parcialmente implementado
- Frontend aún usa mocks/localStorage en partes

---

## Definition of Done del Slice 0
- Auth end-to-end
- Tenant context en cada request
- Membership + roles aplicados
- Scoping por tenant_id en queries
- Seed tenant demo + owner demo

---

## Estado por área

### Plataforma / Infra
- Docker Compose (Postgres): 🟨 Definido
- Docker Compose (Redis): 🟨 Definido
- MinIO local (S3): 🟨 Definido
- Prisma conectado a Postgres: 🟨 Parcial
- Migraciones base corriendo: 🟨 Parcial

---

### Auth / Tenancy / RBAC
- Auth backend (login básico): 🟨 Parcial
- TenantMembership model: 🟨 Parcial
- Resolución tenant activo: ⬜
- Guard de tenancy: ⬜
- Enforce scoping por tenant: ⬜
- RBAC backend enforced: 🟨 Definido
- Packages/contracts: 🟨 Definido
- Packages/permissions: 🟨 Definido

---

### Dominio
- Domain hierarchy definida: ✅
- Models implementados: ⬜
- Property: ⬜
- Unit: ⬜
- UnitMembership: ⬜

---

### Pagos MVP
- Config cuentas bancarias: ⬜
- PaymentSubmission + upload: ⬜
- Review approve/reject: ⬜
- LedgerEntry + saldo: ⬜

---

## Bloqueos
- Ninguno activo

---

## Decisiones pendientes
- Política cross-tenant: 404 vs 403
- Forma final de roles: array vs join table

---

## Próximos pasos (Engram-aligned)
1. Conectar frontend CRUD al backend real
2. Implementar Unit + UnitMembership
3. Guards: tenant context + RBAC
4. Scoping por tenant en repos/services
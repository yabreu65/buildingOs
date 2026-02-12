# BuildingOS – Status

Fecha: 2026-02-10 (America/Argentina/Buenos_Aires)

## Contexto
- Países objetivo: VE / AR / CO
- MVP pagos: transferencia/depósito + comprobante + aprobación
- Source of truth financiero: ledger por unidad
- Tenancy activo por ruta `/(tenant)/[tenantId]/...`

---

## Slice actual
- NOW: Slice 0 — Core Platform (Tenancy + RBAC + Contracts)

### Definition of Done del Slice 0
- Auth end-to-end
- Tenant context en cada request (tenantId)
- Membership + roles aplicados
- Scoping por `tenant_id` en cada query de dominio
- Seed tenant demo + owner demo

---

## Estado por área (marcar ✅/⬜/🟨)

### Plataforma / Infra
- Docker Compose (Postgres): ⬜
- Docker Compose (Redis): ⬜
- MinIO local (S3 compatible): ⬜
- Prisma conectado a Postgres: ⬜
- Migraciones base corriendo: ⬜

### Auth / Tenancy / RBAC
- Auth (login + obtener user): ⬜
- TenantMembership (user↔tenant + roles): ⬜
- Resolución tenant activo (ruta/header): ⬜
- Guard de tenancy (bloquea sin tenantId): ⬜
- Enforce scoping por tenant (repo/service): ⬜
- Política cross-tenant (404 vs 403) definida e implementada: ⬜
- Packages/contracts (DTOs/enums compartidos): ⬜
- Packages/permissions (matriz + helpers): ⬜

### Dominio (aún no)
- Property + PropertySettings: ⬜
- Units: ⬜
- UnitMembership: ⬜

### Pagos MVP (aún no)
- Config cuentas bancarias: ⬜
- PaymentSubmission + upload: ⬜
- Review approve/reject: ⬜
- LedgerEntry + saldo: ⬜

---

## Bloqueos
- (ninguno)

## Decisiones pendientes (si aplica)
- Política cross-tenant: ¿404 recomendado o 403?
- Forma final de roles: array vs tabla join (si no está definido aún)

## Próximos pasos (1–3)
1) Levantar infra local (Postgres/Redis/MinIO) + Prisma conectado
2) Implementar modelos core (Tenant, User, TenantMembership)
3) Implementar guards: auth + tenant context + roles

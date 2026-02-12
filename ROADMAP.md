# BuildingOS – Roadmap

Fecha: 2026-02-10 (America/Argentina/Buenos_Aires)

## Objetivo del roadmap
Construir BuildingOS por **vertical slices** (end-to-end) sobre una **plataforma multi-tenant sólida**, priorizando módulos monetizables y de operación diaria.

## Invariantes (NO negociables)
- Un solo SaaS multi-tenant.
- Aislamiento total por `tenant_id` en DB + API (nunca cross-tenant).
- No duplicar lógica por tipo de tenant; diferencias por configuración + permisos.
- Source of truth financiero: **ledger por unidad**.
- Auditoría mínima en entidades core (`created_at`, `updated_at`, `created_by`).

---

## NOW — Slice 0: Core Platform (Tenancy + RBAC + Contracts)
**Objetivo:** base segura y consistente para todo el dominio.

### Entregables
- Auth end-to-end (web ↔ api).
- Resolución de tenant activo por ruta `/(tenant)/[tenantId]/...` (y/o header `X-Tenant-Id`).
- Modelo core:
  - `Tenant`, `User`, `TenantMembership` (roles).
- Guards/Policies:
  - `requireAuth`
  - `requireTenantContext`
  - `requireRole / permission`
- Contracts compartidos:
  - `packages/contracts` con enums, DTOs, Zod schemas base.

### DoD (Definition of Done)
- Ningún endpoint de dominio funciona sin: auth + tenantId + membership válida.
- Cross-tenant: responde 404/403 según política definida.
- Seed: tenant demo + owner demo + property demo.
- Logging/auditoría mínima en writes.

---

## NEXT — Slice 1: Estructura (Property → Units → UnitMembership)
**Objetivo:** habilitar residentes, reclamos, pagos y comunicaciones.

### Entregables
- CRUD `Property` (edificio/condominio unificado).
- `PropertySettings` mínimo:
  - moneda
  - prorrateo (placeholder config)
  - política mora (placeholder config)
  - cuentas bancarias e instrucciones (placeholder o entidad)
- CRUD `Unit` por property.
- `UnitMembership`:
  - rol: OWNER | TENANT | OCCUPANT
  - fechas (desde/hasta)
- Portal residente v1:
  - “Mi edificio / Mi unidad” (lectura)

### DoD
- Admin crea property y unidades.
- Admin vincula residentes a unidades.
- Resident ve solo lo vinculado por `unit_memberships`.
- Todo scoping por tenant + property.

---

## NEXT — Slice 2: Ledger + Pagos MVP (Transferencia + Comprobante)
**Objetivo:** monetización y operación real VE/AR/CO sin integración bancaria.

### Entregables
- Configuración de pagos por `property_id`:
  - cuentas bancarias + instrucciones
  - reglas básicas anti-duplicado
- `PaymentSubmission`:
  - PENDING/APPROVED/REJECTED/CANCELLED
  - upload comprobante (S3/MinIO)
- Backoffice review:
  - approve/reject con motivo
- Ledger:
  - `LedgerEntry` (CHARGE/PAYMENT/ADJUSTMENT/REVERSAL)
  - saldo por unidad (calculado + cache opcional)

### DoD
- Submission aprobado genera `Payment` + `LedgerEntry` atómico.
- Aprobado no se edita; solo reversal.
- Imputación: intereses primero, luego FIFO.

---

## LATER — Slice 3: Expensas v1 (Liquidación mensual + recibo)
- Periodos
- Cargos por unidad (según prorrateo configurable)
- Emisión de recibo (PDF luego)

## LATER — Slice 4: Reclamos/Tickets v1
- Ticket lifecycle + comentarios + evidencia
- Asignación (TENANT_ADMIN/OPERATOR)
- Notificaciones in-app/email

## LATER — Slice 5: Comunicaciones
- Avisos por property
- Segmentación por unidades
- Plantillas + historial

---

## Parking Lot (futuro)
- Pagos online (MercadoPago/Stripe/otros)
- WhatsApp/push
- BI y reportes avanzados
- Reservas, accesos, integraciones contables
- Planes/limites por tenant + add-ons

# LOCAL V2 test accounts

> **LOCAL ONLY. NEVER run this seed against a remote, staging, or production database.**

All accounts use the centralized password **`local-v2-only`** and the non-routable test domain `@buildingos.local`.

The seed accepts only PostgreSQL on `localhost`, `127.0.0.1`, or `::1`, and only the databases `buildingos_local_v2_test` or `buildingos`. The isolated test database is preferred.

```bash
LOCAL_V2_SEED=1 \
NODE_ENV=test \
DATABASE_URL='postgresql://LOCAL_USER:LOCAL_PASSWORD@localhost:5432/buildingos_local_v2_test' \
npx ts-node prisma/seed-local-v2.ts
```

Running against `buildingos` additionally requires the exact explicit confirmation below:

```bash
LOCAL_V2_REPLACE_CONFIRMATION='REPLACE buildingos WITH LOCAL_V2'
```

The command performs its environment guard before constructing Prisma, then validates `current_database()` and the PostgreSQL server address after connecting. Existing semantic-key records are reused only when compatible; incompatible data causes an error instead of an overwrite.

## Account matrix

| Administration | Building | Role | Email | Unit | Primary scenario |
|---|---|---|---|---|---|
| Autogestionada Local | Autogestionada Local (`auto`) | TENANT_OWNER | `owner.autogestionada@buildingos.local` | — | Self-managed owner |
| Autogestionada Local | Autogestionada Local (`auto`) | TENANT_ADMIN | `admin.autogestionada@buildingos.local` | — | Self-managed administrator |
| Autogestionada Local | Autogestionada Local (`auto`) | RESIDENT | `resident.auto101@buildingos.local` | AUTO-101 | Reconciled ARS payment and open ticket |
| Autogestionada Local | Autogestionada Local (`auto`) | RESIDENT | `resident.auto102@buildingos.local` | AUTO-102 | Reconciled ARS payment |
| Autogestionada Local | Autogestionada Local (`auto`) | RESIDENT | `resident.auto103@buildingos.local` | AUTO-103 | Pending ARS charge |
| Autogestionada Local | Autogestionada Local (`auto`) | RESIDENT | `resident.auto104@buildingos.local` | AUTO-104 | Pending ARS charge |
| Autogestionada Local | Autogestionada Local (`auto`) | RESIDENT | `resident.auto105@buildingos.local` | AUTO-105 | Pending ARS charge |
| Administradora Pequeña | Norte / Sur | TENANT_OWNER | `owner.small@buildingos.local` | — | Small administrator owner |
| Administradora Pequeña | Norte / Sur | TENANT_ADMIN | `admin.small@buildingos.local` | — | Small administrator operations |
| Administradora Pequeña | Building Norte (`norte`) | RESIDENT | `resident.norte@buildingos.local` | NOR-101 | Paid ARS charge with receipt evidence |
| Administradora Pequeña | Building Sur (`sur`) | RESIDENT | `resident.sur@buildingos.local` | SUR-101 | Pending ARS charge |
| Administradora Multi | All buildings | SUPER_ADMIN | `superadmin.local@buildingos.local` | — | Membership-only super administrator; no TenantMember |
| Administradora Multi | All buildings | TENANT_OWNER | `owner.multi@buildingos.local` | — | Multi-building owner and adjustment validator |
| Administradora Multi | All buildings | TENANT_ADMIN | `admin.multi@buildingos.local` | — | Multi-building finance administrator |
| Administradora Multi | All buildings | OPERATOR | `operator.multi@buildingos.local` | — | Ticket assignee |
| Administradora Multi | Los Robles (`robles`) | RESIDENT | `resident.robles101@buildingos.local` | ROB-101 | Reconciled USD payment |
| Administradora Multi | Los Robles (`robles`) | RESIDENT | `resident.robles103@buildingos.local` | ROB-103 | Pending charge and closed ticket |
| Administradora Multi | Los Robles / El Parque | RESIDENT | `resident.multi@buildingos.local` | ROB-102, PAR-301 | One resident with two properties |
| Administradora Multi | El Parque (`parque`) | RESIDENT | `resident.parque101@buildingos.local` | PAR-101 | One payment allocated across two charges |
| Administradora Multi | El Parque (`parque`) | RESIDENT | `resident.parque102@buildingos.local` | PAR-102 | Two unpaid charges |
| Administradora Multi | El Parque (`parque`) | RESIDENT | `resident.parque103@buildingos.local` | PAR-103 | Partial payment and allocation |
| Administradora Multi | Las Palmas (`palmas`) | RESIDENT | `resident.palmas101@buildingos.local` | PAL-101 | USD identity valuation snapshot |
| Administradora Multi | Las Palmas (`palmas`) | RESIDENT | `resident.palmas102@buildingos.local` | PAL-102 | VES-to-USD valuation at 0.025 |
| Administradora Multi | Las Palmas (`palmas`) | RESIDENT | `resident.palmas103@buildingos.local` | PAL-103 | COP-to-USD valuation at 0.00025 |
| QA / Edge Cases | QA Building (`qa`) | TENANT_OWNER | `owner.qa@buildingos.local` | — | QA owner, receipts, tickets, and historical adjustment |
| QA / Edge Cases | QA Building (`qa`) | TENANT_ADMIN + RESIDENT | `admin-resident.qa@buildingos.local` | QA-101 | One membership with two roles |
| QA / Edge Cases | QA Building (`qa`) | RESIDENT | `resident.multiunit.qa@buildingos.local` | QA-102, QA-106 | Multi-unit resident; QA-106 has zero balance |
| QA / Edge Cases | QA Building (`qa`) | RESIDENT | `resident.delinquent.qa@buildingos.local` | QA-104 | Historic delinquent charge and open ticket |
| QA / Edge Cases | QA Building (`qa`) | RESIDENT | `resident.partial.qa@buildingos.local` | QA-105 | Partial payment and closed ticket |

## Vacant-unit scenarios

The following units intentionally have no occupancy: `AUTO-106`, `NOR-102`, `SUR-102`, `ROB-104`, and `QA-103`.

## Finance and communication coverage

All 12 seeded payments include receipt evidence through the `Payment` fields `receiptNumber`, `receiptStatus`, and `receiptGeneratedAt`. This seed does not create a separate receipt model; communication receipts remain separate communication-delivery records.

Every payment also seeds the required `PaymentAuditLog` sequence matching the current application contract: `SUBMITTED` (resident creation), `APPROVED` (admin review), `RECONCILED` (only for fully reconciled payments), and `RECEIPT_GENERATED` (receipt confirmation). Every payment carries a complete functional snapshot — `IDENTITY` (rate `1`, no exchange-rate row) for same-currency payments and `DIRECT` for VES/COP-to-USD conversions.

The seed does **not** fabricate a `receiptDocumentId`/Minio object for receipts: `receiptStatus=READY` with `receiptNumber` and `receiptGeneratedAt` is the local-dataset representation, and the receipt PDF is intentionally not downloadable from the local dataset.

- Tenant 01: five ARS charges, two reconciled payments with Payment receipt fields, one open ticket, and one sent in-app communication with five resident receipts.
- Tenant 02: two simple ARS charges and one reconciled payment with Payment receipt fields.
- Tenant 03: USD functional currency, split and partial allocations, USD identity valuation, VES/COP conversion snapshots, two dated exchange rates, and two validated adjustments. No resident credit is modeled.
- Tenant 04: historic delinquency, partial payment, zero balance, one validated historical adjustment, and both open and closed ticket states.

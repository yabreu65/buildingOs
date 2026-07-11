# Finance Liquidation Hardening Status

Audit date: 2026-07-11
Scope: hardened liquidation route (`/tenants/:tenantId/finance/liquidations`) plus legacy liquidation engine inspection. Production code was not modified.

## Summary

The hardened liquidation publication path is materially safer than the legacy engine: publication writes are transactional, charges are created from integer minor units, duplicate charges are constrained, and tenant-level access is guarded. The biggest remaining gaps are cancellation hard-deleting published liquidation records, audit logs being fire-and-forget/outside the financial transaction, and only partial concurrency/scope hardening around row locking and building-scoped RBAC.

The legacy `LiquidationEngineController` still exists in source but is not registered in `FinanzasModule`; `FinanzasModule` registers `LiquidationsController` and explicitly omits `LiquidationEngineController` in the module spec.

## Invariant Matrix

| # | Invariant | Status | Evidence |
|---|---|---|---|
| 1 | Publication fully transactional | CUMPLE | Hardened `publishLiquidation` wraps duplicate-charge detection, `charge.createMany`, and liquidation status update in `prisma.$transaction` (`apps/api/src/finanzas/liquidations.service.ts:451-527`). Audit/notifications are intentionally after the transaction. |
| 2 | Approved snapshot immutable | PARCIAL | Draft stores `totalAmountMinor`, `totalsByCurrency`, and `expenseSnapshot` (`liquidations.service.ts:287-299`); review/publish update only status/audit fields (`liquidations.service.ts:363-370`, `517-524`). But publish accepts `DRAFT` as well as `REVIEWED` (`407-410`), so final approval is not mandatory before publication. |
| 3 | Exact sum of charges and total | CUMPLE | Hardened distribution preserves the remainder: coefficient path floors then assigns the `delta` (`liquidations.service.ts:664-682`), equal path assigns `remainder` cents (`695-708`). Publish uses that distribution for `charge.createMany` (`500-515`). |
| 4 | Money stored/compared in integer units | CUMPLE | Prisma stores `Charge.amount`, `Payment.amount`, `PaymentAllocation.amount`, `Expense.amountMinor`, `Liquidation.totalAmountMinor`, and `Adjustment.amountMinor` as `Int` (`schema.prisma:1392`, `1446`, `1530`, `1602`, `1778`, `1821`). DTOs require integer minor amounts (`expense-ledger.dto.ts:114-116`, `370-372`). |
| 5 | Idempotency | CUMPLE | Re-publishing an already `PUBLISHED` liquidation returns without new charges (`liquidations.service.ts:403-405`); transaction returns safely when all charges already exist (`472-492`); unique-constraint races are caught and mapped to idempotent success if status is now published (`530-545`). |
| 6 | Concurrency | PARCIAL | DB uniqueness plus transaction/P2002 handling protects duplicate charge creation (`liquidations.service.ts:451-545`, `schema.prisma:1435`, migration `20260630110000...`). There is no explicit row lock or conditional status update, and billable units/distribution are loaded before the transaction (`430-447`). |
| 7 | Unique constraints | CUMPLE | Source has `@@unique([tenantId, liquidationId, unitId, period])` for charges (`schema.prisma:1435`) and migration creates the matching unique index (`20260630110000_add_liquidation_charge_uniqueness/migration.sql:1-4`). A partial unique active-liquidation index exists in migration (`20260402000001...:13-16`). |
| 8 | Tenant/building isolation | PARCIAL | Hardened controller uses `JwtAuthGuard` + `TenantAccessGuard` (`liquidations.controller.ts:39-40`) and draft validates building ownership (`liquidations.service.ts:134`). Most reads include `tenantId`, but unit queries use only `buildingId` (`279-281`, `431-433`), and building-scoped RBAC is not enforced by this controller path. |
| 9 | No hard delete for published liquidations | NO CUMPLE | Hardened cancellation deletes charges for published liquidations and then deletes the liquidation (`liquidations.service.ts:600-621`). Schema has `canceledByMembershipId`/`canceledAt` fields (`schema.prisma:1788-1789`) but this path does not use them. |
| 10 | Auditable cancellation | PARCIAL | Cancellation writes a `LIQUIDATION_CANCEL` audit log with previous status metadata (`liquidations.service.ts:623-630`), but the liquidation row is deleted and audit logging is fire-and-forget/non-blocking (`audit.service.ts:45-75`), so the cancellation is not transactionally guaranteed or fully reconstructable from the financial record. |
| 11 | Role-based permissions | CUMPLE | Hardened route requires authentication and tenant membership (`liquidations.controller.ts:39-40`); service methods reject non admin/operator roles (`liquidations.service.ts:60-62`, `130-132`, `345-347`, `391-393`, `588-590`), with `TENANT_ADMIN`, `TENANT_OWNER`, or `OPERATOR` accepted (`finanzas.validators.ts:399-403`). |
| 12 | Audit logging | PARCIAL | Draft, review, publish, and cancel call `AuditService.createLog` (`liquidations.service.ts:301-315`, `372-379`, `551-565`, `623-630`). However logs are outside the publication transaction and `AuditService` intentionally swallows audit-write failures (`audit.service.ts:45-75`). |

## Legacy Engine Notes

`apps/api/src/finanzas/liquidation-engine.service.ts` remains materially weaker if re-registered: publication does not use a transaction (`389-413`), recalculates charges from current expenses instead of the stored snapshot (`352-388`), and cancellation hard-deletes charges/liquidation (`458-465`). Current module wiring keeps this controller out of the registered controllers list (`apps/api/src/finanzas/finanzas.module.ts:58-75`; `apps/api/src/finanzas/finanzas.module.spec.ts:7-15`).

## Recommended Next Slice

Replace hard-delete cancellation with a transactional soft-cancel path for published liquidations: set `Liquidation.status = CANCELED`, fill `canceledByMembershipId`/`canceledAt`, soft-cancel or otherwise preserve generated charges, and write the audit log inside the same transaction or persist a financial cancellation event with equivalent guarantees.

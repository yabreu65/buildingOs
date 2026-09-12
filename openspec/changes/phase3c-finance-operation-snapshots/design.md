# Design: Finance Operation Snapshots (Phase 3C)

## Status and scope

This design completes the lifecycle-level guarantees around the canonical PHASE 3B FX snapshot mechanism. It deliberately does not change the PHASE 3B conversion engine, its result contract, pair/rate locks, Prisma schema, financial period semantics, public DTOs, frontend, or historical data.

An effective transition is:

| Operation | Transition | Business date |
| --- | --- | --- |
| Expense | `DRAFT -> VALIDATED` | `invoiceDate` |
| Income | `DRAFT -> RECORDED` | `receivedDate` |
| Adjustment | `DRAFT -> VALIDATED` | `sourceInvoiceDate` |

All dates are reduced to strict UTC date-only (`YYYY-MM-DD`, represented for persistence as `T00:00:00.000Z`) before rate selection.

## Existing baseline to preserve

`CurrencyConversionService.convert(input, tx)` is the sole conversion and evidence producer. It already returns the canonical snapshot values: functional minor amount and currency, source exchange-rate id, applied rate, direction, source effective date, and UTC conversion date. It also owns the canonical selection protocol:

1. validate canonical currency, integer amount, and strict date;
2. for non-identity conversions, acquire the transaction-scoped currency-pair advisory lock;
3. select the direct rate, acquire its row advisory lock, and re-read it;
4. otherwise repeat for the inverse rate; and
5. return an immutable value snapshot or throw the existing `EXCHANGE_RATE_NOT_FOUND` / conversion error.

Phase 3C must call this service with the active `Prisma.TransactionClient`, never with the root `PrismaService`. The transaction client exposes `$executeRaw`, so the service retains PHASE 3B pair and rate-row locking. No conversion formulas, rate fallback, error code, snapshot field shape, or lock implementation is copied into an operation service.

Expense and Income already acquire their lifecycle locks before authoritative reads and call `convert(..., tx)` inside their interactive transaction. Phase 3C validates those properties with stronger failure and race coverage rather than rewriting their paths.

## Adjustment lifecycle serialization

### Lock definition

Extend `apps/api/src/finanzas/movement-locks.ts` with an Adjustment-specific transaction advisory lock beside `acquireExpenseLock`:

- namespace: `buildingos:adjustment-movement:v1`
- logical key: `${namespace}:${tenantId}:${adjustmentId}`
- acquisition: `pg_advisory_xact_lock(hashtextextended(key, 0))`
- client: `Prisma.TransactionClient`

The tenant id is part of the lock identity so equal record-like ids cannot serialize across tenants. The lock is transaction-scoped and releases on both commit and rollback. It is intentionally a lifecycle/entity lock, not an ExchangeRate lock and not a replacement for either PHASE 3B FX lock.

### Acquisition order and data flow

`AdjustmentsService.validateAdjustment` will retain its one `this.prisma.$transaction(...)` and execute in this strict order:

1. Acquire the Adjustment lifecycle lock with the active `tx`.
2. Read the Adjustment using `{ id: adjustmentId, tenantId }` through `tx`.
3. Reject a missing Adjustment or a status other than `DRAFT` using existing behavior; do not calculate, repair, or overwrite an existing snapshot.
4. Build the snapshot with `buildAdjustmentConversionSnapshot(tenantId, adjustment, tx)`.
   - The tenant lookup is executed through `tx`.
   - `sourceInvoiceDate` is normalized with existing UTC getters.
   - `currencyConversionService.convert(..., tx)` receives that exact client.
   - For non-identity conversions, PHASE 3B then acquires the pair lock followed by the selected rate-row lock and revalidates selection.
5. Perform exactly one `tx.adjustment.update` that writes `VALIDATED`, actor/time metadata, and every canonical snapshot field together.
6. Commit the transaction; only afterward issue the current best-effort audit log.

The resulting global order for this producer is **Adjustment lifecycle lock -> FX pair lock -> FX rate-row lock -> adjustment write**. It matches the documented producer ordering (entity lifecycle lock before pair and row locks), avoids an entity lock after FX locks, and does not introduce an additional lifecycle lock. Identity conversions keep PHASE 3B behavior: no pair or row lock is necessary because no ExchangeRate is selected.

The lock call must happen before `tx.adjustment.findFirst`, as it does for Expense and Income. This makes a waiting concurrent validator re-read the post-commit state and reject through the existing non-`DRAFT` guard instead of calculating a second snapshot or issuing a second update.

## Atomicity, idempotency, and failure behavior

### Transaction boundary

Each of the three effective transitions has one interactive Prisma transaction spanning:

- lifecycle/entity lock acquisition;
- tenant-scoped effective-state read and status guard;
- tenant functional-currency lookup;
- PHASE 3B rate selection and locking through the same `tx`;
- snapshot construction; and
- the single state-plus-snapshot persistence update.

For `Expense`, `persistValidatedExpense` may also update functional allocation values within that same transaction. Those allocation writes remain inside the rollback boundary; Phase 3C does not change their allocation semantics.

The audit calls remain after successful commit. Therefore a failed transaction neither creates an audit log nor exposes a successful response. Existing best-effort audit semantics are not converted to required, transactional audit behavior by this phase.

### Required invariants

For a new successful transition, persisted evidence is complete as one unit:

- `functionalAmountMinor`
- `functionalCurrencyCode`
- `exchangeRateId` (null only for canonical identity)
- `exchangeRateValue`
- `exchangeRateDirection`
- `exchangeRateEffectiveAt` (null only for canonical identity)
- `conversionDate`

The operation state and this full evidence set must be written by the same update. A transition may not leave an effective operation with newly partial evidence. The canonical identity result (`rate = "1"`, `IDENTITY`, null source id/effective date) is legitimate new evidence; it is not a legacy synthetic repair.

### Failures

- If rate selection finds no applicable rate, the unchanged PHASE 3B `UnprocessableEntityException` with `EXCHANGE_RATE_NOT_FOUND` escapes the transaction. The effective-state update has not run, and the operation remains in its prior non-effective state with no new snapshot fields.
- If conversion validation, rate locking/revalidation, or snapshot construction fails, the transaction aborts with the original error and no lifecycle or snapshot write commits.
- If the single operation update or Expense allocation persistence fails after a snapshot has been constructed, Prisma rolls back the entire interactive transaction. No state change, no individual snapshot field, and no allocation functional value may commit.
- A concurrent request waits on the same entity lock, reads the now-effective state after the winner commits, and follows the pre-existing invalid-transition error path. This is idempotent in effect: it does not create a second update, second audit event, or new FX evidence.
- A retry aimed at an already-effective record uses the same guard and must not call conversion or persistence. The original snapshot remains byte-for-value unchanged.

The design does not silently retry lifecycle mutations. Database/Prisma failures and conversion failures are surfaced to the caller. PostgreSQL lock waits are governed by the transaction/database configuration; there is no new timeout or error translation in this phase.

## Legacy and compatibility behavior

Pre-existing `VALIDATED` Expenses and Adjustments, and `RECORDED` Incomes, can have null snapshot columns. They are unresolved historical state, not candidates for this lifecycle writer:

- read/list DTO mapping continues to expose their nullable evidence as null;
- an already-effective lifecycle request is rejected before conversion, so it cannot fill null columns;
- no rate of `1`, inferred source rate, backfill, migration, or repair job is added;
- existing non-null snapshots are not recalculated, deleted, or overwritten.

`Income.period` remains its existing accounting authority. `Adjustment.sourcePeriod` remains independent of its `sourceInvoiceDate`-derived conversion date. This phase adds no Adjustment update/void path. DTO/controller/frontend files remain unchanged unless a focused contract test proves a missing exposure; the current response mapping already exposes every snapshot field, so no such change is planned.

## Test design

### Test layers

1. **Focused service tests** verify input/date propagation, snapshot field completeness in the sole update, status guards, active transaction-client propagation, and errors before any update.
2. **Rollback tests with transaction-aware doubles** model commit only when the callback succeeds. Force the final persistence operation to reject after conversion and assert the durable fixture remains non-effective with every snapshot field null. A simple call-count mock alone is insufficient evidence of rollback.
3. **Gated PostgreSQL integration tests** use two independent Prisma clients and deterministic advisory-lock barriers. They verify real transaction-scoped lock waiting and final persisted invariants, never scheduling/timing assumptions. They remain guarded by the existing disposable acceptance-database protocol (`RUN_POSTGRES_INTEGRATION=1` and an allowlisted `POSTGRES_TEST_DB_NAME`).

### Invariant matrix

| Invariant | Expense (`validateExpense`, including bulk where applicable) | Income (`recordIncome`) | Adjustment (`validateAdjustment`) |
| --- | --- | --- | --- |
| Success is one state-and-complete-snapshot update | Assert `VALIDATED` plus all fields; UTC `invoiceDate` | Assert `RECORDED` plus all fields; UTC `receivedDate` | Assert `VALIDATED` plus all fields; UTC `sourceInvoiceDate` |
| Missing rate | Preserve `EXCHANGE_RATE_NOT_FOUND`; no update/committed snapshot | Same | Same |
| Persistence failure rolls back | Force parent update (and allocation path when relevant) failure; durable record stays `DRAFT`/null | Force update failure; durable record stays `DRAFT`/null | Force update failure; durable record stays `DRAFT`/null |
| Retry/effective immutability | Effective record causes no conversion/update; stored snapshot deep-equals pre-retry evidence | Same | Same |
| Same-entity race | Existing lifecycle lock serializes; at most one validated snapshot persists | Existing income lock serializes; at most one recorded snapshot persists | New Adjustment lock serializes; at most one validated snapshot persists |
| FX lock propagation | Assert `convert` receives the active transaction client; retain PHASE 3B lock tests | Same | Add this assertion and confirm `$executeRaw` is available to conversion |
| Legacy null | Reads map nulls and lifecycle does not repair | Same | Same |

The Adjustment unit test will additionally assert that its first transactional operation is the lifecycle advisory lock and that the lock SQL key contains `buildingos:adjustment-movement:v1:tenant-1:adjustment-1`. It will assert `convert` is called with the transaction client rather than the root Prisma client.

The PostgreSQL race test for Adjustment will create one draft Adjustment and invoke validation concurrently through two service instances backed by separate clients. A controlled barrier makes both requests contend without relying on sleep ordering. Expected outcome: exactly one fulfilled validation, one rejected non-`DRAFT` transition, one `VALIDATED` row, and one complete unchanged snapshot. The test should also retain a non-identity rate fixture so conversion necessarily traverses PHASE 3B pair/row locking. Existing PHASE 3B PostgreSQL tests continue to prove rate-update/create versus snapshot-selection behavior; Phase 3C proves the operation passes its `tx` into that already-tested mechanism rather than duplicating it.

## Likely file changes

| File | Change |
| --- | --- |
| `apps/api/src/finanzas/movement-locks.ts` | Add the Adjustment lifecycle advisory-lock namespace and `acquireAdjustmentLock` helper. |
| `apps/api/src/finanzas/adjustments.service.ts` | Import and acquire the Adjustment lock as the first operation inside `validateAdjustment`'s existing transaction. Preserve passing `tx` to the existing snapshot builder/conversion service. |
| `apps/api/src/finanzas/adjustments.multicurrency.spec.ts` | Add lock-key/order, active-client propagation, final-write failure, retry/immutability, and legacy assertions. |
| `apps/api/src/finanzas/expenses.multicurrency.spec.ts` | Add/strengthen final-write rollback, retry/effective immutability, and complete-snapshot assertions without changing Expense implementation. |
| `apps/api/src/finanzas/incomes.multicurrency.spec.ts` | Add/strengthen final-write rollback, retry/effective immutability, and complete-snapshot assertions without changing Income implementation. |
| `apps/api/src/finanzas/atomic-movement-lifecycle.spec.ts` | Add Adjustment active-transaction-client coverage and shared rollback-double utilities only if this produces less duplication than local test helpers. |
| `apps/api/src/finanzas/atomic-movement-lifecycle.postgres.spec.ts` or a narrowly named Phase 3C PostgreSQL spec | Add the deterministic Adjustment concurrent-validation acceptance test; do not weaken its disposable-database guard. |

No Prisma schema/migration, conversion-service, DTO/controller, web, package manifest, lockfile, remote system, or historical-data change is planned.

## Rollback boundaries

The implementation is reversible without data migration:

1. **Adjustment serialization unit:** revert the `movement-locks.ts` helper and the single `validateAdjustment` import/call together. This removes only the added entity exclusion; it does not touch persisted snapshots or PHASE 3B locks.
2. **Guarantee tests:** revert the corresponding test changes independently when reverting their behavior unit. Tests introduce no runtime or data behavior.
3. **No rollback action on existing rows:** never delete, null, recalculate, or backfill snapshots created before or during rollout. Reverting code restores the prior lifecycle path only.

Because the state and snapshot commit as one transaction, a failed deployment or runtime failure has no partial database cleanup procedure. A committed new snapshot is financial evidence and must not be programmatically removed by rollback.

## Review workload and work-unit plan

The likely implementation plus focused tests is expected to exceed the 400 changed-line review budget, primarily due to three service test matrices and the PostgreSQL race harness. Under `auto-chain`, use the following dependency-ordered work units. Estimates count authored additions and deletions and are planning ranges, not a reason to compress tests.

| Chain slice / work unit | Expected changed lines | Contents, verification, and rollback boundary |
| --- | ---: | --- |
| PR 1 — `feat(finance): serialize adjustment validation snapshots` | 260–360 | Add Adjustment lifecycle lock, wire it before the Adjustment read, and add Adjustment unit coverage for lock order/key, transaction-client propagation, complete write, missing rate, update failure, retry, and legacy null preservation. Run focused Adjustment/Jest slice. Runtime harness: N/A for unit-only behavior. Roll back `movement-locks.ts`, `adjustments.service.ts`, and its Adjustment tests together. |
| PR 2 — `test(finance): prove expense and income snapshot rollback invariants` | 260–380 | Strengthen Expense and Income tests for complete evidence, final persistence rollback, retries, and legacy preservation; share a helper only when it remains test-local and reduces duplication. Run focused Expense and Income/Jest slices. Runtime harness: N/A for unit-only behavior. Roll back the test-only files as one unit. |
| PR 3 — `test(finance): verify operation snapshot races on postgres` | 220–360 | Add deterministic, gated PostgreSQL lifecycle-race coverage for Adjustment and any missing all-three durable rollback/race assertions. Run the gated PostgreSQL slice only with the explicitly disposable local acceptance database; otherwise record it as skipped, never target staging/production. Roll back the dedicated/extended PostgreSQL test file only. |

If actual diffs keep PR 1 and PR 2 below 400 lines individually, retain the chain as above. If one honest work unit exceeds 400 after a single slicing pass, stop and request a `size:exception` with the measured smallest cohesive diff; do not delete assertions or compress code to fit the budget. Tests stay with the behavior they verify, and each work unit is independently revertible.

## Validation plan

Implementation validation, not executed by this design task:

1. Run the focused Jest commands for the changed `*.multicurrency.spec.ts` and lifecycle test files from `apps/api`.
2. Run the explicitly gated PostgreSQL concurrency command only against the allowlisted disposable local acceptance database and record its exact result.
3. Run applicable local typecheck/lint only with authorization where required by repository policy; do not run a build without explicit authorization.
4. Before review, run `rtk git status`, `rtk git diff --stat`, and `rtk git diff --check` (or documented Git fallbacks) and report any uncommitted files.

No production code, test, remote-system, commit, or push action is performed by this design artifact.

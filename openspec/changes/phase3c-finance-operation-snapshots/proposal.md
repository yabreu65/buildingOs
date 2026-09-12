# Proposal: PHASE 3C — financial operation snapshots

## Intent

Complete the technical guarantees for multicurrency snapshots in the effective transitions of Expense, Income, and Adjustment, without altering the canonical contract or PHASE 3B locks. The purpose is for an effective operation to retain reproducible FX evidence, remain safe under concurrency, and leave neither partial state nor a duplicated transition when retried.

**Authorized baseline:** `18d8adb7a699144148a13a94c927a761251eb91a`.

## Problem

The audit confirms that all three operations already persist canonical evidence when moving to an effective state: functional amount and currency, applied rate value and direction, source rate identifier and effective date, and a UTC date-only `conversionDate`. Expense and Income also serialize their lifecycle transition with entity locks and the conversion engine's pair/row locks.

However, Adjustment has no equivalent serialization for its `VALIDATED` transition, and complete guarantees and tests are missing to demonstrate, for all three operations, that an effective transition is atomic, idempotent, and leaves no partial snapshots on errors or races. It must also be explicit that historical records with null snapshots are an unresolved legacy state: FX data must not be invented and fictional backfills must not be performed.

## Scope

### Included

- Fully preserve the PHASE 3B canonical engine, snapshot contract, and lock scheme.
- Add to Adjustment lifecycle-transition concurrency serialization comparable to Expense and Income, coordinated with the existing conversion locks.
- Ensure that Expense validates and generates its snapshot within its effective transaction, using `invoiceDate` normalized as UTC date-only.
- Ensure that Income validates and generates its snapshot within its effective transaction, using `receivedDate` normalized as UTC date-only.
- Ensure that Adjustment validates and generates its snapshot within its effective transaction, using `sourceInvoiceDate` normalized as UTC date-only.
- Complete technical guarantees and tests for Expense, Income, and Adjustment to:
  - not persist an effective operation with incomplete snapshot evidence;
  - roll back the complete transition if an applicable rate is missing or snapshot persistence fails;
  - not duplicate effects or replace FX evidence when retrying or racing on an already-effective transition;
  - preserve existing historical snapshots as immutable evidence.
- Document and encode the handling of legacy null snapshots as unresolved historical state, without implicit repair.
- Review DTO/API only to close a demonstrated snapshot-contract gap; if there is no evidence of that gap, neither the API nor frontend will be modified.

### Reviewable deliverables

The implementation must maintain review slices of up to 400 changed lines. With the `auto-chain` strategy, if the verified scope exceeds that budget, guarantees and tests will be split into chained PRs without mixing unrelated product changes.

## Non-goals and confirmed decisions

- Do not reimplement the PHASE 3B engine, snapshot contract, or locks.
- Do not modify the authority of `Income.period`.
- Do not change the semantics of `Adjustment.sourcePeriod`: `conversionDate` is already derived from `sourceInvoiceDate` in UTC, while period ownership is separate financial semantics.
- Do not add an update or void lifecycle for Adjustment.
- Do not backfill historical FX, fabricate `1` rates, or infer snapshots for legacy records.
- Do not introduce frontend changes without a demonstrated snapshot API gap.
- Do not modify production code, tests, remote environments, deployments, commits, or pushes as part of this proposal.

## Affected areas

| Area | Expected impact | Reason |
|---|---|---|
| `apps/api/src/finanzas/adjustments.service.ts` | Modified | Serialize the effective transition and preserve snapshot atomicity/idempotency. |
| `apps/api/src/finanzas/expenses.service.ts` | Contract validation/tests | Confirm transactional snapshot with UTC date-only invoice date and rollback. |
| `apps/api/src/finanzas/incomes.service.ts` | Contract validation/tests | Confirm transactional snapshot with UTC date-only received date and rollback. |
| `apps/api/src/finanzas/currency-conversion.service.ts` | No change unless a gap is demonstrated | Reuse the PHASE 3B canonical engine and locks. |
| `apps/api/src/finanzas/*multicurrency.spec.ts` and relevant lifecycle tests | Modified | Cover concurrency, idempotency, missing rates, rollback, and historical preservation. |
| Finance API DTOs/controllers | Conditional | Only if a test demonstrates a gap in snapshot-contract exposure. |
| `apps/web/` | No expected change | No frontend change is authorized without a demonstrated API gap. |

## Approach

1. Identify the single effective-transition point for each operation and keep rate retrieval and snapshot writing within the same transaction.
2. Apply to Adjustment the same entity-level exclusion pattern that protects Expense and Income transitions, without replacing the conversion service's pair/row locks.
3. Make explicit through tests the invariants of a complete snapshot, UTC date-only source date, rollback on a missing rate, and no duplication under retries or concurrency.
4. Distinguish current operations from legacy historical rows: the former must satisfy the complete contract when becoming effective; the latter remain null and are reported as unresolved, without automatic mutation.

## Acceptance criteria

- [ ] Expense can become effective only with a complete snapshot calculated within its transaction from UTC date-only `invoiceDate`.
- [ ] Income can become effective only with a complete snapshot calculated within its transaction from UTC date-only `receivedDate`.
- [ ] Adjustment can be validated only with a complete snapshot calculated within its transaction from UTC date-only `sourceInvoiceDate`.
- [ ] Adjustment serializes concurrent transitions of the same entity equivalently to Expense and Income and retains canonical conversion locks.
- [ ] A missing rate, snapshot error, or persistence error leaves neither an operation in an effective state nor partial FX evidence.
- [ ] Retries and concurrent requests for an effective transition do not create duplicate effects or replace the already-persisted snapshot.
- [ ] Existing snapshots are not recalculated, overwritten, or deleted during these transitions.
- [ ] Legacy null snapshots are explicitly handled as unresolved; there is no automatic backfill or synthetic rate.
- [ ] Tests cover the successful path, missing rate, rollback, retry/idempotency, and concurrency for the applicable Expense, Income, and Adjustment lifecycles.
- [ ] DTOs or frontend do not change unless a test demonstrates a necessary snapshot API-contract gap.

## Risks

| Risk | Mitigation |
|---|---|
| A new Adjustment lock can change acquisition order and cause contention or deadlock. | Reuse the Expense/Income lock order and pattern; test concurrent transitions. |
| Concurrency tests can be flaky. | Coordinate controlled barriers/doubles and assert persisted invariants, not execution timing. |
| A correction could accidentally recalculate historical evidence. | Restrict writing to the first effective transition and cover preservation of existing snapshots. |
| Legacy null rows can be confused with new failures. | Encode/document their unresolved condition and require a complete snapshot only for new transitions. |

## Rollback

The change is local and reversible by reverting implementation commits. It requires no migration, backfill, data change, or interaction with staging/production. On rollback, previous lifecycle paths are restored; historical or already-created snapshots are not modified or deleted.

## Success

PHASE 3C will be complete when effective Expense, Income, and Adjustment transitions are demonstrably protected against partial state and duplication, Adjustment has equivalent lifecycle serialization, historical snapshots remain intact, and handling of legacy nulls is explicit without inventing FX evidence.

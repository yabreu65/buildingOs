# Implementation Tasks: Finance Operation Snapshots (Phase 3C)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 740–1,100 authored lines across implementation and tests |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

The chain boundaries follow the design: Adjustment serialization first, Expense/Income proof second, and gated PostgreSQL concurrency proof third. Each slice is intended to remain below 400 changed lines; measure additions plus deletions after each slice. If an honest slice exceeds 400 lines after one slicing pass, stop and request a `size:exception`; do not delete assertions or compress implementation to fit the budget.

## Scope and edit guardrails

- This task artifact is the only file changed during task planning: `openspec/changes/phase3c-finance-operation-snapshots/tasks.md`.
- Implementation must touch only the exact edit surfaces listed under each work unit. Do not modify Prisma schema/migrations, `currency-conversion.service.ts`, DTOs/controllers, frontend files, package manifests/lockfiles, historical data, deployment configuration, or remote environments.
- No API or frontend edit is authorized unless a focused test demonstrates a real snapshot-contract exposure gap; pause and request scope confirmation instead of expanding a work unit.
- Preserve the PHASE 3B conversion engine, snapshot shape, pair/rate locks, `Income.period`, `Adjustment.sourcePeriod`, and all existing financial semantics.
- No backfill, synthetic rate, repair job, migration, seed, staging action, production action, commit, or push is part of implementation or verification.

## Evidence contract for every work unit

Each work unit is executed in strict TDD order: RED → GREEN → TRIANGULATE → REFACTOR. Record the exact command, exit status, focused test name, and meaningful failure or pass result for every stage. When a newly added test proves behavior that already exists, classify it as CHARACTERIZATION/REGRESSION COVERAGE and record the baseline/candidate passing evidence instead of fabricating a baseline RED. For a real behavior change, RED must demonstrate the missing guarantee against the baseline; GREEN must identify the smallest allowed code/test change that makes it pass; TRIANGULATE must exercise a second boundary or failure mode; REFACTOR must preserve the green result while improving only local clarity.

RDD evidence is recorded with the work-unit result, not as a separate authority or delivery task: changed paths, baseline and final test outputs, runtime harness result or explicit `N/A` reason, measured changed-line count, rollback boundary, and any skipped gated test with its exact reason. Do not claim a PostgreSQL pass when the local gate is skipped.

## PR 1 — Serialize Adjustment validation snapshots

**Dependency:** none. **Review boundary:** `260–360` changed lines expected. **Candidate outcome:** `feat(finance): serialize adjustment validation snapshots` (do not create a commit in this task).

**Exact allowed edit surfaces:**

- `apps/api/src/finanzas/movement-locks.ts`
- `apps/api/src/finanzas/adjustments.service.ts`
- `apps/api/src/finanzas/adjustments.multicurrency.spec.ts`

**Rollback boundary:** revert the helper and its single `validateAdjustment` import/call together; revert the Adjustment test changes with them. This must not remove or alter existing persisted snapshots or PHASE 3B FX locks.

### RED

- [x] Add failing focused tests in `apps/api/src/finanzas/adjustments.multicurrency.spec.ts` for the Adjustment advisory-lock namespace/key, lock-first ordering before `tx.adjustment.findFirst`, active transaction-client propagation to conversion, complete state-plus-snapshot update, update failure rollback using a transaction-aware durable double, retry immutability, and legacy-null non-repair. Record the baseline failure before changing production code. <!-- sdd-owner: implementation -->

**RED command:** `npm run test -w apps/api -- --runInBand finanzas/adjustments.multicurrency.spec.ts`

### GREEN

- [x] Add `acquireAdjustmentLock` beside `acquireExpenseLock` in `apps/api/src/finanzas/movement-locks.ts` using `buildingos:adjustment-movement:v1`, tenant-scoped `${tenantId}:${adjustmentId}` identity, `Prisma.TransactionClient`, and `pg_advisory_xact_lock(hashtextextended(..., 0))`. <!-- sdd-owner: implementation -->
- [x] Import and invoke the Adjustment lock as the first operation inside the existing `validateAdjustment` transaction in `apps/api/src/finanzas/adjustments.service.ts`; retain the existing tenant-scoped read, UTC `sourceInvoiceDate` conversion, `convert(..., tx)`, single update, post-commit best-effort audit, and non-`DRAFT` guard. <!-- sdd-owner: implementation -->

**GREEN command:** `npm run test -w apps/api -- --runInBand finanzas/adjustments.multicurrency.spec.ts`

### TRIANGULATE

- [x] Extend the same Adjustment tests to prove missing-rate and conversion errors perform no update, final-write errors leave the durable fixture `DRAFT` with all snapshot fields null, and a retry against an effective record calls neither conversion nor update and preserves byte-for-value evidence. <!-- sdd-owner: implementation -->
- [x] Verify the lock SQL contains `buildingos:adjustment-movement:v1:tenant-1:adjustment-1`, the lock precedes the authoritative read, and the exact transaction client—not the root Prisma client—is passed to conversion. <!-- sdd-owner: implementation -->

**TRIANGULATE command:** `npm run test -w apps/api -- --runInBand finanzas/adjustments.multicurrency.spec.ts -t "lock|rollback|retry|legacy|transaction"`

### REFACTOR

- [x] Refactor only local test fixtures and assertions in the three allowed files; retain typed Prisma clients, tenant scoping, explicit canonical fields, and no duplicated conversion or lock implementation. <!-- sdd-owner: implementation -->

**Runtime harness:** `N/A` for this unit because it is focused service/Jest coverage; the real PostgreSQL race is gated to PR 3. Record that reason explicitly.

## PR 2 — Prove Expense and Income atomic snapshot invariants

**Dependency:** PR 1 is green. **Review boundary:** `260–380` changed lines expected. **Candidate outcome:** `test(finance): prove expense and income snapshot rollback invariants` (do not create a commit in this task).

**Exact allowed edit surfaces:**

- `apps/api/src/finanzas/expenses.multicurrency.spec.ts`
- `apps/api/src/finanzas/incomes.multicurrency.spec.ts`
- `apps/api/src/finanzas/atomic-movement-lifecycle.spec.ts` only if a shared test-local transaction fixture demonstrably reduces duplication

Production service files are not allowed in this slice. If RED reveals an actual Expense or Income behavior defect rather than missing evidence, stop this slice, record the failure, and request a new dependency-ordered work unit instead of expanding the edit surface.

**Rollback boundary:** revert only the test files and any test-local helper introduced in `atomic-movement-lifecycle.spec.ts`; no runtime or database rollback is needed.

### CHARACTERIZATION / REGRESSION COVERAGE

- [x] Add focused tests for Expense `DRAFT → VALIDATED` and Income `DRAFT → RECORDED` that assert every canonical snapshot field is written in the same state update, the UTC date-only source date is used, missing rates preserve `EXCHANGE_RATE_NOT_FOUND`, and final persistence failure leaves no durable state or partial evidence. Baseline/candidate inspection confirmed the Expense and Income lifecycle services are unchanged from `18d8adb7a699144148a13a94c927a761251eb91a`; no baseline RED is claimed. <!-- sdd-owner: implementation -->
- [x] Add retry/immutability and legacy-null regression coverage for both services, including no conversion/update on already-effective records and no inferred or synthetic snapshot writes. Include Expense bulk validation where that path is applicable; do not claim a failing baseline when the existing guards satisfy the assertions. <!-- sdd-owner: implementation -->

**Characterization command:** `npm run test -w apps/api -- --runInBand finanzas/expenses.multicurrency.spec.ts finanzas/incomes.multicurrency.spec.ts finanzas/atomic-movement-lifecycle.spec.ts`

### GREEN

- [x] Replace call-count-only rollback assertions with transaction-aware, test-local durable fixtures in the allowed spec files; make the tests model commit only after a successful callback and assert the persisted operation remains non-effective with null snapshot fields after a forced final-write failure. <!-- sdd-owner: implementation -->
- [x] Strengthen existing transaction-client assertions so Expense and Income tenant lookup and conversion both use the active `Prisma.TransactionClient`, without changing either production service. <!-- sdd-owner: implementation -->

**GREEN command:** `npm run test -w apps/api -- --runInBand finanzas/expenses.multicurrency.spec.ts finanzas/incomes.multicurrency.spec.ts finanzas/atomic-movement-lifecycle.spec.ts`

### TRIANGULATE

- [x] Verify direct, inverse, and identity evidence paths for both operations while asserting exact UTC `invoiceDate`/`receivedDate` conversion dates, tenant-scoped rate selection, and unchanged existing snapshot values on retry. <!-- sdd-owner: implementation -->
- [x] Verify the focused lifecycle tests still cover allocation rollback and post-commit audit behavior, so the new snapshot assertions do not weaken existing financial transaction guarantees. <!-- sdd-owner: implementation -->

**TRIANGULATE command:** `npm run test -w apps/api -- --runInBand finanzas/expenses.multicurrency.spec.ts finanzas/incomes.multicurrency.spec.ts finanzas/atomic-movement-lifecycle.spec.ts -t "snapshot|rollback|retry|legacy|transaction|audit"`

### REFACTOR

- [x] Consolidate only duplicated test-local snapshot/durable-fixture helpers, keep tests with the behavior they prove, and preserve explicit failure assertions rather than hiding rejected or skipped validation. <!-- sdd-owner: implementation -->

**Runtime harness:** `N/A` for this unit because it uses focused Jest transaction doubles; real multi-client lock waiting is verified only by the gated local PostgreSQL unit.

## PR 3 — Verify Adjustment concurrency on local PostgreSQL

**Dependency:** PR 1 and PR 2 are green. **Review boundary:** `220–360` changed lines expected. **Candidate outcome:** `test(finance): verify operation snapshot races on postgres` (do not create a commit in this task).

**Exact allowed edit surface:**

- `apps/api/src/finanzas/atomic-movement-lifecycle.postgres.spec.ts`

**Rollback boundary:** revert only the dedicated PostgreSQL fixture, Adjustment service wiring, barrier, and race test additions in this spec. Never delete or mutate committed financial evidence as part of test cleanup.

### REGRESSION COVERAGE FOR PR 1

- [x] Add a gated PostgreSQL test using two independent Prisma clients and one draft Adjustment that races concurrent `validateAdjustment` calls; assert one fulfillment, one existing non-`DRAFT` rejection, one `VALIDATED` row, one complete unchanged snapshot, and canonical FX lock traversal. Baseline source lacks PR 1's Adjustment lifecycle lock, while the candidate adds it; the baseline test was not executed, so no baseline RED is claimed. <!-- sdd-owner: implementation -->

**Candidate coverage command:** `RUN_POSTGRES_INTEGRATION=1 POSTGRES_TEST_DB_NAME=buildingos_fin02a_acceptance npm run test -w apps/api -- --runInBand finanzas/atomic-movement-lifecycle.postgres.spec.ts`

### GREEN

- [x] Extend only the PostgreSQL spec's disposable fixture and service factory to create an Adjustment, install a deterministic advisory-lock barrier without sleeps as correctness evidence, and invoke the real Adjustment service through separate clients. Keep tenant/user/membership cleanup scoped to the test fixture. <!-- sdd-owner: implementation -->
- [x] Keep the guard fail-closed: run the test only when `RUN_POSTGRES_INTEGRATION=1`, `POSTGRES_TEST_DB_NAME=buildingos_fin02a_acceptance`, and a local `DATABASE_URL` are present; otherwise the result is explicitly recorded as skipped, never treated as passed. <!-- sdd-owner: implementation -->

**GREEN command:** `RUN_POSTGRES_INTEGRATION=1 POSTGRES_TEST_DB_NAME=buildingos_fin02a_acceptance npm run test -w apps/api -- --runInBand finanzas/atomic-movement-lifecycle.postgres.spec.ts`

### TRIANGULATE

- [x] Assert durable database state after both promises settle: exactly one effective transition, complete canonical fields, UTC `sourceInvoiceDate` conversion date, unchanged source-rate evidence, and no duplicate audit/effect observable through the operation row. <!-- sdd-owner: implementation -->
- [x] Confirm the test exercises the Adjustment lifecycle lock before the PHASE 3B pair/rate locks using a non-identity rate fixture, while avoiding timing-only assertions and avoiding any staging or production database. <!-- sdd-owner: implementation -->

**TRIANGULATE command:** `RUN_POSTGRES_INTEGRATION=1 POSTGRES_TEST_DB_NAME=buildingos_fin02a_acceptance npm run test -w apps/api -- --runInBand finanzas/atomic-movement-lifecycle.postgres.spec.ts -t "Adjustment|snapshot|concurrent|race"`

### REFACTOR

- [x] Remove only unnecessary barrier complexity, ensure trigger/function cleanup runs in `finally`, retain the allowlisted-database refusal, and leave the PostgreSQL spec deterministic and independently runnable. <!-- sdd-owner: implementation -->

**Runtime harness:** the gated local PostgreSQL command above is mandatory when the disposable acceptance database is available; if unavailable, record the exact skip reason and keep the delivery gate open.

## Final local verification boundaries

- Run the focused Jest slices for each completed work unit before any broader validation.
- Run the gated PostgreSQL slice only against the allowlisted disposable local database; never use staging, production, a remote host, or a non-allowlisted database.
- Run applicable local typecheck, lint, and `git diff --check` according to repository policy; do not run a build, migration, deploy, commit, or push without separate authorization.
- Report exact files changed, exact commands/results, skipped checks, measured authored additions plus deletions per chain slice, remaining risks, and rollback boundaries.
- Confirm that no DTO/controller/frontend change was introduced because the current response mapping already exposes the nullable snapshot contract.

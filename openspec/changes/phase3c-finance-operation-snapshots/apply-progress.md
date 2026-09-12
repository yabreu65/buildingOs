# Apply Progress — PR 1: Adjustment lifecycle lock

## Status consumed

- Change: `phase3c-finance-operation-snapshots`; artifact store: `openspec`.
- Authoritative apply state: `ready`; action context: `repo-local` at `/Users/yoryiabreu/proyectos/buildingos` with that repository as the allowed edit root.
- Delivery path: `auto-chain`, assigned slice `adjustment-lifecycle-lock` / PR 1; 400-line review budget.
- Action-context warnings: none.

## Completed implementation tasks

- Marked the six PR 1 implementation-owned tasks in `tasks.md` as completed.
- Added a transaction-scoped, tenant-and-Adjustment-specific advisory lock before the authoritative Adjustment read.
- Preserved the canonical conversion service, exact transaction-client propagation, UTC source-invoice date conversion, canonical state-plus-snapshot update, existing audit timing, status guard, and Phase 3B pair/rate locks.
- Added focused lifecycle tests for SQL key/order, active transaction client, complete write, rollback durable state, retry immutability, and legacy-null non-repair.

## Files changed

- `apps/api/src/finanzas/movement-locks.ts` — adds `acquireAdjustmentLock` using the Adjustment lifecycle namespace.
- `apps/api/src/finanzas/adjustments.service.ts` — acquires the lifecycle lock as the first transaction operation.
- `apps/api/src/finanzas/adjustments.multicurrency.spec.ts` — adds lifecycle transaction and durable rollback guarantees, and refactors duplicated conversion results.
- `openspec/changes/phase3c-finance-operation-snapshots/tasks.md` — marks only PR 1 implementation tasks complete.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| RED lifecycle guarantees | `adjustments.multicurrency.spec.ts` | Unit | `npm run test -w apps/api -- --runInBand finanzas/adjustments.multicurrency.spec.ts` — exit 0, 23/23 passed | Same command — exit 1, 1 new lock-order failure and 23 passed | Exit 0, 24/24 passed after the minimum lock helper/wiring | Exit 0, focused `-t "lock|rollback|retry|legacy|transaction"`, 4 passed | Exit 0, full focused file 25/25 passed |
| GREEN lock helper | `adjustments.multicurrency.spec.ts` | Unit | 23/23 passed | Lock-order test written before production code | Exit 0, 24/24 passed | SQL namespace/order retained in focused run | No duplicate lock implementation introduced |
| GREEN service wiring | `adjustments.multicurrency.spec.ts` | Unit | 23/23 passed | Lock-first transaction test written before production code | Exit 0, 24/24 passed | Exact `tx` propagation and retry assertions passed | No production refactor needed |
| TRIANGULATE durable rollback | `adjustments.multicurrency.spec.ts` | Unit | 24/24 passed after GREEN | Transaction-aware final-write failure test added after GREEN | Existing transaction boundary already passed it | Exit 0, 4 focused tests passed | Shared conversion result fixture retained behavior |
| TRIANGULATE retry and legacy | `adjustments.multicurrency.spec.ts` | Unit | 24/24 passed after GREEN | Effective retry and legacy-null assertions added | Existing non-`DRAFT` guard already passed them | Exit 0, 4 focused tests passed | Shared conversion result fixture retained behavior |
| REFACTOR test fixture | `adjustments.multicurrency.spec.ts` | Unit | 25/25 before final fixture run | N/A — behavior already specified | N/A | Existing distinct success, failure, retry, and legacy paths retained | Extracted duplicated conversion result; exit 0, 25/25 passed |

## Verification

- `npm run test -w apps/api -- --runInBand finanzas/adjustments.multicurrency.spec.ts` — baseline exit 0 (23 passed), RED exit 1 (new test failed with observed `['read']` instead of `['lock', 'read']`), GREEN exit 0 (24 passed), REFACTOR exit 0 (25 passed).
- `npm run test -w apps/api -- --runInBand finanzas/adjustments.multicurrency.spec.ts -t "lock|rollback|retry|legacy|transaction"` — exit 0; 4 passed, 21 skipped by the focused name filter.
- `rtk tsc --noEmit -p apps/api/tsconfig.json` — exit 2 from 76 pre-existing errors in unrelated documents, onboarding-imports, receipts, and reconciliation files; no changed PR 1 file was reported.
- `git diff --check` — exit 0.
- Runtime harness: N/A. This is focused service/Jest coverage; the real two-client PostgreSQL race is explicitly gated to PR 3.

## Workload and rollback

- PR boundary: PR 1 only (`adjustment-lifecycle-lock`), chained before PR 2 and PR 3.
- Authored production/test diff before OpenSpec artifacts: 187 changed lines (186 additions, 1 deletion), below the 400-line budget.
- Rollback boundary: revert `acquireAdjustmentLock`, its `validateAdjustment` import/call, and the Adjustment lifecycle tests together. This does not alter persisted snapshots or any Phase 3B FX locks.
- Deviations from design: none.

## Remaining tasks

- [ ] Add failing focused tests for Expense `DRAFT → VALIDATED` and Income `DRAFT → RECORDED` that assert every canonical snapshot field is written in the same state update, the UTC date-only source date is used, missing rates preserve `EXCHANGE_RATE_NOT_FOUND`, and final persistence failure leaves no durable state or partial evidence. <!-- sdd-owner: implementation -->
- [ ] Add failing retry/immutability and legacy-null tests for both services, including no conversion/update on already-effective records and no inferred or synthetic snapshot writes. Include Expense bulk validation where that path is applicable. <!-- sdd-owner: implementation -->
- [ ] Replace call-count-only rollback assertions with transaction-aware, test-local durable fixtures in the allowed spec files; make the tests model commit only after a successful callback and assert the persisted operation remains non-effective with null snapshot fields after a forced final-write failure. <!-- sdd-owner: implementation -->
- [ ] Strengthen existing transaction-client assertions so Expense and Income tenant lookup and conversion both use the active `Prisma.TransactionClient`, without changing either production service. <!-- sdd-owner: implementation -->
- [ ] Verify direct, inverse, and identity evidence paths for both operations while asserting exact UTC `invoiceDate`/`receivedDate` conversion dates, tenant-scoped rate selection, and unchanged existing snapshot values on retry. <!-- sdd-owner: implementation -->
- [ ] Verify the focused lifecycle tests still cover allocation rollback and post-commit audit behavior, so the new snapshot assertions do not weaken existing financial transaction guarantees. <!-- sdd-owner: implementation -->
- [ ] Consolidate only duplicated test-local snapshot/durable-fixture helpers, keep tests with the behavior they prove, and preserve explicit failure assertions rather than hiding rejected or skipped validation. <!-- sdd-owner: implementation -->
- [ ] Add a gated PostgreSQL test using two independent Prisma clients and one draft Adjustment that races concurrent `validateAdjustment` calls; assert one fulfillment, one existing non-`DRAFT` rejection, one `VALIDATED` row, one complete unchanged snapshot, and canonical FX lock traversal. Classify it as PR 1 regression coverage and record only observed baseline/candidate evidence. <!-- sdd-owner: implementation -->
- [ ] Extend only the PostgreSQL spec's disposable fixture and service factory to create an Adjustment, install a deterministic advisory-lock barrier without sleeps as correctness evidence, and invoke the real Adjustment service through separate clients. Keep tenant/user/membership cleanup scoped to the test fixture. <!-- sdd-owner: implementation -->
- [ ] Keep the guard fail-closed: run the test only when `RUN_POSTGRES_INTEGRATION=1`, `POSTGRES_TEST_DB_NAME=buildingos_fin02a_acceptance`, and a local `DATABASE_URL` are present; otherwise the result is explicitly recorded as skipped, never treated as passed. <!-- sdd-owner: implementation -->
- [ ] Assert durable database state after both promises settle: exactly one effective transition, complete canonical fields, UTC `sourceInvoiceDate` conversion date, unchanged source-rate evidence, and no duplicate audit/effect observable through the operation row. <!-- sdd-owner: implementation -->
- [ ] Confirm the test exercises the Adjustment lifecycle lock before the PHASE 3B pair/rate locks using a non-identity rate fixture, while avoiding timing-only assertions and avoiding any staging or production database. <!-- sdd-owner: implementation -->
- [ ] Remove only unnecessary barrier complexity, ensure trigger/function cleanup runs in `finally`, retain the allowlisted-database refusal, and leave the PostgreSQL spec deterministic and independently runnable. <!-- sdd-owner: implementation -->

## PR 2: Expense and Income snapshot invariants

### Status consumed

- Change: `phase3c-finance-operation-snapshots`; artifact store: `openspec`.
- Authoritative apply state: `ready`; action context: `repo-local` at `/Users/yoryiabreu/proyectos/buildingos`, with that repository as the allowed edit root; warnings: none.
- Delivery path: `auto-chain`, assigned PR 2 / `expense-income-snapshot-invariants`; 400 changed-line review budget.

### Completed implementation tasks

- Marked the seven PR 2 implementation-owned tasks in `tasks.md` as complete and re-read the artifact to confirm their `- [x]` state.
- Added transaction-aware, test-local durable fixtures for a forced final write failure. Each fixture stages the operation update and commits it only after the callback succeeds, so rejected writes leave the durable Expense `DRAFT` or Income `DRAFT` with every snapshot field null.
- Added retry assertions for legacy effective records: both services reject before tenant lookup, FX conversion/rate lookup, or update, and preserve null historical evidence. The Expense coverage uses the applicable bulk validation route.
- Retained and exercised the focused direct, inverse, identity, UTC business-date, tenant-rate-selection, active transaction-client, allocation-rollback, and post-commit-audit coverage. No production service, PHASE 3B engine, lock, schema, DTO, or API behavior changed.
- No shared helper was added to `atomic-movement-lifecycle.spec.ts`: the state fixtures are service-shape-specific, and importing a helper from a Jest spec would also register that spec's test suite. Keeping the two fixtures local avoids that coupling while preserving explicit assertions.

### Files changed

- `apps/api/src/finanzas/expenses.multicurrency.spec.ts` — adds durable final-write rollback and bulk retry/legacy non-repair coverage.
- `apps/api/src/finanzas/incomes.multicurrency.spec.ts` — adds durable final-write rollback and recorded legacy retry/non-repair coverage.
- `openspec/changes/phase3c-finance-operation-snapshots/tasks.md` — marks only the seven completed PR 2 implementation tasks.
- `openspec/changes/phase3c-finance-operation-snapshots/apply-progress.md` — appends PR 2 evidence without removing PR 1 history.

### TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Complete snapshot, missing-rate, and durable final-write rollback | `expenses.multicurrency.spec.ts`, `incomes.multicurrency.spec.ts` | Unit | `npm run test -w apps/api -- --runInBand finanzas/expenses.multicurrency.spec.ts finanzas/incomes.multicurrency.spec.ts finanzas/atomic-movement-lifecycle.spec.ts` — exit 0, 56/56 passed before edits | New final-write rollback tests were written first; first execution was already green (Expense 21/21, then combined 60/60), so no real behavioral RED defect existed and no production edit was authorized. | No production code required; combined focused run exit 0, 60/60 passed. | Direct, inverse, identity, UTC date, missing-rate, and durable failure paths passed in the focused filter run. | Kept service-specific durable fixtures local; final focused run exit 0, 60/60 passed. |
| Retry immutability, legacy-null non-repair, and transaction client | `expenses.multicurrency.spec.ts`, `incomes.multicurrency.spec.ts`, `atomic-movement-lifecycle.spec.ts` | Unit | Same 56/56 baseline | New effective legacy-retry tests were written before implementation; they passed on first execution because the existing non-`DRAFT` guards already reject before conversion/update. | No production code required; active-client assertions continue to prove root tenant access is unused and `convert(..., tx)` receives the transaction client. | `npm run test -w apps/api -- --runInBand finanzas/expenses.multicurrency.spec.ts finanzas/incomes.multicurrency.spec.ts finanzas/atomic-movement-lifecycle.spec.ts -t "snapshot|rollback|retry|legacy|transaction|audit"` — exit 0, 53 passed, 7 skipped. | No cross-spec helper extraction: it would couple Jest suite registration and not reduce meaningful service-specific setup; final 60/60 remains green. |
| Lifecycle regression coverage | `atomic-movement-lifecycle.spec.ts` | Unit | Same 56/56 baseline | Existing lifecycle allocation rollback/audit cases were retained as approval coverage; no production defect was observed. | No code change needed. | Focused filter passed the allocation rollback and post-commit audit cases. | No change required; the focused lifecycle file remains green. |

### Verification

- `npm run test -w apps/api -- --runInBand finanzas/expenses.multicurrency.spec.ts finanzas/incomes.multicurrency.spec.ts finanzas/atomic-movement-lifecycle.spec.ts` — safety net exit 0, 56/56 passed before edits; final exit 0, 60/60 passed.
- `rtk test npm run test -w apps/api -- --runInBand finanzas/expenses.multicurrency.spec.ts finanzas/incomes.multicurrency.spec.ts finanzas/atomic-movement-lifecycle.spec.ts -t "snapshot|rollback|retry|legacy|transaction|audit"` — test output showed 50 passed/10 skipped, but RTK returned exit 255; rerun directly because the wrapper failed.
- `npm run test -w apps/api -- --runInBand finanzas/expenses.multicurrency.spec.ts finanzas/incomes.multicurrency.spec.ts finanzas/atomic-movement-lifecycle.spec.ts -t "snapshot|rollback|retry|legacy|transaction|audit"` — exit 0, 53 passed, 7 skipped.
- `rtk git diff --check` — exit 0.
- Runtime harness: N/A. This PR uses focused Jest transaction doubles; real multi-client lifecycle lock waiting remains the gated local PostgreSQL scope of PR 3.

### Workload and rollback

- PR boundary: PR 2 only (`expense-income-snapshot-invariants`), stacked after PR 1 and before PR 3.
- Authored production/test diff: 146 changed lines (142 additions, 4 deletions), below the 400-line budget. No production files changed.
- Rollback boundary: revert only the two modified multicurrency test files and the PR 2 task/progress entries; no runtime or database rollback is needed.
- Deviations from design: none. The requested RED tests initially passed because the existing production behavior already fulfilled the asserted invariant; this was evidence-only work and did not justify a forbidden production edit.

### Current remaining implementation tasks

- [ ] Add a gated PostgreSQL test using two independent Prisma clients and one draft Adjustment that races concurrent `validateAdjustment` calls; assert one fulfillment, one existing non-`DRAFT` rejection, one `VALIDATED` row, one complete unchanged snapshot, and canonical FX lock traversal. <!-- sdd-owner: implementation -->
- [ ] Extend only the PostgreSQL spec's disposable fixture and service factory to create an Adjustment, install a deterministic advisory-lock barrier without sleeps as correctness evidence, and invoke the real Adjustment service through separate clients. Keep tenant/user/membership cleanup scoped to the test fixture. <!-- sdd-owner: implementation -->
- [ ] Keep the guard fail-closed: run the test only when `RUN_POSTGRES_INTEGRATION=1`, `POSTGRES_TEST_DB_NAME=buildingos_fin02a_acceptance`, and a local `DATABASE_URL` are present; otherwise the result is explicitly recorded as skipped, never treated as passed. <!-- sdd-owner: implementation -->
- [ ] Assert durable database state after both promises settle: exactly one effective transition, complete canonical fields, UTC `sourceInvoiceDate` conversion date, unchanged source-rate evidence, and no duplicate audit/effect observable through the operation row. <!-- sdd-owner: implementation -->
- [ ] Confirm the test exercises the Adjustment lifecycle lock before the PHASE 3B pair/rate locks using a non-identity rate fixture, while avoiding timing-only assertions and avoiding any staging or production database. <!-- sdd-owner: implementation -->
- [ ] Remove only unnecessary barrier complexity, ensure trigger/function cleanup runs in `finally`, retain the allowlisted-database refusal, and leave the PostgreSQL spec deterministic and independently runnable. <!-- sdd-owner: implementation -->

## PR 3: Adjustment PostgreSQL concurrency

### Status consumed

- Change: `phase3c-finance-operation-snapshots`; artifact store: `openspec`; authoritative `applyState`: `ready`.
- Action context: `repo-local` at `/Users/yoryiabreu/proyectos/buildingos`; allowed edit root is the repository; warnings: none.
- Delivery path: `auto-chain`, assigned PR 3 / `adjustment-postgres-concurrency`; 400-line budget.

### Completed implementation tasks

- Marked all six PR 3 implementation-owned PostgreSQL tasks as `[x]` in `tasks.md` and re-read them to confirm their persisted state.
- Added a guarded real-PostgreSQL Adjustment race using two independent clients, a DRAFT Adjustment, a non-identity USD→VES rate, and the existing advisory-lock barrier.
- The first transaction reaches the Adjustment update barrier only after its captured lock order is Adjustment lifecycle → canonical FX pair → canonical FX rate row. The second waits on the Adjustment lock and rejects through the existing non-`DRAFT` guard after the first commits.
- The durable row proves exactly one `VALIDATED` transition and a complete direct snapshot, including UTC `2026-08-09T00:00:00.000Z` conversion from `2026-08-09T23:30:00.000Z` and unchanged rate evidence.
- Extended the explicit disposable allowlist to `buildingos_local_v2_test` under the user-authorized local URL, while requiring the run flag, an allowlisted expected database name, a loopback `DATABASE_URL`, and a post-connect database-name match.

### Files changed

- `apps/api/src/finanzas/atomic-movement-lifecycle.postgres.spec.ts` — adds the Adjustment service wrapper with SQL lock observation, Adjustment trigger barrier coverage, local loopback/allowlist gate, and durable two-client race assertions.
- `openspec/changes/phase3c-finance-operation-snapshots/tasks.md` — marks only the six completed PR 3 tasks.
- `openspec/changes/phase3c-finance-operation-snapshots/apply-progress.md` — appends this cumulative PR 3 evidence.

### TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Adjustment concurrent validation and local gate | `atomic-movement-lifecycle.postgres.spec.ts` | PostgreSQL integration | Local command with the requested database before edits: exit 0, suite skipped because the previous single-value allowlist excluded `buildingos_local_v2_test`. | Test was added before test-harness changes; after enabling the user-approved local allowlist, it passed on its first executable run because the PR 1 lifecycle lock already exists in this worktree. A baseline behavioral failure against pre-PR-1 code could not be rerun without removing another work unit, so no failure is claimed. | Full local PostgreSQL spec: exit 0, 12/12 passed. No production edit was needed. | Required filtered command: exit 0, 3 passed and 9 skipped; it includes the Adjustment race plus existing distinct concurrent update/record barriers. | Removed the attempted whole-file formatter rewrite because it expanded the slice beyond budget; retained only local helpers and reran the Adjustment focus and full PostgreSQL spec green. |

### Verification

- `RUN_POSTGRES_INTEGRATION=1 POSTGRES_TEST_DB_NAME=buildingos_local_v2_test DATABASE_URL='postgresql://buildingos:buildingos@127.0.0.1:5434/buildingos_local_v2_test?schema=public' npm run test -w apps/api -- --runInBand finanzas/atomic-movement-lifecycle.postgres.spec.ts` — exit 0; 12/12 passed.
- Same command with `-t 'Adjustment|snapshot|concurrent|race'` — exit 0; 3 passed, 9 skipped by the name filter.
- Same command with `-t 'Adjustment'` — exit 0; 1 passed, 11 skipped by the name filter after local refactor.
- `git diff --check` — exit 0.
- Runtime harness: the real local PostgreSQL gate ran against only `buildingos_local_v2_test`; no staging, production, remote system, migration, commit, or push was used.

### Workload, deviations, and rollback

- PR boundary: PR 3 only (`adjustment-postgres-concurrency`), stacked after PR 1 and PR 2.
- Authored test diff: 138 changed lines (135 additions, 3 deletions), below the 400-line budget.
- Rollback boundary: revert only the Adjustment PostgreSQL fixture/wrapper, barrier trigger extensions, allowlist gate, and race test in `atomic-movement-lifecycle.postgres.spec.ts`; test cleanup never alters persisted financial evidence outside its fixture tenant.
- Deviation: the task text names only `buildingos_fin02a_acceptance`; the user explicitly authorized the narrowly expanded `buildingos_local_v2_test` allowlist because that database was unavailable. The earlier requested RED failure is unavailable in the current worktree because PR 1 is already present; the first executable new integration test passed and is recorded honestly.
- Remaining implementation tasks: none. All implementation-owned rows in this task artifact are marked `[x]`.

## Verify remediation — Income production assertion and evidence classification

### Status consumed

- Remediation objective: `income-production-assertion-and-characterization`; user supplied the active attempt and exact allowed edit surfaces, resolving the stale ambiguous-selection status for this remediation only.
- Native status warning: it named multiple changes and `applyState: blocked`; this remediation proceeds only because the user explicitly selected `phase3c-finance-operation-snapshots` and restricted edits to its Income test and OpenSpec artifacts.
- Action context remains `repo-local` at `/Users/yoryiabreu/proyectos/buildingos`; every edit is inside the supplied allowed surfaces.

### Completed remediation tasks and persisted checkbox reconciliation

- Replaced the fixture-only Income lifecycle assertion with a real `IncomesService.recordIncome` invocation in `apps/api/src/finanzas/incomes.multicurrency.spec.ts`.
- The production result now asserts the schema's source values (`amountMinor`, `currencyCode`) and every applicable direct snapshot value: functional amount/currency, rate id/value/direction/effective time, and conversion date. `Income` has no `originalAmountMinor` or `originalCurrency` columns; source values are stored as `amountMinor` and `currencyCode` before recording, so the lifecycle update correctly writes only state, actor/time, and snapshot evidence.
- The same test asserts one interactive transaction and one `income.update` containing the state plus the full snapshot. Direct, inverse, identity, missing-rate, final-write rollback, and immutability coverage remain in the focused Income suite.
- Re-read `tasks.md`: every completed implementation-owned row remains visibly `[x]`; PR 2 is labeled **CHARACTERIZATION / REGRESSION COVERAGE** and PR 3 **REGRESSION COVERAGE FOR PR 1**, with no claimed baseline RED.

### Baseline/candidate evidence classification

| Slice | Classification | Baseline `18d8adb7a699144148a13a94c927a761251eb91a` inspection | Candidate evidence | Protected guarantee |
|---|---|---|---|---|
| PR 2 — Expense/Income invariants | CHARACTERIZATION / REGRESSION COVERAGE | `git diff --quiet 18d8adb… -- apps/api/src/finanzas/expenses.service.ts apps/api/src/finanzas/incomes.service.ts` reports both lifecycle services unchanged. The new assertions were not present at baseline, so no baseline runtime result for them is fabricated. | Focused candidate Income suite passes 27/27 and the associated Expense/Income/lifecycle suite passes 60/60. | Effective transition persists complete FX evidence atomically; missing rates and final writes do not leave partial state; retries preserve evidence. |
| PR 3 — Adjustment PostgreSQL race | REGRESSION COVERAGE FOR PR 1 | `git diff --stat 18d8adb… -- apps/api/src/finanzas/adjustments.service.ts apps/api/src/finanzas/movement-locks.ts` shows the candidate adds the 21-line PR 1 lifecycle lock behavior, so it did not exist at baseline. No baseline race execution was performed. | Previously recorded candidate local allowlisted PostgreSQL run passed 12/12, including the Adjustment race; this remediation did not rerun PostgreSQL because it only changes the Income assertion and OpenSpec evidence. | PR 1's lifecycle lock serializes Adjustment validation before PHASE 3B pair/rate locking, leaving one complete durable snapshot. |

### TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Replace fixture-only Income assertion | `apps/api/src/finanzas/incomes.multicurrency.spec.ts` | Unit | Focused suite before edit: exit 0, 27/27 passed | The replacement is an approval/characterization assertion over existing production behavior; it passed on first execution, so no RED failure is claimed and no production code was changed. | Focused suite after edit: exit 0, 27/27 passed | Existing direct/inverse/identity/missing-rate/rollback/immutability cases remain exercised; associated suite exit 0, 60/60 passed | No refactor beyond replacing the non-production assertion. |

### Verification

- `npm run test -w apps/api -- --runInBand finanzas/incomes.multicurrency.spec.ts` — exit 0; 27/27 passed before the replacement and 27/27 passed after it.
- `npm run test -w apps/api -- --runInBand finanzas/expenses.multicurrency.spec.ts finanzas/incomes.multicurrency.spec.ts finanzas/atomic-movement-lifecycle.spec.ts` — exit 0; 60/60 passed after the replacement.
- `rtk git diff --check` — exit 0; no whitespace errors in tracked candidate changes. `git diff --no-index --check /dev/null` over each changed OpenSpec artifact also produced no whitespace errors.
- No production/schema/migration/manifest/remote change was made. PostgreSQL was not rerun because this remediation has no PostgreSQL test or production change; the prior successful candidate result is retained as historical evidence only.

### Workload and remaining tasks

- Remediation boundary: assertion/evidence correction only; no new chained PR boundary and no `size:exception`.
- Remaining implementation tasks: none. All implementation-owned rows in `tasks.md` are `[x]`.

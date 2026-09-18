# Apply Progress: Phase 3G.1 Historical Finance Inventory

## Status

**Implementation complete; ready for SDD verification.** Native status was read for `phase3g1-historical-finance-inventory`: OpenSpec is authoritative, `applyState: ready`, `nextRecommended: apply`, and the repository root is the permitted edit root. The resumed request explicitly prohibited retired `sdd-attempt` commands, so none were used.

## Completed work

### PR 1 — Read-only adapter and bounded pagination

- Preserved RED tests and implemented the capability-limited adapter, immutable `(createdSequence, id)` ordering validation, opaque cursor pagination, 100-record limit, and aggregate-only finding-cap metadata.
- Completed persisted task checkboxes 1–4.

### PR 2 — Classification and aggregate scanner

- Added synthetic unit tests for current, V1/V2/V3, legacy-income, unknown variant, missing counterpart, cross-tenant, currency, invariant, adapter failure, truncation, and repeated aggregate cases.
- Implemented deterministic classifier precedence: `INVALID_BLOCKING`, `REPAIRABLE`, `LEGACY_SUPPORTED`, then `SAFE`.
- Implemented the read-only aggregate scanner for all twelve finance and relationship categories. It indexes synthetic/provider-normalized records internally, validates required counterparts, tenant compatibility, currency compatibility/support, and invariants, then returns only redacted aggregate counts.
- Extracted the bounded aggregate counter into `aggregator.ts`; approval-focused tests remained green after the refactor.
- Added independent storage-summary composition that preserves separate finance and storage statuses/counts and leaves finance output unchanged without storage output.
- Completed persisted task checkboxes 5–8.

### PR 3 — Protected receipt, CLI, and documentation

- Added result status derivation for exact `COMPLETE_CLEAN`, `COMPLETE_WITH_FINDINGS`, `COMPLETE_WITH_BLOCKING_FINDINGS`, and `INCOMPLETE_OPERATIONAL_ERROR` values.
- Implemented protected receipt creation through a temporary `0600` file, atomic rename, and final permission enforcement.
- Implemented the opt-in injected CLI boundary with only `--receipt` and `--max-findings`; it emits one aggregate-only JSON summary and returns non-success for blocking or operational states. It rejects detail/repair flags.
- Added `README.md` documenting invocation boundaries, statuses, receipt protection, separate storage composition, aggregate-only output, and the non-remediation boundary.
- Completed persisted task checkboxes 9–12 and all final completion-evidence checkboxes.

## Persisted task checkboxes

`tasks.md` was re-read after completion: all 15 implementation-owned checkbox rows are visibly marked `- [x]`.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PR 1 tasks 1–4 | `adapter.spec.ts`, `pagination.spec.ts` | Unit | 12/12 focused tests passed before PR 2/3 edits | Existing missing-module RED retained | 12/12 passed | Empty, malformed, duplicate cursor, cap, and read-error cases | Pagination callback preserved existing behavior; tests stayed green |
| PR 2 tasks 5–8 | `classifier.spec.ts`, `scanner.spec.ts`, `result.spec.ts` | Unit | 12/12 PR 1 tests passed | Four new suites initially failed on absent classifier/scanner/result modules | 29/29 inventory tests passed | Legacy, repairable, five blocking categories, operational, truncation, and storage-composition cases | Aggregate-only result helpers extracted; final focused run stayed green |
| PR 3 tasks 9–12 | `receipt.spec.ts`, `cli.spec.ts`, `result.spec.ts` | Unit | 12/12 PR 1 tests passed | New receipt/CLI suites initially failed on absent receipt/CLI modules | 29/29 inventory tests passed | Exact statuses, protected write failure, blocking exit, and rejected detail flag cases | Final focused run passed 31/31 after status and receipt-failure triangulation |

## Tests and validation

- `rtk test npm run test -w apps/api -- --runInBand --no-cache src/reconciliation/historical-finance-inventory/adapter.spec.ts src/reconciliation/historical-finance-inventory/pagination.spec.ts`
  - PASS: 2 suites, 12 tests (PR 1 safety net).
- `rtk test npm run test -w apps/api -- --runInBand --no-cache src/reconciliation/historical-finance-inventory/classifier.spec.ts src/reconciliation/historical-finance-inventory/scanner.spec.ts src/reconciliation/historical-finance-inventory/receipt.spec.ts src/reconciliation/historical-finance-inventory/cli.spec.ts`
  - RED: failed as expected before implementation because the four production modules did not exist.
- `rtk test npm run test -w apps/api -- --runInBand --no-cache src/reconciliation/historical-finance-inventory/adapter.spec.ts src/reconciliation/historical-finance-inventory/pagination.spec.ts src/reconciliation/historical-finance-inventory/classifier.spec.ts src/reconciliation/historical-finance-inventory/scanner.spec.ts src/reconciliation/historical-finance-inventory/result.spec.ts src/reconciliation/historical-finance-inventory/receipt.spec.ts src/reconciliation/historical-finance-inventory/cli.spec.ts`
  - PASS: 7 suites, 31 tests.
- `npm exec --workspace @buildingos/api eslint -- src/reconciliation/historical-finance-inventory/...`
  - PASS: no findings.
- `rtk tsc --noEmit -p apps/api/tsconfig.json`
  - Initial refactor run failed with a missing `FinanceClassification` type import in `scanner.ts`; the import was restored and the rerun PASSed with no errors.

## Files changed

- `apps/api/src/reconciliation/historical-finance-inventory/contracts.ts`
- `apps/api/src/reconciliation/historical-finance-inventory/adapter.ts`
- `apps/api/src/reconciliation/historical-finance-inventory/paginator.ts`
- `apps/api/src/reconciliation/historical-finance-inventory/classifier.ts`
- `apps/api/src/reconciliation/historical-finance-inventory/aggregator.ts`
- `apps/api/src/reconciliation/historical-finance-inventory/scanner.ts`
- `apps/api/src/reconciliation/historical-finance-inventory/result.ts`
- `apps/api/src/reconciliation/historical-finance-inventory/receipt.ts`
- `apps/api/src/reconciliation/historical-finance-inventory/cli.ts`
- `apps/api/src/reconciliation/historical-finance-inventory/README.md`
- `apps/api/src/reconciliation/historical-finance-inventory/*.{adapter,pagination,classifier,scanner,result,receipt,cli}.spec.ts`
- `openspec/changes/phase3g1-historical-finance-inventory/{tasks,apply-progress}.md`

## Scope and delivery boundary

No package manifest or lockfile, schema, migration, index, frontend, accounting, repair, backfill, existing storage-inventory, staging, or production file was changed. No commit, push, merge, or PR was created. PR 2 and PR 3 were completed as separate logical chained work units in this worktree; their combined code/test/documentation scope exceeds one 400-line review budget, so delivery must remain split at the PR 2 → PR 3 boundary rather than treated as a size exception.

## Remaining tasks

None. Run `sdd-verify` for independent final verification.

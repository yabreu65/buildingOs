# Phase 3G.1 Historical Finance Inventory Tasks

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1,200 total; target ≤350 per chained PR |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No — user approved three chained slices
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

The total scope spans a new adapter, paginator, classifier, aggregate scanner, receipt/CLI boundary, synthetic tests, and operational documentation. Keep each PR independently testable and rollbackable; do not use a size exception.

## Implementation Order

### PR 1 — Read-only adapter, pagination, and bounded scan primitives

- [x] **RED — establish boundary and pagination evidence.** Add failing focused tests at `apps/api/src/reconciliation/historical-finance-inventory/{adapter,pagination}.spec.ts` for mutation rejection, read-only operation recording, stable ordering, `limit: 100`, 201-record multi-page scans, malformed pages, and non-advancing cursors; run the focused API Jest command and preserve the failing output before implementation. <!-- sdd-owner: implementation -->
- [x] **GREEN — implement the read-only data contract.** Create `apps/api/src/reconciliation/historical-finance-inventory/adapter.ts` and its read-only implementation with per-entity page readers for all covered finance entities and relationship data; expose no mutation methods and preserve opaque cursors internally. Verify the new RED tests pass; rollback is deletion of the new directory contents. <!-- sdd-owner: implementation -->
- [x] **GREEN — implement deterministic bounded pagination.** Create `paginator.ts` and `contracts.ts` with documented stable keys, page-size enforcement, malformed/non-advancing cursor rejection, page/entity metadata, and a 1,000-finding cap signal without storing cursor values. Verify pagination tests and adapter operation assertions pass. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE/REFACTOR — harden the primitive slice.** Add synthetic edge cases for empty pages, duplicate cursors, adapter read errors, and repeated identical runs; remove incidental production dependencies and confirm no storage-inventory, schema, migration, or finance-accounting files changed. <!-- sdd-owner: implementation -->

### PR 2 — Classification, relationship checks, and aggregate scanner

- [x] **RED — define classification and coverage evidence.** Add failing tests at `apps/api/src/reconciliation/historical-finance-inventory/classifier.spec.ts` and `scanner.spec.ts` covering every required entity/relationship, current valid `SAFE`, supported V1/V2/V3 and recognized income variants as `LEGACY_SUPPORTED`, non-blocking unknown variants as `REPAIRABLE`, and missing counterpart, cross-tenant, currency, invariant, and legacy-plus-blocking cases as `INVALID_BLOCKING`. <!-- sdd-owner: implementation -->
- [x] **GREEN — implement deterministic classifier rules.** Create `classifier.ts` with exactly one classification per condition and precedence `INVALID_BLOCKING` → `REPAIRABLE` → `LEGACY_SUPPORTED` → `SAFE`; validate both-side tenant ownership, required counterparts, and currencies without conversion or rewriting. Verify classifier tests pass. <!-- sdd-owner: implementation -->
- [x] **GREEN — implement aggregate scan orchestration.** Create `aggregator.ts` and `scanner.ts` to cover liquidations/charges, payments/allocations, expenses/adjustments, incomes/applications, movement allocations, liquidation-income offsets, currencies, and tenant relationships; cap recorded aggregates at 1,000, set truncation metadata, and preserve deterministic totals. Verify scanner coverage, repeated-run, and truncation tests pass. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE/REFACTOR — verify fail-closed domain behavior.** Exercise synthetic mixed findings, empty coverage, operational adapter failures, and the rule that truncation cannot become a clean or non-blocking-complete result; compare aggregate totals across repeated runs and confirm no record identifiers, amounts, payloads, or cursors escape the result model. <!-- sdd-owner: implementation -->

### PR 3 — Exact receipt statuses, protected output, CLI, and documentation

- [x] **RED — establish output and failure evidence.** Add failing tests at `apps/api/src/reconciliation/historical-finance-inventory/{receipt,cli}.spec.ts` for aggregate-only stdout, redaction, atomic `0600` receipt creation, receipt-write/protection failure, and exact statuses `COMPLETE_CLEAN`, `COMPLETE_WITH_FINDINGS`, `COMPLETE_WITH_BLOCKING_FINDINGS`, and `INCOMPLETE_OPERATIONAL_ERROR`. <!-- sdd-owner: implementation -->
- [x] **GREEN — implement versioned protected receipts.** Create `receipt.ts` and `result.ts` to serialize the required schema, coverage/classification/category totals, pagination and finding-cap metadata, redaction metadata, and non-sensitive operational error codes; map blocking findings or truncation only to `COMPLETE_WITH_BLOCKING_FINDINGS`, and operational failures only to `INCOMPLETE_OPERATIONAL_ERROR`. Verify receipt mode, schema, status, and failure tests pass. <!-- sdd-owner: implementation -->
- [x] **GREEN — implement the opt-in CLI boundary.** Create `cli.ts` and the approved API script entrypoint with receipt destination and bounded-scan options only, one aggregate-only structured summary, and non-success process outcomes for `COMPLETE_WITH_BLOCKING_FINDINGS` and `INCOMPLETE_OPERATIONAL_ERROR`; do not add repair or record-detail flags. Verify CLI redaction and exit-status tests pass. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE/REFACTOR — document and isolate delivery.** Add `apps/api/src/reconciliation/historical-finance-inventory/README.md` describing invocation, exact statuses, receipt protection, aggregate-only output, optional side-by-side storage composition, and the non-remediation boundary; run the complete focused inventory Jest slice, lint/type checks applicable to touched API files, and `git diff --check`. Rollback removes only the standalone scanner, script, tests, and README. <!-- sdd-owner: implementation -->

## Completion Evidence

- [x] Record RED → GREEN → TRIANGULATE/REFACTOR evidence for each PR in its review notes, including the exact focused test command and observed result. <!-- sdd-owner: implementation -->
- [x] Confirm the final diff contains no schema, migration, index, frontend, accounting, repair, backfill, or existing storage-inventory changes. <!-- sdd-owner: implementation -->
- [x] Confirm receipts and stdout contain no tenant IDs, financial-record IDs, identifiable amounts, raw payloads, cursors, or stack traces, and that receipt mode is `0600`. <!-- sdd-owner: implementation -->

# Design: Historical Finance Inventory

## Scope and boundary

Implement an isolated, read-only scanner under `apps/api/src/reconciliation/historical-finance-inventory/`; it neither calls nor changes the storage inventory. It reads synthetic/production finance history through a capability-limited adapter, aggregates results, and only writes a local protected receipt. It does not repair, backfill, mutate, migrate, alter accounting semantics, or expose record-level data.

## Components and data flow

1. **Read-only adapter** exposes per-covered-entity `listPage({ cursor, limit })` methods and relationship lookup data needed for validation, but no mutation methods. Its implementation uses read queries only; a mutation-aware test double proves this boundary.
2. **Paginator** requests `limit: 100`, orders each entity by a documented immutable stable key (for example, creation sequence then ID), advances only from the returned cursor, rejects malformed/non-advancing pagination, and records page/entity counts without recording cursor values.
3. **Classifier** evaluates liquidations/charges, payments/payment allocations, expenses/adjustments, incomes/income applications, movement allocations, liquidation-income offsets, currencies, and both-side tenant ownership. It emits a redacted category token and exactly one classification per evaluated condition.
4. **Aggregator** maintains coverage counts, classification totals, aggregate category counts, pagination metadata, and a maximum of 1,000 recorded finding aggregates. On the 1,001st finding it marks `findingsTruncated: true`, continues only as necessary to preserve bounded scan metadata, and never reports a clean/complete result.
5. **Receipt writer** serializes the aggregate result using a versioned `historical-finance-inventory` schema, creates the file with `0600` atomically, and treats write/protection failure as operational failure.
6. **CLI** invokes the scanner, prints one aggregate-only structured summary, and returns a non-success process outcome for blocking, truncation, or operational failure. It accepts a receipt destination and bounded scan options only; it does not accept repair actions or record-detail output switches.

## Contracts

### Adapter and pagination

- All page requests use a maximum limit of 100 and deterministic ordering for every covered entity type.
- Page results contain records needed to validate references plus an opaque next-page cursor; cursors remain internal and are excluded from stdout and receipts.
- The scanner rejects an invalid page shape, duplicate/non-advancing cursor, or adapter read error as an operational failure.
- Relationship checks require counterpart existence, compatible tenant ownership, and required currency compatibility; no value is converted or rewritten.

### Classification precedence

Apply this order deterministically:

1. `INVALID_BLOCKING`: invariant violation; missing required relationship; cross-tenant relationship; missing, incompatible, or unsupported required currency.
2. `REPAIRABLE`: otherwise describable incomplete/inconsistent history, including unrecognized historical version or income variant without a blocking violation.
3. `LEGACY_SUPPORTED`: structurally complete, internally consistent supported V1, V2, or V3 liquidation/publication representation, or recognized valid legacy income variant/application/offset.
4. `SAFE`: complete supported current representation.

A condition receives one classification only; a legacy shape never downgrades a higher-precedence blocking condition.

### Result, receipt, and stdout

Receipt and result statuses use these exact names: `COMPLETE_CLEAN`, `COMPLETE_WITH_FINDINGS`, `COMPLETE_WITH_BLOCKING_FINDINGS`, and `INCOMPLETE_OPERATIONAL_ERROR`.

- `COMPLETE_CLEAN` is used only for an untruncated, operationally successful scan with no findings.
- `COMPLETE_WITH_FINDINGS` is used for an untruncated, operationally successful scan containing only `LEGACY_SUPPORTED` and/or `REPAIRABLE` findings.
- `COMPLETE_WITH_BLOCKING_FINDINGS` is used for an operationally successful scan with one or more `INVALID_BLOCKING` findings or a truncated finding set; truncation is safety-blocking because the result cannot be considered complete. The receipt separately records `findingsTruncated: true` and the `INVALID_BLOCKING` total remains factual rather than synthesized.
- `INCOMPLETE_OPERATIONAL_ERROR` is used for adapter, pagination-validation, or receipt-write/protection failure and emits only a non-sensitive error code.

The versioned receipt includes status, start/completion metadata, entity coverage, classification totals, page/count and finding-cap metadata, aggregate finding-category counts, and redaction metadata. Stdout is a subset: status, schema version, aggregate totals, bounded metadata, and non-sensitive error code. Neither output may include tenant IDs, record IDs, amounts tied to identifiable records, raw payloads, cursors, exception stacks, or record-level findings.

## Planned file changes

- `apps/api/src/reconciliation/historical-finance-inventory/`: adapter interface/implementation, paginator, classifier rules, scanner/aggregate DTOs, receipt writer, and CLI entry point.
- Adjacent API tests: adapter read-only boundary, pagination, coverage/classification fixtures, redaction, receipt permissions, and failure handling.
- Operational documentation adjacent to the invocation: aggregate-only behavior, receipt location/protection, statuses, and the explicit non-remediation boundary.

No existing storage-inventory, schema, migration, frontend, or accounting files change. Optional external composition may place finance and storage aggregate results side-by-side while retaining separate statuses, counts, and categories.

## Tests

Use synthetic fixtures only. Verify: 201 records produce stable pages of at most 100 and identical totals across runs; every covered entity/relationship contributes coverage; supported V1/V2/V3 and recognized income variants are `LEGACY_SUPPORTED`; current valid records are `SAFE`; unrecognized but non-blocking variants are `REPAIRABLE`; missing counterpart, tenant crossing, and currency violation cases are `INVALID_BLOCKING`; a legacy record with a blocking defect remains `INVALID_BLOCKING`; the 1,000-finding cap sets truncation and does not yield `COMPLETED`; stdout and receipts redact prohibited values; receipt mode is `0600`; adapter/pagination/receipt failures yield `FAILED_OPERATIONALLY` with no mutation attempt. Test independent execution and side-by-side composition without a storage result.

## Rollout

Ship as an opt-in local operational CLI with a documented receipt destination. Operators review aggregate receipts only; no finding authorizes remediation. Rollback removes/disables this standalone scanner and documentation, with no data reversal required.

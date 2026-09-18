# Proposal: Phase 3G.1 Historical Finance Inventory

## Intent

Establish a deterministic, read-only historical-finance inventory that identifies the condition of legacy financial data before any future remediation work. The inventory provides operators with aggregate evidence suitable for planning later phases without exposing tenant or financial-record details in console output.

## Scope

Create a separate scanner under `apps/api/src/reconciliation/historical-finance-inventory/`. It will use a read-only data-access adapter and deterministic, bounded cursor pagination to inspect historical finance relationships while preserving tenant isolation.

The scanner will evaluate the consistency and referential completeness of:

- liquidations and their charges;
- payments and payment allocations;
- expenses and adjustments;
- incomes and income applications;
- movement allocations and liquidation-income offsets; and
- currencies and tenant ownership across every inspected relationship.

Each scanned condition will be classified as one of:

- **SAFE** — supported, internally consistent data requiring no follow-up.
- **LEGACY_SUPPORTED** — a recognized historical representation that remains supported and is not an inventory blocker.
- **REPAIRABLE** — an inconsistency that can be described for a future, explicitly authorized repair phase.
- **INVALID_BLOCKING** — an invariant, tenancy, currency, relationship, or accounting-data violation that prevents safe progression until resolved.

The command output must be aggregate-only: counts, classification totals, bounded scan metadata, and exit/status information. It must not print tenant identifiers, financial record identifiers, amounts tied to an identifiable record, or raw payloads. The scanner must write a receipt with filesystem mode `0600` containing the reproducible aggregate inventory result and scan metadata.

## Affected Areas

- `apps/api/src/reconciliation/historical-finance-inventory/`: isolated scanner, read-only adapter, classification logic, pagination, aggregate reporting, and receipt generation.
- API test coverage adjacent to the new scanner: deterministic pagination and synthetic fixtures covering each classification, including `INVALID_BLOCKING` conditions.
- Operational invocation/documentation needed to explain the scanner’s aggregate-only output and protected receipt.

The existing storage inventory remains separate and unchanged.

## Non-Goals

Phase 3G.1 does **not**:

- replace, merge with, or alter the existing storage inventory;
- repair, backfill, mutate, delete, or normalize any historical data;
- add schemas, migrations, indexes, or database changes;
- change current accounting behavior, finance semantics, or operational workflows;
- add frontend screens, APIs for end users, or user-facing remediation flows;
- expose record-level findings through stdout; or
- authorize automatic or manual remediation.

## Risks and Mitigations

- **Large historical datasets may create excessive runtime or memory use.** Deterministic bounded cursor pagination limits each read and allows an interrupted run to be reasoned about from receipt metadata.
- **A read path could accidentally gain write capability.** The scanner is isolated behind a read-only adapter and has no repair or persistence path beyond its local receipt.
- **Cross-tenant relationships could be misclassified or disclosed.** Every relationship check validates tenant ownership; stdout remains aggregate-only and the receipt is owner-readable only (`0600`).
- **Legacy representations could be incorrectly treated as corruption.** `LEGACY_SUPPORTED` explicitly separates recognized supported history from repairable and blocking conditions, with synthetic coverage for the classification boundary.
- **Future repair work could be inferred as authorized.** Findings are inventory evidence only; remediation remains outside this phase and requires a separately approved proposal.

## Rollback

Rollback is removal or disabling of the new standalone scanner and its invocation/documentation. Because Phase 3G.1 performs no writes, schema changes, accounting changes, or data migration, rollback requires no data reversal. Existing storage inventory behavior is unaffected.

## Acceptance Criteria

1. A new standalone historical-finance scanner exists only under `apps/api/src/reconciliation/historical-finance-inventory/` and does not replace or modify the storage inventory.
2. All data access is read-only, with no repair, backfill, schema, migration, or accounting mutation path.
3. Scanning uses deterministic, bounded cursor pagination with stable ordering and reports bounded scan metadata in its receipt.
4. Inventory coverage includes liquidations, charges, payments, payment allocations, expenses, adjustments, incomes, income applications, movement allocations, liquidation-income offsets, currencies, and tenant-isolation relationships.
5. Every evaluated finding is classified as `SAFE`, `LEGACY_SUPPORTED`, `REPAIRABLE`, or `INVALID_BLOCKING`, with documented, testable classification rules.
6. Tenant isolation and currency/relationship invariants are checked without emitting record-level information to stdout.
7. Stdout contains aggregate-only results; the generated inventory receipt is created with mode `0600`.
8. Tests use synthetic data and cover deterministic pagination plus at least one `INVALID_BLOCKING` case for relevant invariant categories; tests do not mutate historical production-like records.
9. No frontend, current-accounting, repair, backfill, schema, migration, or storage-inventory changes are introduced.

## Success Criteria

Operators can run a bounded historical-finance inventory and receive reproducible aggregate classification totals plus a protected receipt, enabling them to estimate future remediation scope without changing financial data or disclosing tenant-level findings in console output.

## Later Phase 3G Boundaries

Later Phase 3G work may define review workflows, record-level access controls, remediation plans, approvals, repair/backfill execution, reconciliation of confirmed anomalies, and any required schema or accounting changes. Those phases must consume Phase 3G.1 evidence but remain separately proposed, authorized, tested, and rolled out. Phase 3G.1 neither selects repairs nor establishes permission to perform them.

# Historical Finance Inventory Specification

## Purpose

Provide a deterministic, bounded, read-only inventory of historical finance integrity so operators can plan separately authorized remediation without changing accounting data or disclosing record-level information.

## Requirements

### Requirement: Read-only inventory boundary

The historical-finance inventory SHALL access finance data only through a read-only adapter. The scanner and adapter MUST NOT create, update, delete, upsert, repair, backfill, normalize, or otherwise persist finance data. The adapter contract MUST NOT expose a mutation operation to the scanner, and an attempted mutation through the inventory boundary MUST be rejected before any data change.

#### Scenario: Inventory runs against a mutation-aware test double

- GIVEN a test double that records every data-access operation and can fail a mutation attempt
- WHEN the inventory completes a scan
- THEN it SHALL invoke only read operations
- AND no mutation operation SHALL be attempted

#### Scenario: A mutation is attempted through the inventory boundary

- GIVEN an attempted create, update, delete, upsert, repair, or backfill operation through the inventory boundary
- WHEN the operation is requested
- THEN it MUST be rejected
- AND no financial record SHALL change

### Requirement: Deterministic bounded pagination

The inventory MUST read every covered entity type through a stable, deterministic ordering and cursor pagination. Each page MUST contain at most 100 records. The inventory MUST bound recorded findings to 1,000 and MUST report whether that bound was reached; a result that reaches the finding bound MUST NOT be represented as a complete clean inventory.

#### Scenario: More than one page is available

- GIVEN 201 covered records with equal scan inputs
- WHEN the inventory is run twice
- THEN each run SHALL request pages of no more than 100 records in the same stable order
- AND the aggregate result and scan counts SHALL be identical

#### Scenario: The finding bound is reached

- GIVEN more than 1,000 findings are encountered during a scan
- WHEN the inventory completes its bounded evaluation
- THEN it SHALL record no more than 1,000 findings
- AND its metadata and status SHALL indicate that findings were truncated
- AND it SHALL not report the inventory as clean or complete

### Requirement: Financial entity and relationship coverage

The inventory MUST evaluate historical consistency and referential completeness for liquidations and charges; payments and payment allocations; expenses and adjustments; incomes and income applications; movement allocations; liquidation-income offsets; currencies; and tenant ownership. Every inspected relationship MUST be checked for the existence and compatibility of its required counterpart, tenant ownership, and currency where applicable.

#### Scenario: All covered relationships are complete

- GIVEN synthetic records for every covered entity and relationship with valid references, common tenant ownership, and compatible currencies
- WHEN the inventory scans them
- THEN it SHALL include each entity and relationship category in coverage counts
- AND it SHALL produce only non-blocking classifications for those records

#### Scenario: A required counterpart is missing

- GIVEN a covered record whose required charge, allocation, adjustment, application, movement allocation, or liquidation-income offset counterpart is absent
- WHEN the inventory evaluates the relationship
- THEN it SHALL emit a finding for the affected relationship category
- AND the finding SHALL be classified according to the classification rules

### Requirement: Tenant and currency isolation

The inventory MUST validate tenant ownership for both ends of every inspected relationship. A relationship crossing tenant ownership boundaries MUST be classified as `INVALID_BLOCKING`. A required currency mismatch, missing required currency, or unsupported currency relationship MUST be classified as `INVALID_BLOCKING`; currency validation MUST NOT derive or rewrite financial values.

#### Scenario: A relationship crosses tenants

- GIVEN a payment allocation, income application, movement allocation, or liquidation relation whose counterpart belongs to another tenant
- WHEN the inventory evaluates the relationship
- THEN it SHALL classify the finding as `INVALID_BLOCKING`
- AND it SHALL not disclose either tenant or record identifier in stdout

#### Scenario: A required currency relationship is invalid

- GIVEN covered related records with incompatible, absent, or unsupported required currency information
- WHEN the inventory evaluates the relationship
- THEN it SHALL classify the finding as `INVALID_BLOCKING`
- AND it SHALL not convert, correct, or persist a currency value

### Requirement: Deterministic finding classifications

Every evaluated condition MUST receive exactly one of `SAFE`, `LEGACY_SUPPORTED`, `REPAIRABLE`, or `INVALID_BLOCKING`. Classification precedence MUST be deterministic: an invariant, tenant-isolation, currency, or required-relationship violation is `INVALID_BLOCKING`; otherwise a describable incomplete or inconsistent historical condition is `REPAIRABLE`; otherwise a recognized supported historical representation is `LEGACY_SUPPORTED`; otherwise a complete supported current representation is `SAFE`.

#### Scenario: A current consistent representation is scanned

- GIVEN a complete current representation with valid required relationships, tenant ownership, and currencies
- WHEN the inventory evaluates it
- THEN it SHALL classify the condition as `SAFE`

#### Scenario: A condition has both legacy shape and a blocking violation

- GIVEN a recognized legacy representation that also has a cross-tenant, currency, invariant, or required-relationship violation
- WHEN the inventory evaluates it
- THEN it SHALL classify the condition as `INVALID_BLOCKING`
- AND it SHALL not downgrade the violation to `LEGACY_SUPPORTED`

### Requirement: Supported historical versions and income variants

A structurally complete and internally consistent retained historical liquidation or publication representation in supported V1, V2, or V3 form MUST be classified as `LEGACY_SUPPORTED`, provided it has no higher-precedence violation. Recognized legacy income variants and their valid applications or liquidation-income offsets MUST likewise be classified as `LEGACY_SUPPORTED`. An unrecognized version or income variant, or a recognized variant missing evidence needed to establish its required relationships, MUST be `REPAIRABLE` unless it violates a blocking invariant.

#### Scenario: A supported V1, V2, or V3 representation is complete

- GIVEN synthetic historical records in each of V1, V2, and V3 forms with valid required relationships, tenant ownership, and currencies
- WHEN the inventory evaluates the records
- THEN each representation SHALL be counted as `LEGACY_SUPPORTED`
- AND none SHALL be reported as `INVALID_BLOCKING`

#### Scenario: A recognized legacy income variant is complete

- GIVEN a recognized legacy income representation with a valid application or liquidation-income offset and valid tenant and currency relationships
- WHEN the inventory evaluates it
- THEN it SHALL be classified as `LEGACY_SUPPORTED`

#### Scenario: An unsupported historical variant lacks no blocking relation

- GIVEN an unrecognized V1/V2/V3-adjacent version or income variant with no tenant, currency, invariant, or mandatory-reference violation
- WHEN the inventory evaluates it
- THEN it SHALL be classified as `REPAIRABLE`

### Requirement: Aggregate-only stdout

The inventory MUST emit aggregate-only stdout. Stdout MAY include status, schema version, entity and classification totals, page and bounded-scan metadata, and non-sensitive operational error codes. Stdout MUST NOT include tenant identifiers, financial-record identifiers, identifiable record-level amounts, raw payloads, cursor values, or exception stack traces.

#### Scenario: Findings exist during a scan

- GIVEN findings associated with identifiable tenants and financial records
- WHEN the inventory writes stdout
- THEN stdout SHALL contain only aggregate categories, totals, bounded-scan metadata, and status
- AND it SHALL contain no tenant ID, record ID, raw payload, cursor, identifiable amount, or stack trace

### Requirement: Protected aggregate receipt

Each inventory invocation that can write its receipt MUST produce a receipt with file mode `0600`. The receipt SHALL use a versioned historical-finance-inventory schema and include: overall status; scan start and completion metadata; per-entity coverage counts; per-classification totals; finding-cap and pagination metadata; aggregate finding categories and counts; and redaction metadata. Receipt findings MUST be aggregate and redacted: they MUST NOT contain tenant identifiers, financial-record identifiers, cursor values, identifiable amounts, raw payloads, or exception stacks.

The receipt status MUST be `COMPLETE_CLEAN` when the bounded scan completes without findings or operational failure, `COMPLETE_WITH_FINDINGS` when it completes with only `LEGACY_SUPPORTED` and/or `REPAIRABLE` findings, `COMPLETE_WITH_BLOCKING_FINDINGS` when it completes with one or more `INVALID_BLOCKING` findings or finding-bound truncation, and `INCOMPLETE_OPERATIONAL_ERROR` when an operational error prevents completion. A finding-bound truncation MUST be represented in receipt metadata and MUST NOT use `COMPLETE_CLEAN` or `COMPLETE_WITH_FINDINGS`.

#### Scenario: A completed scan writes a receipt

- GIVEN a completed scan with aggregate findings
- WHEN the receipt is written
- THEN its file mode SHALL be `0600`
- AND it SHALL contain the required versioned schema, status, counts, metadata, and redacted aggregate finding categories
- AND it SHALL contain no record-level or tenant-level sensitive values

#### Scenario: Blocking findings are detected

- GIVEN a completed scan with at least one `INVALID_BLOCKING` finding
- WHEN the receipt is written
- THEN its status SHALL be `COMPLETED_WITH_BLOCKING_FINDINGS`
- AND its classification totals SHALL include the blocking finding count

### Requirement: Operational failure handling

An adapter read failure, invalid pagination response, receipt-write failure, or other operational failure MUST be distinguished from a finance-data finding. The inventory MUST fail closed: it MUST NOT claim a complete or clean result after an operational failure, MUST return a non-success operational outcome, and MUST emit only a non-sensitive aggregate error code and status. It MUST preserve the read-only boundary when handling any failure.

#### Scenario: A page read fails

- GIVEN an adapter read failure after one or more pages
- WHEN the inventory handles the failure
- THEN it SHALL report `FAILED_OPERATIONALLY`
- AND it SHALL not claim a complete or clean result
- AND it SHALL not disclose the underlying records or stack trace
- AND it SHALL not attempt a data mutation

#### Scenario: Receipt writing fails

- GIVEN a completed evaluation whose receipt cannot be written with the required protection
- WHEN the inventory handles the receipt failure
- THEN it SHALL return a non-success operational outcome
- AND it SHALL not report successful receipt creation

### Requirement: Separate optional storage inventory composition

The historical-finance inventory MUST remain independent from the existing storage inventory. An invocation MAY compose separately produced storage-inventory aggregate results with the finance inventory only when each source retains its own status, counts, and finding categories. Storage inventory absence or failure MUST NOT alter finance classifications or coverage, and Phase 3G.1 MUST NOT modify storage-inventory behavior.

#### Scenario: No storage inventory result is supplied

- GIVEN a finance inventory invocation without a storage inventory result
- WHEN the finance scan completes
- THEN it SHALL produce its finance result independently
- AND its coverage and classifications SHALL be unchanged by storage inventory absence

#### Scenario: Separate aggregate results are composed

- GIVEN completed finance and storage inventory aggregate results
- WHEN an operational report composes them
- THEN it SHALL preserve distinct source statuses, counts, and finding categories
- AND it SHALL not merge record-level findings or change either inventory's classifications

### Requirement: Phase boundary preservation

Phase 3G.1 MUST NOT introduce schema changes, migrations, indexes, frontend behavior, current accounting behavior, financial semantics, repair flows, backfills, or changes to the existing storage inventory. Findings are inventory evidence only and MUST NOT authorize remediation.

#### Scenario: The phase is evaluated for side effects

- GIVEN the Phase 3G.1 deliverable and its execution path
- WHEN it is reviewed
- THEN no schema, migration, index, accounting, repair, backfill, frontend, or storage-inventory change SHALL be required or performed
- AND findings SHALL not trigger automatic or manual remediation

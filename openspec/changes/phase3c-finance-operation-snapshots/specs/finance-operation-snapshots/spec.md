# Finance Operation Snapshots Specification

## Purpose

Ensure that every newly effective multicurrency Expense, Income, and Adjustment retains complete, reproducible canonical FX evidence without partial state, duplicated transitions, or alteration of historical evidence.

## Requirements

### Requirement: Atomic complete snapshot on Expense effective transition

The system MUST allow an Expense to enter its effective state only when the same atomic transition persists a complete canonical FX snapshot. The snapshot MUST include the functional amount and currency, applied rate value and direction, source rate identifier and effective date, and UTC date-only conversion date. The conversion date MUST be derived from the Expense `invoiceDate` after UTC date-only normalization.

#### Scenario: Expense becomes effective with canonical evidence

- GIVEN an Expense that is not effective and an applicable exchange rate exists for its UTC-normalized `invoiceDate`
- WHEN the Expense enters its effective state
- THEN the Expense is effective and persists every required canonical FX snapshot field in the same completed transition
- AND its `conversionDate` equals the UTC date-only value of `invoiceDate`

#### Scenario: Expense snapshot persistence fails

- GIVEN an Expense that is not effective and an applicable exchange rate exists
- WHEN persistence of any required FX snapshot evidence fails during the effective transition
- THEN the Expense does not become effective
- AND no partial FX snapshot evidence is persisted

### Requirement: Atomic complete snapshot on Income effective transition

The system MUST allow an Income to enter its effective state only when the same atomic transition persists a complete canonical FX snapshot. The snapshot MUST include the functional amount and currency, applied rate value and direction, source rate identifier and effective date, and UTC date-only conversion date. The conversion date MUST be derived from the Income `receivedDate` after UTC date-only normalization.

#### Scenario: Income becomes effective with canonical evidence

- GIVEN an Income that is not effective and an applicable exchange rate exists for its UTC-normalized `receivedDate`
- WHEN the Income enters its effective state
- THEN the Income is effective and persists every required canonical FX snapshot field in the same completed transition
- AND its `conversionDate` equals the UTC date-only value of `receivedDate`

#### Scenario: Income snapshot persistence fails

- GIVEN an Income that is not effective and an applicable exchange rate exists
- WHEN persistence of any required FX snapshot evidence fails during the effective transition
- THEN the Income does not become effective
- AND no partial FX snapshot evidence is persisted

### Requirement: Atomic complete snapshot on Adjustment validation

The system MUST allow an Adjustment to enter `VALIDATED` only when the same atomic transition persists a complete canonical FX snapshot. The snapshot MUST include the functional amount and currency, applied rate value and direction, source rate identifier and effective date, and UTC date-only conversion date. The conversion date MUST be derived from the Adjustment `sourceInvoiceDate` after UTC date-only normalization.

#### Scenario: Adjustment is validated with canonical evidence

- GIVEN an Adjustment that is not `VALIDATED` and an applicable exchange rate exists for its UTC-normalized `sourceInvoiceDate`
- WHEN the Adjustment is validated
- THEN the Adjustment is `VALIDATED` and persists every required canonical FX snapshot field in the same completed transition
- AND its `conversionDate` equals the UTC date-only value of `sourceInvoiceDate`

#### Scenario: Adjustment snapshot persistence fails

- GIVEN an Adjustment that is not `VALIDATED` and an applicable exchange rate exists
- WHEN persistence of any required FX snapshot evidence fails during validation
- THEN the Adjustment does not become `VALIDATED`
- AND no partial FX snapshot evidence is persisted

### Requirement: Missing applicable rate rolls back the transition

The system MUST reject an effective transition for an Expense, Income, or Adjustment when no applicable exchange rate exists for its required UTC-normalized business date. The rejection MUST use `EXCHANGE_RATE_NOT_FOUND` and MUST atomically leave the operation outside its effective state with no newly persisted partial FX snapshot evidence.

#### Scenario: Expense rate is unavailable

- GIVEN an Expense that is not effective and no applicable rate exists for its UTC-normalized `invoiceDate`
- WHEN the Expense is transitioned to its effective state
- THEN the transition fails with `EXCHANGE_RATE_NOT_FOUND`
- AND the Expense remains non-effective without partial FX snapshot evidence

#### Scenario: Income rate is unavailable

- GIVEN an Income that is not effective and no applicable rate exists for its UTC-normalized `receivedDate`
- WHEN the Income is transitioned to its effective state
- THEN the transition fails with `EXCHANGE_RATE_NOT_FOUND`
- AND the Income remains non-effective without partial FX snapshot evidence

#### Scenario: Adjustment rate is unavailable

- GIVEN an Adjustment that is not `VALIDATED` and no applicable rate exists for its UTC-normalized `sourceInvoiceDate`
- WHEN the Adjustment is validated
- THEN the transition fails with `EXCHANGE_RATE_NOT_FOUND`
- AND the Adjustment remains non-validated without partial FX snapshot evidence

### Requirement: Idempotent effective transitions preserve canonical evidence

The system MUST NOT create duplicate effects, recalculate, replace, delete, or otherwise mutate an existing canonical FX snapshot when a request retries or races to transition an already-effective Expense, Income, or Adjustment. Existing historical snapshots MUST remain immutable evidence.

#### Scenario: Retry targets an already-effective operation

- GIVEN an Expense, Income, or Adjustment is already effective with a complete canonical FX snapshot
- WHEN its effective transition is retried
- THEN no additional effective-transition effect is created
- AND the persisted snapshot remains identical to its pre-retry evidence

#### Scenario: Concurrent requests target an already-effective operation

- GIVEN an Expense, Income, or Adjustment is already effective with a complete canonical FX snapshot
- WHEN concurrent requests attempt its effective transition
- THEN no request replaces or duplicates the snapshot evidence
- AND the operation retains exactly its pre-existing effective state and snapshot

### Requirement: Adjustment validation serializes entity lifecycle transitions with canonical FX locking

The system MUST serialize concurrent validation attempts for the same Adjustment so that at most one effective validation transition can complete. Adjustment validation MUST remain compatible with, and MUST NOT bypass or replace, the canonical FX conversion pair and rate-row locking guarantees.

#### Scenario: Concurrent validation requests target one Adjustment

- GIVEN an Adjustment is not `VALIDATED` and concurrent validation requests target that same Adjustment
- WHEN the requests execute while selecting the applicable exchange rate
- THEN at most one validation transition completes
- AND the Adjustment has one complete canonical FX snapshot with no duplicated effect
- AND rate selection remains protected by the canonical FX conversion locking guarantees

### Requirement: Legacy null snapshots remain unresolved historical state

The system MUST treat pre-existing effective Expense, Income, and Adjustment records whose canonical FX snapshot fields are null as unresolved historical state. The system MUST NOT automatically backfill FX evidence, fabricate a rate including a rate of `1`, infer a snapshot, or mutate those records solely to resolve missing historical evidence.

#### Scenario: A legacy effective record has null snapshot fields

- GIVEN an effective historical Expense, Income, or Adjustment has null canonical FX snapshot fields
- WHEN the record is read or processed without an explicitly authorized historical remediation
- THEN its null snapshot fields remain unchanged
- AND no inferred or synthetic FX rate or snapshot is persisted

### Requirement: Preserved finance boundaries and explicit non-goals

The system MUST preserve the canonical PHASE 3B conversion engine, snapshot contract, and FX lock scheme. The system MUST NOT change the authority of `Income.period`, alter `Adjustment.sourcePeriod` semantics, add an Adjustment update or void lifecycle, or require API DTO or frontend changes unless a demonstrated snapshot API-contract gap requires them.

#### Scenario: Snapshot transition uses existing financial boundaries

- GIVEN an Expense, Income, or Adjustment effective transition is performed
- WHEN its canonical FX snapshot is created or its existing snapshot is preserved
- THEN `Income.period` retains its existing authority
- AND `Adjustment.sourcePeriod` retains its existing financial semantics independent of `sourceInvoiceDate`-derived `conversionDate`
- AND no Adjustment update or void lifecycle is made available by this behavior

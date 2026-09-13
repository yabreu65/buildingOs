# Phase 3D.1 Specification — Canonical Liquidation Distribution

## Scope

This change covers canonical valuation inputs, deterministic per-unit distribution, and frozen draft distribution snapshots only. Publication integrity/chargePeriod/SQL immutability and lifecycle concurrency remain Phase 3D.2/3D.3 work.

## Requirements

### Requirement: Canonical Decimal distribution

The system MUST distribute already-valued liquidation movement amounts using `Prisma.Decimal`, integer minor units, `ROUND_HALF_EVEN`, and deterministic residual reconciliation. The final allocation sum MUST equal the liquidation net distributable total.

#### Scenario: Building movement uses canonical building weights

- GIVEN a BUILDING expense or adjustment and billable units in the same tenant/building
- WHEN the draft distribution is calculated
- THEN the canonical building weight resolver is used
- AND coefficient/m2 inputs are normalized before Decimal arithmetic
- AND the movement allocation reconciles exactly to its movement amount

#### Scenario: Residual ties use unitId

- GIVEN equal residuals after half-even rounding
- WHEN residual minor units are reconciled
- THEN the stable `unitId` ordering determines the winner
- AND input query order does not change the result

### Requirement: Approved UNIT_GROUP recipient set

For `scopeType = UNIT_GROUP`, the system MUST require `unitGroupId` and use only members belonging to that group and the same tenant/building. Non-billable members MUST be excluded. The group-only denominator MUST be used with the canonical building weight resolver; custom group weights MUST NOT be introduced.

#### Scenario: Group expense excludes outside units

- GIVEN a validated UNIT_GROUP expense with same-tenant/building members
- WHEN a draft is created
- THEN only billable group members receive that movement's allocation
- AND billable units outside the group receive zero for that movement

#### Scenario: Invalid group fails closed

- GIVEN a missing group, tenant/building mismatch, invalid member scope, empty group, or all-non-billable group
- WHEN a draft is created
- THEN the operation fails explicitly
- AND no liquidation draft is persisted

### Requirement: Frozen draft snapshot

A new draft MUST persist a versioned distribution snapshot atomically with the draft. The snapshot MUST contain the recipient set, normalized coefficient/m2/weight evidence, movement allocations, final per-unit allocations, tenant/building identity, total, and snapshot version.

#### Scenario: Post-draft changes do not alter publication

- GIVEN a draft with a valid distribution snapshot
- WHEN group membership, billability, coefficient, or m2 changes before publication
- THEN publication consumes the frozen snapshot
- AND published charges equal the draft preview
- AND publication does not recompute allocation outcomes from live weights

#### Scenario: Snapshot corruption fails closed

- GIVEN a missing-version, duplicate-unit, duplicate-movement, malformed, cross-scope, or non-reconciling snapshot
- WHEN publication validates the draft
- THEN publication fails with an explicit distribution snapshot error
- AND no partial charge publication is committed

### Requirement: Preserve existing valuation boundaries

The distribution engine MUST receive already-determined valuation amounts and MUST NOT select exchange rates, recalculate FX, or change DIRECT/INVERSE/IDENTITY, tenant scope, historical evidence, or income-offset accounting. Income offsets remain liquidation-level reductions; no new unit-level income ledger is introduced.

#### Scenario: Functional valuation remains authoritative

- GIVEN a liquidation whose sources have complete functional snapshots
- WHEN Phase 3D.1 distributes its net amount
- THEN the persisted functional valuation remains the source of the distributed total
- AND no live FX lookup occurs in the distribution engine.

## Non-goals

- Publication integrity, chargePeriod integration, SQL immutability, historical classification, lifecycle locking, concurrency hardening, real publication E2E, and final hardening.
- Historical mutation, backfill, repair, staging, production, commit, push, or deployment.

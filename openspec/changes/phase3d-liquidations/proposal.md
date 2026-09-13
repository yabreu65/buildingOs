# Proposal: Phase 3D.1 — frozen Decimal liquidation distribution

## Intent

Make liquidation draft preview and publication reproduce the same per-unit allocation exactly. Phase 3D.1 introduces one canonical `Prisma.Decimal` distribution engine, freezes its versioned result on the draft, and makes publish consume that frozen result rather than recalculating against live coefficients or square metres.

**Authorized slice:** Phase 3D.1 only. This proposal deliberately excludes Phase 3D.2 and Phase 3D.3.

## Problem

The current liquidation paths have independently shaped distribution logic and read live unit inputs at different lifecycle points. The existing draft path uses `number`/`Float` arithmetic and coefficient-based logic, while publication has its own allocation path that reads current billable units and `m2`. This permits rounding drift, unstable residual assignment, and a draft preview that differs from the published charges after source data changes.

A liquidation is a financial document: once a draft shows a distribution, publication must produce that exact distribution from frozen evidence. Phase 3B/3C already establish the applicable financial FX rule: functional valuation comes from persisted canonical operation snapshots; no live FX calculation is introduced here.

## Scope

### Included

- Create a single canonical liquidation distribution engine using `Prisma.Decimal`, shared by draft preview and the publication workflow.
- Convert every Float-backed allocation input at the engine boundary to `Prisma.Decimal` only after validating it is finite and within the approved representable domain; retain the resulting normalized decimal string as frozen evidence rather than reusing a JavaScript float.
- Allocate integer minor units with `ROUND_HALF_EVEN`, then reconcile any residual exactly so `sum(unit allocations) === liquidation totalAmountMinor`.
- Apply a deterministic residual ordering with `unitId` as the stable final tie-breaker, so equal inputs always produce the same allocation.
- During draft creation, persist a **versioned frozen distribution snapshot** containing the allocation result and the decimal-string inputs/evidence needed to explain it.
- During publication, parse and validate that draft snapshot and create charges from its frozen per-unit allocations; publication MUST NOT query or recompute live coefficients, `m2`, or distribution inputs for the allocation outcome.
- Preserve tenant/building scoping, existing finance membership/RBAC controls, and the established liquidation lifecycle.
- Preserve Phase 3B/3C FX semantics exactly: functional/legacy valuation selection and persisted operation FX snapshots remain the inputs to the liquidation total; this slice neither invokes live FX conversion nor changes snapshot selection, locks, dates, or historical FX evidence.
- Add focused Phase 3D.1 tests for canonical-engine parity between preview and publish, Float-boundary rejection/freeze behavior, exact total reconciliation, half-even rounding, `unitId` tie-breaking, snapshot version/validation, and proof that post-draft changes to live coefficients or `m2` cannot alter published charges.

### UNIT_GROUP decision (approved)

A `UNIT_GROUP` expense is charged only to the billable unit IDs that are members of its referenced group at draft creation. `BUILDING` expenses and adjustments retain the complete billable-building recipient population. The frozen distribution snapshot preserves each movement's recipient set and final reconciled allocations.

Draft creation must fail closed when the expense has no group, the group does not belong to the same tenant and building, any member resolves outside that tenant/building, the group is empty, or every member is non-billable. Income offsets remain a liquidation-level reduction and do not create a new unit-level income accounting model.

## Non-goals

- No historical liquidation, charge, draft, or snapshot mutation, repair, or backfill.
- No Phase 3D.2 work: no SQL-enforced immutability design and no `chargePeriod` work.
- No Phase 3D.3 work: no concurrency hardening, broad E2E hardening, or test expansion beyond focused Phase 3D.1 coverage.
- No change to Phase 3B/3C FX semantics, conversion engine, rate locks, or historical FX snapshots.
- No new financial allocation policy beyond the confirmed Decimal, rounding, residual, and snapshot rules.
- No staging or production interaction, migration execution against remote environments, merge, commit, push, deploy, or source-code modification as part of this proposal.

## Affected areas

| Area | Expected impact | Reason |
|---|---|---|
| `apps/api/src/finanzas/liquidation-distribution*` (new or existing focused module) | Add/modify | Own the canonical Decimal-only calculation, normalized input contract, residual reconciliation, and snapshot serialization/parsing. |
| `apps/api/src/finanzas/liquidations.service.ts` | Modify | Build draft preview through the canonical engine and persist the versioned frozen distribution snapshot. |
| `apps/api/src/finanzas/liquidation-publication.use-case.ts` | Modify | Consume validated frozen draft allocations when creating charges; remove allocation-outcome dependence on live unit inputs. |
| `apps/api/src/finanzas/liquidation-publication-snapshot.ts` | Modify only if it is the established snapshot boundary | Reuse or extend typed snapshot parsing/version validation without duplicating allocation math. |
| `apps/api/prisma/schema.prisma` and a Prisma migration | Expected | Add a nullable/versioned draft distribution snapshot persistence field for new 3D.1 drafts while keeping historical rows untouched. |
| Focused finance distribution/liquidation service tests | Add/modify | Demonstrate deterministic financial behavior and frozen preview-to-publish parity. |
| `apps/web/`, DTOs/controllers | No expected change | Existing draft/detail responses should be reused unless focused evidence proves a required contract exposure gap. |

## Approach

1. Define a typed versioned snapshot contract, for example `liquidation-distribution:v1`, that records each allocated `unitId`, immutable display identity needed by current responses, integer allocated minor amount, and normalized decimal-string weight evidence. The exact field names follow the established liquidation snapshot conventions.
2. Centralize the distribution algorithm in one pure engine. Its input boundary rejects absent, non-finite, negative, out-of-range, or otherwise invalid Float values before `new Prisma.Decimal(...)`; valid values are normalized to decimal strings and only Decimal values participate in calculations.
3. Calculate each exact share with Decimal arithmetic, round using `Prisma.Decimal.ROUND_HALF_EVEN`, calculate the integer difference from the liquidation total, and reconcile it deterministically by the defined residual rank with `unitId` as the final tie-breaker. Reject impossible allocations rather than allowing an inexact total.
4. Have draft creation query the authoritative eligible units once, invoke the engine, return its allocations for preview, and save the same versioned output in the draft transaction.
5. Have publication treat the saved distribution snapshot as authoritative allocation evidence: validate its version, tenant/building-compatible unit identities, unique units, non-negative integer amounts, and exact total before creating charges. Do not invoke the engine with current unit coefficients or `m2` during publication.
6. Maintain existing Phase 3B/3C valuation inputs before this distribution stage. The distribution engine receives the already-determined `totalAmountMinor` and has no FX responsibility.
7. Resolve each `UNIT_GROUP` expense to same-tenant/same-building billable members at draft creation, preserve that recipient population in the snapshot, and fail closed for missing, mismatched, empty, or all-nonbillable groups.

## Acceptance criteria

- [ ] Draft preview and publication use one canonical `Prisma.Decimal` distribution engine for Phase 3D.1 allocations.
- [ ] Every Float-derived engine input is checked for finiteness and allowed range before conversion and is persisted as a normalized frozen decimal string.
- [ ] The engine uses `ROUND_HALF_EVEN` and deterministic residual reconciliation, with `unitId` as the stable final tie-breaker.
- [ ] Every valid allocation result exactly reconciles: `sum(unit allocations) === liquidation.totalAmountMinor`.
- [ ] A new draft persists a versioned frozen distribution snapshot in the same lifecycle write as its draft evidence.
- [ ] Publication validates and consumes the frozen snapshot and produces charges equal to the draft preview even if live coefficients or `m2` change after draft creation.
- [ ] Publication does not recalculate allocation coefficients, square metres, or other distribution inputs from live state.
- [ ] Existing tenant/building scoping, finance authorization, Phase 3B/3C functional-versus-legacy valuation behavior, and frozen FX evidence are preserved.
- [ ] Invalid Float inputs, invalid/mismatched snapshot versions, malformed allocations, duplicate unit IDs, and non-reconciling totals fail clearly without creating partial charges.
- [ ] `UNIT_GROUP` expenses charge only their same-tenant/same-building billable draft-time members; missing, mismatched, empty, and all-nonbillable groups fail closed.
- [ ] Focused Phase 3D.1 tests cover the engine and draft-to-publish frozen snapshot contract without claiming Phase 3D.3 concurrency or E2E coverage.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Decimal conversion can preserve an unintended binary Float representation. | Validate at the boundary and freeze a deliberate normalized decimal string; no monetary calculation continues in `number`. |
| Rounding residuals create different charges across runs. | Use half-even rounding, explicit exact-total reconciliation, and stable `unitId` ordering. |
| Snapshot corruption or an old shape leads to unsafe charge creation. | Version and validate the snapshot fail-closed before publication. |
| Live unit data changes between draft and publish. | Publish consumes only the frozen draft distribution for charge amounts. |
| UNIT_GROUP memberships or billability change after draft. | Freeze the validated same-tenant/building recipient set and weights in the draft; publish never resolves live group membership. |
| Schema evolution affects legacy rows. | Use a nullable new field for legacy compatibility; no read-time mutation or backfill. |

## Rollback

Revert the Phase 3D.1 implementation and its migration through the repository's approved migration process only. Do not alter historical drafts, published liquidations, charges, or snapshots as rollback cleanup. A persisted frozen snapshot or published charge is financial evidence and must not be recomputed or deleted automatically. No staging/production rollback action belongs to this change.

## Success criteria

Phase 3D.1 succeeds when a reviewer can trace one Decimal allocation result from draft preview into a versioned frozen snapshot and then into publication-created charges with exact equality, deterministic rounding, no live coefficient or `m2` recalculation, and the approved `UNIT_GROUP` recipient semantics. The implementation remains bounded to 3D.1 and retains Phase 3B/3C FX semantics.

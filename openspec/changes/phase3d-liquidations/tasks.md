# Phase 3D.1 Implementation Tasks

## Scope guardrails

- [x] PM decision recorded: UNIT_GROUP is group-member-only, same tenant/building, billable-only, canonical building weighting, no custom group weights.
- [x] Keep Phase 3D.2 and 3D.3 explicitly out of scope.
- [x] Do not modify package manifests or lockfiles.
- [x] No staging, production, remote migration, commit, push, or deploy.

## TDD work units

### Unit 1 — Canonical distribution engine

- [x] Add the typed Decimal movement allocator.
- [x] Add HALF_EVEN rounding and deterministic residual reconciliation.
- [x] Add input-order determinism and Float boundary tests.
- [x] Add versioned snapshot build/parse validation.

Evidence: `cd apps/api && npm test -- --runInBand liquidation-distribution.spec.ts` passed after the expected RED for the missing module.

### Unit 2 — Draft recipient resolution and freeze

- [x] Include validated UNIT_GROUP expenses in draft source collection.
- [x] Validate group/member tenant and building scope.
- [x] Exclude non-billable members and fail for empty/all-non-billable groups.
- [x] Persist the distribution snapshot atomically with the draft.
- [x] Preserve existing valuation and income-offset boundaries.

Evidence: focused liquidation service tests passed, including group-only recipient and fail-closed cases.

### Unit 3 — Frozen publication consumption

- [x] Validate a non-null frozen snapshot against liquidation identity and total.
- [x] Verify frozen unit IDs remain within tenant/building scope.
- [x] Create charges only from frozen final allocations.
- [x] Retain an explicit compatibility branch for pre-3D.1 null snapshots without backfill.
- [x] Cover post-draft live-weight changes and malformed snapshot rejection.

Evidence: focused publication tests passed; publication did not recalculate live allocation weights for snapshot-backed drafts.

### Unit 4 — Schema and OpenSpec evidence

- [x] Add nullable `Liquidation.distributionSnapshot` JSONB field.
- [x] Add additive local Prisma migration.
- [x] Complete proposal, specification, design, and task artifacts.
- [x] Generate Prisma client locally and validate schema.

## Final verification

- [x] Focused Jest slice: 4 suites, 158 tests passed.
- [x] `npx prisma validate --schema prisma/schema.prisma` passed.
- [x] Targeted TypeScript check found no Phase 3D.1 errors; full API typecheck remains red on pre-existing unrelated documents/onboarding/receipts/contracts errors and must not be hidden.
- [x] `rtk git diff --check` passed.
- [ ] Native RDD review and final repository status/diff evidence.

## Remaining follow-up

- Execute the additive migration only through the approved local migration workflow in a future validation step; do not target staging/production here.
- Phase 3D.2/3D.3 remain blocked from this slice by scope, not by implementation failure.

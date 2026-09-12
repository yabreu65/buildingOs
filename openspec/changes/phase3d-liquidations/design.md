# Phase 3D.1 Design — Frozen Decimal Distribution

## Boundary

`LiquidationsService.createDraft` remains responsible for authoritative tenant/building reads, existing valuation mode selection, and income-offset collection. It queries billable building units and resolves each validated UNIT_GROUP expense to same-tenant/building billable members. The canonical distribution module receives only already-valued movement amounts and frozen recipient inputs.

`LiquidationPublicationUseCase` validates the persisted draft distribution snapshot and uses its final allocations to create charges. A non-null Phase 3D.1 snapshot is authoritative. Legacy rows without the new snapshot retain their pre-3D.1 compatibility branch and are not backfilled.

## Canonical engine

`liquidation-distribution.ts` exposes a pure movement allocator:

1. Validate tenant/building identity, non-negative safe minor-unit amounts, unique movement IDs, and non-empty recipient sets.
2. Normalize Float-backed `coefficient` and `m2` values only after finiteness/range validation, retaining normalized decimal strings in snapshot evidence.
3. Resolve the established building weighting policy. Positive coefficients are used; missing/non-positive coefficients receive the existing neutral weight of `1`; if no positive coefficient exists, the result is equal weighting. No custom UnitGroup weight is accepted.
4. Apportion any liquidation-level income-offset reduction across source movement budgets deterministically, then distribute each movement only among its own recipient set.
5. Round Decimal shares to integer minor units with `Prisma.Decimal.ROUND_HALF_EVEN`, reconcile residuals deterministically, and use `unitId` as the final stable tie-breaker.
6. Aggregate movement allocations by unit and require exact equality with the liquidation total.

The engine has no FX responsibility and does not read Prisma or live state.

## UNIT_GROUP validation

A UNIT_GROUP expense must have a group relation whose tenant and building match the liquidation. Every persisted member and its unit are checked against the same tenant/building. The eligible set is the group's billable members only. Missing group, cross-scope group/member, empty group, and all-non-billable group fail before draft creation.

The draft snapshot freezes group membership and all weight evidence. Publication may verify that frozen unit IDs still belong to the liquidation tenant/building, but must not resolve current membership, `isBillable`, coefficient, or m2 for the allocation result.

## Persistence and compatibility

`Liquidation.distributionSnapshot` is a nullable JSONB column added by an additive migration. New drafts persist the version-1 snapshot in the same transaction as the liquidation and existing FIN-06 artifacts. Historical rows remain null and are not rewritten. Prisma client generation is a local build prerequisite after schema changes; the migration is not executed against remote environments.

## Validation plan

- Focused Jest: distribution, liquidation service, publication use case, and publication snapshot specs.
- Prisma schema validation and local Prisma client generation.
- API typecheck, recording pre-existing baseline errors separately from Phase 3D.1 errors.
- `git diff --check`.
- Native RDD review before reporting completion. No build, deploy, staging, production, commit, or push.

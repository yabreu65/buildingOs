# Liquidation Publication Snapshot Hardening

## Purpose

Published liquidations now persist an immutable publication snapshot so later reads do not depend on mutable draft-time data.

## What changed

- Added `publicationSnapshot` to the `Liquidation` model and a matching Prisma migration.
- Persisted the snapshot at publish time inside the same transaction that creates charges and audit records.
- Made liquidation reads for `PUBLISHED` records source their expense and charge preview data from the stored snapshot when available.
- Added an explicit legacy read path for historical published liquidations that do not yet have `publicationSnapshot`.
- Kept post-commit notifications best effort so a notification failure does not turn a successful publication into an HTTP error.
- Hardened the database trigger so snapshots can only be created on valid `INSERT`/`UPDATE` transitions to `PUBLISHED`, and never mutated afterward.
- Added an internal migration preflight that fails fast when duplicate `PUBLISHED` rows already exist for the same tenant, building, and period.
- Added a partial unique index that guarantees only one published liquidation per tenant, building, and financial period.

## Snapshot contents

The snapshot stores:

- liquidation identity and tenant/building scope
- publication timestamp (`publishedAt`); the parent `Liquidation` retains the publisher identity (`publishedByMembershipId`)
- summary totals and rounding data
- the exact expense list used for publication
- the exact unit allocation plan used to create charges

## Liquidation fields protected after publish

Once a liquidation is already `PUBLISHED`, the database trigger treats these fields as immutable:

- `tenantId`
- `buildingId`
- `period`
- `chargePeriod`
- `status`
- `baseCurrency`
- `totalAmountMinor`
- `totalsByCurrency`
- `expenseSnapshot`
- `publicationSnapshot`
- `unitCount`
- `generatedByMembershipId`
- `generatedAt`
- `reviewedByMembershipId`
- `reviewedAt`
- `publishedByMembershipId`
- `publishedAt`
- `canceledByMembershipId`
- `canceledAt`

`updatedAt` remains operational and is not part of the immutable financial document boundary.

Canceled liquidations are also terminal: after a liquidation reaches `CANCELED`, the trigger rejects any further changes to the financial history or cancellation metadata, preserving the canceled record as an audit trail.

## Historical compatibility strategy

The existing historical rows are not rich enough to rebuild a version-1 snapshot exactly in every case.

Why:

- `Liquidation` keeps the draft expense snapshot and the final charges.
- `Charge` keeps the published amount and unit reference.
- The schema does not preserve every publication-time derived value as an immutable version-1 snapshot did not exist yet.

So the implementation uses two modes:

- `publicationSnapshotStatus: "AVAILABLE"` for modern liquidations with a persisted snapshot.
- `publicationSnapshotStatus: "LEGACY"` for older published liquidations without the new snapshot column populated.

Legacy reads are still tenant/building scoped and they do not recalculate data from current tables. They read the persisted liquidation expense snapshot and the persisted charge rows already stored on the liquidation record. The only mutable legacy dependency that remains is unit metadata used for display (`unit.code` and `unit.label`), so renaming a unit can still change how an older liquidation is rendered.

## Trigger rules

The PostgreSQL trigger enforces these rules:

1. New liquidations must always be inserted with `status = DRAFT`.
2. A `DRAFT` liquidation cannot contain review, publication, cancellation, or publication snapshot metadata.
3. A `DRAFT` liquidation may transition only to `REVIEWED` or `CANCELED`.
4. A `REVIEWED` liquidation must include `reviewedAt` and `reviewedByMembershipId`.
5. A `REVIEWED` liquidation may transition only to `PUBLISHED` or `CANCELED`.
6. A liquidation may transition to `PUBLISHED` only from `REVIEWED`.
7. Publishing requires `publicationSnapshot`, `publishedAt`, and `publishedByMembershipId` in the same update.
8. A liquidation cannot transition directly from `DRAFT` to `PUBLISHED`.
9. During `REVIEWED → PUBLISHED`, the trigger allows the publication fields (`publicationSnapshot`, `publishedAt`, `publishedByMembershipId`) to change atomically while protecting the financial history.
10. A `PUBLISHED` liquidation is terminal and its protected financial, historical, and snapshot fields are immutable after publication.
11. A `CANCELED` liquidation requires `canceledAt` and `canceledByMembershipId` and is terminal and immutable.
12. `PUBLISHED` liquidations cannot be canceled directly; reversal or compensation requires a separate domain flow.
13. Legacy `PUBLISHED` liquidations with `publicationSnapshot = null` remain explicitly legacy and the snapshot must remain null.
14. Non-published liquidations cannot create or carry publication metadata or `publicationSnapshot`.
15. The `DRAFT → CANCELED` and `REVIEWED → CANCELED` transition may only set the cancellation metadata, `status`, and `updatedAt`; all financial and historical fields must remain unchanged.

## Timestamp consistency

Publication now uses one shared `publishedAt` value for:

- `publicationSnapshot.publishedAt`
- `Liquidation.publishedAt`

The snapshot stores `publishedAt` only. The parent `Liquidation` row stores
`publishedByMembershipId`, which identifies the membership that performed the
publication; that identity is not duplicated into the snapshot.

That prevents drift between the snapshot and the row that represents the publication event.

## Verification checklist

Run these checks before merging or promoting the slice:

- targeted liquidation service tests
- full API test suite
- TypeScript typecheck for `apps/api`
- Prisma schema validation
- API build
- lint

## Legacy compatibility

Historical published liquidations without a snapshot remain readable through `publicationSnapshotStatus: "LEGACY"`.
That compatibility path is read-only: the database trigger does not allow retroactive snapshot insertion into those rows, and the service keeps consuming the persisted legacy data as-is.

## Uniqueness rule for published liquidations

The database now enforces one published liquidation per:

- `tenantId`
- `buildingId`
- `period`

with a partial unique index that only applies when `status = 'PUBLISHED'`.

The migration now runs a preflight check immediately before creating that index. If duplicate published rows already exist for the same tenant/building/period, the migration aborts with an explicit uniqueness error instead of trying to deduplicate data silently.

Prisma does not model this partial index directly in `schema.prisma`, so the migration owns the invariant.

### Preflight before applying the migration to a populated database

Run this read-only query to detect duplicates before deployment:

```sql
SELECT "tenantId", "buildingId", "period", COUNT(*)
FROM "Liquidation"
WHERE "status" = 'PUBLISHED'
GROUP BY "tenantId", "buildingId", "period"
HAVING COUNT(*) > 1;
```

The migration is expected to fail if that query returns rows. Do not deduplicate silently.

## Remaining operational note

This hardening does not authorize production deployment or remote migration execution. Those remain separate approval steps.

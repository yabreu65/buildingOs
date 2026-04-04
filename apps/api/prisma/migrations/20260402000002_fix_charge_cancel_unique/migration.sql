-- Fix: allow re-publishing a liquidation after cancellation for the same period.
-- The old unique constraint on (unitId, period, concept) prevented creating new charges
-- when soft-deleted (canceledAt != NULL) charges already existed for the same combination.
-- Replace with a partial unique index that only enforces uniqueness for active charges.

-- Drop the old unique constraint
DROP INDEX IF EXISTS "Charge_unitId_period_concept_key";

-- Regular index on the three columns (Prisma @@index)
CREATE INDEX IF NOT EXISTS "Charge_unitId_period_concept_idx"
  ON "Charge" ("unitId", "period", "concept");

-- Partial unique index: only one active charge per (unitId, period, concept)
CREATE UNIQUE INDEX IF NOT EXISTS "Charge_active_unique"
  ON "Charge" ("unitId", "period", "concept")
  WHERE "canceledAt" IS NULL;

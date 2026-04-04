-- Fix: allow multiple CANCELED liquidations for the same (tenantId, buildingId, period)
-- The old unique constraint prevented canceling a liquidation if a previous one was already canceled
-- for the same period. Replace it with a partial unique index that only enforces uniqueness
-- for active (non-CANCELED) liquidations.

-- Drop the old unique constraint
DROP INDEX IF EXISTS "Liquidation_tenantId_buildingId_period_status_key";

-- Create a regular index on the four columns (Prisma @@index)
CREATE INDEX IF NOT EXISTS "Liquidation_tenantId_buildingId_period_status_idx"
  ON "Liquidation" ("tenantId", "buildingId", "period", "status");

-- Partial unique index: only one active liquidation per (tenant, building, period)
CREATE UNIQUE INDEX IF NOT EXISTS "Liquidation_active_unique"
  ON "Liquidation" ("tenantId", "buildingId", "period")
  WHERE "status" != 'CANCELED';

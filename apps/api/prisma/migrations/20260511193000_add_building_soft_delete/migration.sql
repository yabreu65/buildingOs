-- Add soft-delete column for buildings
ALTER TABLE "Building"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Optimize tenant queries that exclude soft-deleted records
CREATE INDEX IF NOT EXISTS "Building_tenantId_deletedAt_idx"
ON "Building"("tenantId", "deletedAt");

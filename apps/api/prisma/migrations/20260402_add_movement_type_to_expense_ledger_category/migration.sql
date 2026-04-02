-- CreateEnum MovementType
CREATE TYPE "MovementType" AS ENUM ('EXPENSE', 'INCOME');

-- AlterTable ExpenseLedgerCategory
ALTER TABLE "ExpenseLedgerCategory" ADD COLUMN "movementType" "MovementType" NOT NULL DEFAULT 'EXPENSE';
ALTER TABLE "ExpenseLedgerCategory" RENAME COLUMN "active" TO "isActive";

-- Add indices for filtering by movement type and isActive
CREATE INDEX "ExpenseLedgerCategory_tenantId_movementType_idx" ON "ExpenseLedgerCategory"("tenantId", "movementType");
CREATE INDEX "ExpenseLedgerCategory_tenantId_isActive_idx" ON "ExpenseLedgerCategory"("tenantId", "isActive");

-- Drop old index on (tenantId, active)
DROP INDEX IF EXISTS "ExpenseLedgerCategory_tenantId_active_idx";

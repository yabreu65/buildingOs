-- Add code and sortOrder columns to ExpenseLedgerCategory
ALTER TABLE "ExpenseLedgerCategory" ADD COLUMN "code" TEXT;
ALTER TABLE "ExpenseLedgerCategory" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Create unique index on (tenantId, code) with partial index for nulls
-- This allows multiple NULL codes (manually created categories) per tenant
CREATE UNIQUE INDEX "ExpenseLedgerCategory_tenantId_code_key"
  ON "ExpenseLedgerCategory"("tenantId", "code")
  WHERE "code" IS NOT NULL;

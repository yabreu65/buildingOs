-- Backfill existing categories with EXPENSE movement type (they were all expenses)
-- This is a data migration for categories that existed before the movementType field was added

UPDATE "ExpenseLedgerCategory"
SET "movementType" = 'EXPENSE'
WHERE "movementType" IS NULL;

-- FIN-04: provenance de materialización legacy en IncomeApplication.
-- ADITIVA: columna nullable + AuditAction + CHECKs. Sin data rewrite financiero.

-- AlterEnum AuditAction
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INCOME_LEGACY_BACKFILL';

-- AlterTable IncomeApplication (provenance legacy)
ALTER TABLE "IncomeApplication" ADD COLUMN     "legacyDestination" "IncomeDestination";

-- CHECK: provenance mutuamente exclusiva (policy vs legacy)
ALTER TABLE "IncomeApplication" ADD CONSTRAINT "IncomeApplication_provenance_exclusive"
CHECK (
  NOT ("policyVersionId" IS NOT NULL AND "legacyDestination" IS NOT NULL)
);

-- CHECK: mapping legacy -> destinationType/fundId coherente
ALTER TABLE "IncomeApplication" ADD CONSTRAINT "IncomeApplication_legacy_destination_mapping"
CHECK (
  "legacyDestination" IS NULL
  OR (
    "legacyDestination" = 'APPLY_TO_EXPENSES'
    AND "destinationType" = 'OFFSET_EXPENSES'
    AND "fundId" IS NULL
  )
  OR (
    "legacyDestination" IN ('RESERVE_FUND', 'SPECIAL_FUND')
    AND "destinationType" = 'FUND'
    AND "fundId" IS NOT NULL
  )
);

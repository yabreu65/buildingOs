-- Onboarding imports: transactional confirmation support

ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'CONFIRMING';
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'IMPORT_CONFIRM_STARTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'IMPORT_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'IMPORT_CONFIRM_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'IMPORT_RECONFIRM_ATTEMPT';

ALTER TABLE "ImportJob"
  ADD COLUMN IF NOT EXISTS "previewVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "previewHash" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmingAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmingLockExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmingByMembershipId" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmedByMembershipId" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmationSummary" JSONB,
  ADD COLUMN IF NOT EXISTS "confirmationResult" JSONB;

ALTER TABLE "Charge"
  ADD COLUMN IF NOT EXISTS "importJobId" TEXT;

CREATE INDEX IF NOT EXISTS "ImportJob_confirmingByMembershipId_idx"
  ON "ImportJob"("confirmingByMembershipId");
CREATE INDEX IF NOT EXISTS "ImportJob_confirmedByMembershipId_idx"
  ON "ImportJob"("confirmedByMembershipId");
CREATE INDEX IF NOT EXISTS "Charge_importJobId_idx"
  ON "Charge"("importJobId");

CREATE UNIQUE INDEX IF NOT EXISTS "Charge_tenantId_importJobId_unitId_period_concept_key"
  ON "Charge"("tenantId", "importJobId", "unitId", "period", "concept");

ALTER TABLE "ImportJob"
  ADD CONSTRAINT "ImportJob_confirmingByMembershipId_fkey"
  FOREIGN KEY ("confirmingByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportJob"
  ADD CONSTRAINT "ImportJob_confirmedByMembershipId_fkey"
  FOREIGN KEY ("confirmedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Charge"
  ADD CONSTRAINT "Charge_importJobId_fkey"
  FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

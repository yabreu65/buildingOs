-- Preserve provider-issued object identity without requiring a backfill.
ALTER TABLE "File"
  ADD COLUMN "objectVersionId" TEXT;

ALTER TABLE "ImportJob"
  ADD COLUMN "originalObjectVersionId" TEXT,
  ADD COLUMN "normalizedObjectVersionId" TEXT;

-- Add durable receipt issuance snapshot and storage-generation lease fields.
-- Existing Payments intentionally remain NULL; no historical reconstruction is performed.
ALTER TABLE "Payment"
  ADD COLUMN "receiptSnapshot" JSONB,
  ADD COLUMN "receiptSnapshotVersion" TEXT,
  ADD COLUMN "receiptSnapshotHash" TEXT,
  ADD COLUMN "receiptSnapshotCreatedAt" TIMESTAMP(3),
  ADD COLUMN "receiptGenerationToken" TEXT,
  ADD COLUMN "receiptGenerationLeaseUntil" TIMESTAMP(3);

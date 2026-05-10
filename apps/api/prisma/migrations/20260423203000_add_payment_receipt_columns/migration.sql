-- Add missing receipt and approval tracking fields to Payment
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReceiptStatus') THEN
    CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
  END IF;
END
$$;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "receiptDocumentId" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptStatus" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "receiptError" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptGeneratedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Payment_tenantId_receiptStatus_idx"
  ON "Payment"("tenantId", "receiptStatus");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Payment_tenantId_receiptNumber_key'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_tenantId_receiptNumber_key"
      UNIQUE ("tenantId", "receiptNumber");
  END IF;
END
$$;

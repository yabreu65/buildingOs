-- Backfill paidAt for previously approved/reconciled payments.
-- Approximation rule (MVP): use updatedAt when paidAt is missing.
UPDATE "Payment"
SET "paidAt" = "updatedAt"
WHERE "paidAt" IS NULL
  AND "status" IN ('APPROVED', 'RECONCILED');


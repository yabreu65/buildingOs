-- Add PlanChangeRequest model for manual upgrade workflow
-- Note: BillingPlan, Subscription and AuditLog already exist from previous migrations.

CREATE TABLE IF NOT EXISTS "PlanChangeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedPlanId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByMembershipId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "note" TEXT,
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "PlanChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlanChangeRequest_tenantId_status_idx"
  ON "PlanChangeRequest"("tenantId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PlanChangeRequest_tenantId_fkey'
  ) THEN
    ALTER TABLE "PlanChangeRequest"
      ADD CONSTRAINT "PlanChangeRequest_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PlanChangeRequest_requestedPlanId_fkey'
  ) THEN
    ALTER TABLE "PlanChangeRequest"
      ADD CONSTRAINT "PlanChangeRequest_requestedPlanId_fkey"
      FOREIGN KEY ("requestedPlanId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PlanChangeRequest_requestedByMembershipId_fkey'
  ) THEN
    ALTER TABLE "PlanChangeRequest"
      ADD CONSTRAINT "PlanChangeRequest_requestedByMembershipId_fkey"
      FOREIGN KEY ("requestedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PlanChangeRequest_reviewedByUserId_fkey'
  ) THEN
    ALTER TABLE "PlanChangeRequest"
      ADD CONSTRAINT "PlanChangeRequest_reviewedByUserId_fkey"
      FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

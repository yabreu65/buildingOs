-- FIN-05: IncomePolicy + Version + Rule (configuración por categoría)
-- ADITIVA: no altera datos financieros existentes.

-- CreateEnum
CREATE TYPE "IncomePolicyVersionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterEnum AuditAction
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INCOME_POLICY_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INCOME_POLICY_VERSION_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INCOME_POLICY_DEACTIVATE';

-- AlterTable IncomeApplication (provenance de política)
ALTER TABLE "IncomeApplication" ADD COLUMN     "policyVersionId" TEXT;

-- CreateTable IncomePolicy
CREATE TABLE "IncomePolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable IncomePolicyVersion
CREATE TABLE "IncomePolicyVersion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "IncomePolicyVersionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomePolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable IncomePolicyRule
CREATE TABLE "IncomePolicyRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "destinationType" "IncomeApplicationDestination" NOT NULL,
    "fundId" TEXT,
    "percentageBasisPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomePolicyRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IncomePolicyRule_percentage_bp_range" CHECK ("percentageBasisPoints" > 0 AND "percentageBasisPoints" <= 10000),
    CONSTRAINT "IncomePolicyRule_destination_fund_invariant" CHECK (
      ("destinationType" = 'FUND' AND "fundId" IS NOT NULL)
      OR
      ("destinationType" IN ('OFFSET_EXPENSES', 'CARRY_FORWARD') AND "fundId" IS NULL)
    )
);

-- AddForeignKey
ALTER TABLE "IncomeApplication" ADD CONSTRAINT "IncomeApplication_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "IncomePolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IncomePolicy" ADD CONSTRAINT "IncomePolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncomePolicy" ADD CONSTRAINT "IncomePolicy_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseLedgerCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncomePolicy" ADD CONSTRAINT "IncomePolicy_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncomePolicyVersion" ADD CONSTRAINT "IncomePolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "IncomePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncomePolicyVersion" ADD CONSTRAINT "IncomePolicyVersion_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncomePolicyRule" ADD CONSTRAINT "IncomePolicyRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncomePolicyRule" ADD CONSTRAINT "IncomePolicyRule_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "IncomePolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncomePolicyRule" ADD CONSTRAINT "IncomePolicyRule_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "IncomePolicy_tenantId_categoryId_key" ON "IncomePolicy"("tenantId", "categoryId");
CREATE INDEX "IncomePolicy_tenantId_idx" ON "IncomePolicy"("tenantId");
CREATE UNIQUE INDEX "IncomePolicyVersion_policyId_version_key" ON "IncomePolicyVersion"("policyId", "version");
CREATE INDEX "IncomePolicyVersion_policyId_status_idx" ON "IncomePolicyVersion"("policyId", "status");
CREATE UNIQUE INDEX "IncomePolicyVersion_single_active_key" ON "IncomePolicyVersion"("policyId") WHERE "status" = 'ACTIVE';
CREATE INDEX "IncomePolicyRule_tenantId_versionId_idx" ON "IncomePolicyRule"("tenantId", "versionId");
CREATE UNIQUE INDEX "IncomePolicyRule_versionId_nonfund_key" ON "IncomePolicyRule"("versionId", "destinationType") WHERE "destinationType" IN ('OFFSET_EXPENSES', 'CARRY_FORWARD');
CREATE UNIQUE INDEX "IncomePolicyRule_versionId_fundId_key" ON "IncomePolicyRule"("versionId", "fundId") WHERE "fundId" IS NOT NULL;
CREATE INDEX "IncomeApplication_tenantId_policyVersionId_idx" ON "IncomeApplication"("tenantId", "policyVersionId");

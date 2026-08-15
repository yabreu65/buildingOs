-- FIN-03: IncomeApplication (plan explícito de qué se hace con un Income)
-- ADITIVA: no altera datos financieros existentes.

-- CreateEnum
CREATE TYPE "IncomeApplicationDestination" AS ENUM ('OFFSET_EXPENSES', 'FUND', 'CARRY_FORWARD');

-- AlterEnum AuditAction
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INCOME_APPLICATIONS_CREATE';

-- AlterTable FundTransaction (linkage 1:1 a IncomeApplication)
ALTER TABLE "FundTransaction" ADD COLUMN     "incomeApplicationId" TEXT;

-- CreateTable IncomeApplication
CREATE TABLE "IncomeApplication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incomeId" TEXT NOT NULL,
    "destinationType" "IncomeApplicationDestination" NOT NULL,
    "fundId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomeApplication_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IncomeApplication_amountMinor_positive" CHECK ("amountMinor" > 0),
    CONSTRAINT "IncomeApplication_destination_fund_invariant" CHECK (
      ("destinationType" = 'FUND' AND "fundId" IS NOT NULL)
      OR
      ("destinationType" IN ('OFFSET_EXPENSES', 'CARRY_FORWARD') AND "fundId" IS NULL)
    )
);

-- AddForeignKey
ALTER TABLE "IncomeApplication" ADD CONSTRAINT "IncomeApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncomeApplication" ADD CONSTRAINT "IncomeApplication_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncomeApplication" ADD CONSTRAINT "IncomeApplication_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncomeApplication" ADD CONSTRAINT "IncomeApplication_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_incomeApplicationId_fkey" FOREIGN KEY ("incomeApplicationId") REFERENCES "IncomeApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "IncomeApplication_tenantId_incomeId_idx" ON "IncomeApplication"("tenantId", "incomeId");
CREATE INDEX "IncomeApplication_tenantId_fundId_idx" ON "IncomeApplication"("tenantId", "fundId");
CREATE UNIQUE INDEX "IncomeApplication_incomeId_fundId_key" ON "IncomeApplication"("incomeId", "fundId") WHERE "fundId" IS NOT NULL;
CREATE UNIQUE INDEX "IncomeApplication_incomeId_nonfund_key" ON "IncomeApplication"("incomeId", "destinationType") WHERE "destinationType" IN ('OFFSET_EXPENSES', 'CARRY_FORWARD');
CREATE UNIQUE INDEX "FundTransaction_incomeApplicationId_key" ON "FundTransaction"("incomeApplicationId");

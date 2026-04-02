-- CreateEnum IncomeStatus
CREATE TYPE "IncomeStatus" AS ENUM ('DRAFT', 'RECORDED', 'VOID');

-- CreateTable Income
CREATE TABLE "Income" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "period" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "attachmentFileKey" TEXT,
    "status" "IncomeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByMembershipId" TEXT NOT NULL,
    "recordedByMembershipId" TEXT,
    "recordedAt" TIMESTAMP(3),
    "voidedByMembershipId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseLedgerCategory"("id") ON DELETE RESTRICT;

-- AddIndex
CREATE INDEX "Income_tenantId_period_idx" ON "Income"("tenantId", "period");
CREATE INDEX "Income_tenantId_buildingId_period_idx" ON "Income"("tenantId", "buildingId", "period");
CREATE INDEX "Income_tenantId_status_idx" ON "Income"("tenantId", "status");
CREATE INDEX "Income_tenantId_categoryId_idx" ON "Income"("tenantId", "categoryId");

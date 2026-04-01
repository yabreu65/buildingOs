-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'VALIDATED', 'VOID');

-- CreateEnum
CREATE TYPE "LiquidationStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED', 'CANCELED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_VALIDATE';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_VOID';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_LEDGER_CATEGORY_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_LEDGER_CATEGORY_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_LEDGER_CATEGORY_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'LIQUIDATION_DRAFT';
ALTER TYPE "AuditAction" ADD VALUE 'LIQUIDATION_REVIEW';
ALTER TYPE "AuditAction" ADD VALUE 'LIQUIDATION_PUBLISH';
ALTER TYPE "AuditAction" ADD VALUE 'LIQUIDATION_CANCEL';

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN "liquidationId" TEXT;

-- CreateTable
CREATE TABLE "ExpenseLedgerCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseLedgerCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "vendorId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "attachmentFileKey" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByMembershipId" TEXT NOT NULL,
    "validatedByMembershipId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "voidedByMembershipId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Liquidation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "LiquidationStatus" NOT NULL DEFAULT 'DRAFT',
    "baseCurrency" TEXT NOT NULL,
    "totalAmountMinor" INTEGER NOT NULL,
    "totalsByCurrency" JSONB NOT NULL,
    "expenseSnapshot" JSONB NOT NULL,
    "unitCount" INTEGER NOT NULL,
    "generatedByMembershipId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByMembershipId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedByMembershipId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "canceledByMembershipId" TEXT,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Liquidation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseLedgerCategory_tenantId_idx" ON "ExpenseLedgerCategory"("tenantId");

-- CreateIndex
CREATE INDEX "ExpenseLedgerCategory_tenantId_active_idx" ON "ExpenseLedgerCategory"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseLedgerCategory_tenantId_name_key" ON "ExpenseLedgerCategory"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Expense_tenantId_buildingId_period_idx" ON "Expense"("tenantId", "buildingId", "period");

-- CreateIndex
CREATE INDEX "Expense_tenantId_buildingId_status_idx" ON "Expense"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "Expense_tenantId_period_categoryId_idx" ON "Expense"("tenantId", "period", "categoryId");

-- CreateIndex
CREATE INDEX "Liquidation_tenantId_buildingId_idx" ON "Liquidation"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "Liquidation_tenantId_status_idx" ON "Liquidation"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Liquidation_tenantId_buildingId_period_status_key" ON "Liquidation"("tenantId", "buildingId", "period", "status");

-- CreateIndex
CREATE INDEX "Charge_liquidationId_idx" ON "Charge"("liquidationId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_liquidationId_fkey" FOREIGN KEY ("liquidationId") REFERENCES "Liquidation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLedgerCategory" ADD CONSTRAINT "ExpenseLedgerCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseLedgerCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Liquidation" ADD CONSTRAINT "Liquidation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Liquidation" ADD CONSTRAINT "Liquidation_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

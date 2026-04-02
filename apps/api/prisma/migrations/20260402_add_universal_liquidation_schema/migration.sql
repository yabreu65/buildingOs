-- CreateEnum MovementScope
CREATE TYPE "MovementScope" AS ENUM ('BUILDING', 'TENANT_SHARED', 'UNIT_GROUP');

-- CreateEnum IncomeDestination
CREATE TYPE "IncomeDestination" AS ENUM ('APPLY_TO_EXPENSES', 'RESERVE_FUND', 'SPECIAL_FUND');

-- AlterTable Expense
ALTER TABLE "Expense" ADD COLUMN "scopeType" "MovementScope" NOT NULL DEFAULT 'BUILDING';
ALTER TABLE "Expense" ADD COLUMN "unitGroupId" TEXT;
ALTER TABLE "Expense" ALTER COLUMN "buildingId" DROP NOT NULL;

-- AlterTable Income
ALTER TABLE "Income" ADD COLUMN "scopeType" "MovementScope" NOT NULL DEFAULT 'BUILDING';
ALTER TABLE "Income" ADD COLUMN "destination" "IncomeDestination" NOT NULL DEFAULT 'APPLY_TO_EXPENSES';
ALTER TABLE "Income" ADD COLUMN "unitGroupId" TEXT;

-- CreateTable MovementAllocation
CREATE TABLE "MovementAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "expenseId" TEXT,
    "incomeId" TEXT,
    "buildingId" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION,
    "amountMinor" INTEGER,
    "currencyCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovementAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable UnitGroup
CREATE TABLE "UnitGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable UnitGroupMember
CREATE TABLE "UnitGroupMember" (
    "id" TEXT NOT NULL,
    "unitGroupId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitGroupMember_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_unitGroupId_fkey" FOREIGN KEY ("unitGroupId") REFERENCES "UnitGroup"("id") ON DELETE SET NULL;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_unitGroupId_fkey" FOREIGN KEY ("unitGroupId") REFERENCES "UnitGroup"("id") ON DELETE SET NULL;

-- AddForeignKey
ALTER TABLE "MovementAllocation" ADD CONSTRAINT "MovementAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementAllocation" ADD CONSTRAINT "MovementAllocation_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementAllocation" ADD CONSTRAINT "MovementAllocation_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementAllocation" ADD CONSTRAINT "MovementAllocation_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitGroup" ADD CONSTRAINT "UnitGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitGroup" ADD CONSTRAINT "UnitGroup_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitGroupMember" ADD CONSTRAINT "UnitGroupMember_unitGroupId_fkey" FOREIGN KEY ("unitGroupId") REFERENCES "UnitGroup"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitGroupMember" ADD CONSTRAINT "UnitGroupMember_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE;

-- CreateIndex
CREATE INDEX "MovementAllocation_tenantId_expenseId_idx" ON "MovementAllocation"("tenantId", "expenseId");
CREATE INDEX "MovementAllocation_tenantId_incomeId_idx" ON "MovementAllocation"("tenantId", "incomeId");
CREATE INDEX "MovementAllocation_tenantId_buildingId_idx" ON "MovementAllocation"("tenantId", "buildingId");
CREATE UNIQUE INDEX "MovementAllocation_tenantId_expenseId_buildingId_key" ON "MovementAllocation"("tenantId", "expenseId", "buildingId") WHERE "expenseId" IS NOT NULL;
CREATE UNIQUE INDEX "MovementAllocation_tenantId_incomeId_buildingId_key" ON "MovementAllocation"("tenantId", "incomeId", "buildingId") WHERE "incomeId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "UnitGroup_tenantId_buildingId_name_key" ON "UnitGroup"("tenantId", "buildingId", "name");
CREATE INDEX "UnitGroup_tenantId_buildingId_idx" ON "UnitGroup"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitGroupMember_unitGroupId_unitId_key" ON "UnitGroupMember"("unitGroupId", "unitId");
CREATE INDEX "UnitGroupMember_unitGroupId_idx" ON "UnitGroupMember"("unitGroupId");
CREATE INDEX "UnitGroupMember_unitId_idx" ON "UnitGroupMember"("unitId");

-- CreateIndex
CREATE INDEX "Expense_tenantId_scopeType_idx" ON "Expense"("tenantId", "scopeType");
CREATE INDEX "Income_tenantId_scopeType_idx" ON "Income"("tenantId", "scopeType");
CREATE INDEX "Income_tenantId_destination_idx" ON "Income"("tenantId", "destination");

-- Backfill: Set all existing Expense to scopeType='BUILDING' (they all have buildingId)
UPDATE "Expense" SET "scopeType" = 'BUILDING' WHERE "scopeType" IS NULL;

-- Backfill: Set all existing Income to scopeType='BUILDING' and destination='APPLY_TO_EXPENSES'
UPDATE "Income" SET "scopeType" = 'BUILDING' WHERE "scopeType" IS NULL;
UPDATE "Income" SET "destination" = 'APPLY_TO_EXPENSES' WHERE "destination" IS NULL;

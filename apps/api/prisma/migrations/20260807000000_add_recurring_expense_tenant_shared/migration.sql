-- CreateEnum: RecurringExpenseAllocationMode
CREATE TYPE "RecurringExpenseAllocationMode" AS ENUM ('MANUAL', 'EQUAL_SHARE', 'BUILDING_TOTAL_M2');

-- AlterTable: Make buildingId nullable and add scopeType/allocationMode to RecurringExpense
ALTER TABLE "RecurringExpense" ALTER COLUMN "buildingId" DROP NOT NULL;
ALTER TABLE "RecurringExpense" ADD COLUMN "scopeType" "MovementScope" NOT NULL DEFAULT 'BUILDING';
ALTER TABLE "RecurringExpense" ADD COLUMN "allocationMode" "RecurringExpenseAllocationMode";

-- CreateTable: RecurringExpenseAllocation (percentage-only template for MANUAL mode)
CREATE TABLE "RecurringExpenseAllocation" (
    "id" TEXT NOT NULL,
    "recurringExpenseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpenseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint for building per recurring expense
CREATE UNIQUE INDEX "RecurringExpenseAllocation_recurringExpenseId_buildingId_key" ON "RecurringExpenseAllocation"("recurringExpenseId", "buildingId");

-- CreateIndex: Index for tenant lookups
CREATE INDEX "RecurringExpenseAllocation_tenantId_recurringExpenseId_idx" ON "RecurringExpenseAllocation"("tenantId", "recurringExpenseId");

-- CreateIndex: Scope type index for RecurringExpense
CREATE INDEX "RecurringExpense_tenantId_scopeType_idx" ON "RecurringExpense"("tenantId", "scopeType");

-- AddForeignKey: RecurringExpenseAllocation -> RecurringExpense
ALTER TABLE "RecurringExpenseAllocation" ADD CONSTRAINT "RecurringExpenseAllocation_recurringExpenseId_fkey" FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: RecurringExpenseAllocation -> Tenant
ALTER TABLE "RecurringExpenseAllocation" ADD CONSTRAINT "RecurringExpenseAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: RecurringExpenseAllocation -> Building
ALTER TABLE "RecurringExpenseAllocation" ADD CONSTRAINT "RecurringExpenseAllocation_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- UpdateForeignKey: RecurringExpense -> Building (now nullable, CASCADE on delete)
ALTER TABLE "RecurringExpense" DROP CONSTRAINT "RecurringExpense_buildingId_fkey";
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

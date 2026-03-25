-- CreateEnum
CREATE TYPE "ExpensePeriodStatus" AS ENUM ('DRAFT', 'GENERATED', 'PUBLISHED', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'UNIT_CATEGORY_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'UNIT_CATEGORY_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'UNIT_CATEGORY_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'UNIT_CATEGORY_AUTO_ASSIGN';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_PERIOD_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_PERIOD_GENERATE';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_PERIOD_PUBLISH';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_PERIOD_DELETE';

-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "allocationMode" TEXT NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "categorySnapshotId" TEXT,
ADD COLUMN     "coefficientSnapshot" DOUBLE PRECISION,
ADD COLUMN     "periodId" TEXT,
ADD COLUMN     "sumCoefSnapshot" DOUBLE PRECISION,
ADD COLUMN     "totalToAllocateSnapshot" INTEGER;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "isBillable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "m2" DOUBLE PRECISION,
ADD COLUMN     "unitCategoryId" TEXT;

-- CreateTable
CREATE TABLE "UnitCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minM2" DOUBLE PRECISION NOT NULL,
    "maxM2" DOUBLE PRECISION,
    "coefficient" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpensePeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalToAllocate" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "concept" TEXT NOT NULL,
    "status" "ExpensePeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpensePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnitCategory_tenantId_buildingId_idx" ON "UnitCategory"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "UnitCategory_buildingId_active_idx" ON "UnitCategory"("buildingId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "UnitCategory_buildingId_name_key" ON "UnitCategory"("buildingId", "name");

-- CreateIndex
CREATE INDEX "ExpensePeriod_tenantId_buildingId_idx" ON "ExpensePeriod"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "ExpensePeriod_tenantId_status_idx" ON "ExpensePeriod"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExpensePeriod_buildingId_year_month_key" ON "ExpensePeriod"("buildingId", "year", "month");

-- CreateIndex
CREATE INDEX "Charge_periodId_idx" ON "Charge"("periodId");

-- CreateIndex
CREATE INDEX "Unit_buildingId_unitCategoryId_idx" ON "Unit"("buildingId", "unitCategoryId");

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_unitCategoryId_fkey" FOREIGN KEY ("unitCategoryId") REFERENCES "UnitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitCategory" ADD CONSTRAINT "UnitCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitCategory" ADD CONSTRAINT "UnitCategory_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePeriod" ADD CONSTRAINT "ExpensePeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePeriod" ADD CONSTRAINT "ExpensePeriod_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ExpensePeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

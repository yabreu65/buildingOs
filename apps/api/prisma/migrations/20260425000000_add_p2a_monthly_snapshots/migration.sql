-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateTable
CREATE TABLE "UnitBalanceMonthlySnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "chargedMinor" INTEGER NOT NULL,
    "collectedMinor" INTEGER NOT NULL,
    "outstandingMinor" INTEGER NOT NULL,
    "overdueMinor" INTEGER,
    "collectionRateBp" INTEGER,
    "snapshotVersion" TEXT NOT NULL DEFAULT 'p2a-v1',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recomputedAt" TIMESTAMP(3),
    CONSTRAINT "UnitBalanceMonthlySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingBalanceMonthlySnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "unitCount" INTEGER NOT NULL,
    "chargedMinor" INTEGER NOT NULL,
    "collectedMinor" INTEGER NOT NULL,
    "outstandingMinor" INTEGER NOT NULL,
    "overdueMinor" INTEGER,
    "collectionRateBp" INTEGER,
    "snapshotVersion" TEXT NOT NULL DEFAULT 'p2a-v1',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recomputedAt" TIMESTAMP(3),
    CONSTRAINT "BuildingBalanceMonthlySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnitBalanceMonthlySnapshot_tenantId_unitId_period_currency_key" ON "UnitBalanceMonthlySnapshot" ("tenantId", "unitId", "period", "currency");

-- CreateIndex
CREATE INDEX "UnitBalanceMonthlySnapshot_tenantId_buildingId_period_idx" ON "UnitBalanceMonthlySnapshot" ("tenantId", "buildingId", "period");

-- CreateIndex
CREATE INDEX "UnitBalanceMonthlySnapshot_tenantId_period_idx" ON "UnitBalanceMonthlySnapshot" ("tenantId", "period");

-- CreateIndex
CREATE INDEX "UnitBalanceMonthlySnapshot_tenantId_asOf_idx" ON "UnitBalanceMonthlySnapshot" ("tenantId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "BuildingBalanceMonthlySnapshot_tenantId_buildingId_period_currency_key" ON "BuildingBalanceMonthlySnapshot" ("tenantId", "buildingId", "period", "currency");

-- CreateIndex
CREATE INDEX "BuildingBalanceMonthlySnapshot_tenantId_period_idx" ON "BuildingBalanceMonthlySnapshot" ("tenantId", "period");

-- CreateIndex
CREATE INDEX "BuildingBalanceMonthlySnapshot_tenantId_buildingId_period_idx" ON "BuildingBalanceMonthlySnapshot" ("tenantId", "buildingId", "period");

-- CreateIndex
CREATE INDEX "BuildingBalanceMonthlySnapshot_tenantId_asOf_idx" ON "BuildingBalanceMonthlySnapshot" ("tenantId", "asOf");

-- AddForeignKey
ALTER TABLE "UnitBalanceMonthlySnapshot" ADD CONSTRAINT "UnitBalanceMonthlySnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitBalanceMonthlySnapshot" ADD CONSTRAINT "UnitBalanceMonthlySnapshot_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitBalanceMonthlySnapshot" ADD CONSTRAINT "UnitBalanceMonthlySnapshot_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingBalanceMonthlySnapshot" ADD CONSTRAINT "BuildingBalanceMonthlySnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingBalanceMonthlySnapshot" ADD CONSTRAINT "BuildingBalanceMonthlySnapshot_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
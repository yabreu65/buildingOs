-- CreateEnum
CREATE TYPE "UnitOccupantRole" AS ENUM ('OWNER', 'RESIDENT');

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "unitType" TEXT NOT NULL DEFAULT 'APARTMENT',
    "occupancyStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOccupant" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UnitOccupantRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitOccupant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Building_tenantId_idx" ON "Building"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Building_tenantId_name_key" ON "Building"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Unit_buildingId_idx" ON "Unit"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_buildingId_code_key" ON "Unit"("buildingId", "code");

-- CreateIndex
CREATE INDEX "UnitOccupant_unitId_idx" ON "UnitOccupant"("unitId");

-- CreateIndex
CREATE INDEX "UnitOccupant_userId_idx" ON "UnitOccupant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOccupant_unitId_userId_role_key" ON "UnitOccupant"("unitId", "userId", "role");

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOccupant" ADD CONSTRAINT "UnitOccupant_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOccupant" ADD CONSTRAINT "UnitOccupant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

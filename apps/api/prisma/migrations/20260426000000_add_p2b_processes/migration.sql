-- CreateEnum
CREATE TYPE "ProcessType" AS ENUM ('LIQUIDATION', 'EXPENSE_VALIDATION', 'CLAIM');

-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ProcessInstance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitId" TEXT,
    "processType" "ProcessType" NOT NULL,
    "referenceId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ProcessStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "period" TEXT,
    "dueAt" TIMESTAMP(3),
    "slaMinutes" INTEGER,
    "overdueSla" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ProcessInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processInstanceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "fromStatus" "ProcessStatus",
    "toStatus" "ProcessStatus",
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessInstance_tenantId_referenceId_processType_key" ON "ProcessInstance" ("tenantId", "referenceId", "processType");

-- CreateIndex
CREATE INDEX "ProcessInstance_tenantId_processType_status_idx" ON "ProcessInstance" ("tenantId", "processType", "status");

-- CreateIndex
CREATE INDEX "ProcessInstance_tenantId_buildingId_status_idx" ON "ProcessInstance" ("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "ProcessInstance_tenantId_createdAt_idx" ON "ProcessInstance" ("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessInstance_tenantId_slaMinutes_overdueSla_idx" ON "ProcessInstance" ("tenantId", "slaMinutes", "overdueSla");

-- CreateIndex
CREATE INDEX "ProcessInstance_assignedToUserId_status_idx" ON "ProcessInstance" ("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "ProcessAudit_tenantId_processInstanceId_idx" ON "ProcessAudit" ("tenantId", "processInstanceId");

-- CreateIndex
CREATE INDEX "ProcessAudit_tenantId_createdAt_idx" ON "ProcessAudit" ("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessAudit" ADD CONSTRAINT "ProcessAudit_processInstanceId_fkey" FOREIGN KEY ("processInstanceId") REFERENCES "ProcessInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessAudit" ADD CONSTRAINT "ProcessAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
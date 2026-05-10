-- CreateEnum
CREATE TYPE "OpsAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OpsAlertStatus" AS ENUM ('OPEN', 'ACK', 'RESOLVED');

-- CreateTable
CREATE TABLE "OpsAlert" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "severity" "OpsAlertSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "window" TEXT NOT NULL,
    "status" "OpsAlertStatus" NOT NULL DEFAULT 'OPEN',
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OpsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpsAlert_dedupeKey_key" ON "OpsAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "OpsAlert_tenantId_status_createdAt_idx" ON "OpsAlert"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OpsAlert_code_status_createdAt_idx" ON "OpsAlert"("code", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "OpsAlert" ADD CONSTRAINT "OpsAlert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

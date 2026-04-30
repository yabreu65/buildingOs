-- AlterTable
ALTER TABLE "Tenant"
ADD COLUMN "managedServiceEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "AssistantHandoffStatus" AS ENUM ('PENDING', 'NOTIFIED', 'FAILED', 'RESOLVED');

-- CreateTable
CREATE TABLE "AssistantHandoff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "resolvedLevel" TEXT NOT NULL,
    "fallbackPath" TEXT NOT NULL,
    "gatewayOutcome" TEXT NOT NULL,
    "contextJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AssistantHandoffStatus" NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "AssistantHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantHandoff_tenantId_createdAt_idx" ON "AssistantHandoff"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantHandoff_status_createdAt_idx" ON "AssistantHandoff"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantHandoff_traceId_idx" ON "AssistantHandoff"("traceId");

-- AddForeignKey
ALTER TABLE "AssistantHandoff" ADD CONSTRAINT "AssistantHandoff_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

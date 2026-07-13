-- Run this manually to fix the tables
-- This is needed because Prisma migrations are failing on enum values

BEGIN;

-- Add enum values (commit them first)
ALTER TYPE "AssistantHandoffStatus" ADD VALUE 'OPEN';
ALTER TYPE "AssistantHandoffStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "AssistantHandoffStatus" ADD VALUE 'DISMISSED';

-- Add columns to existing table (IF NOT EXISTS will handle if already added)
ALTER TABLE "AssistantHandoff"
  ADD COLUMN IF NOT EXISTS "assignedToUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolutionNote" TEXT;

-- Normalize existing rows
UPDATE "AssistantHandoff"
SET "status" = 'OPEN'
WHERE "status" IN ('PENDING', 'NOTIFIED', 'FAILED');

-- Change default
ALTER TABLE "AssistantHandoff"
  ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- Create audit table
CREATE TABLE IF NOT EXISTS "AssistantHandoffAudit" (
  "id" TEXT NOT NULL,
  "handoffId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantHandoffAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AssistantHandoffAudit_handoffId_createdAt_idx" ON "AssistantHandoffAudit"("handoffId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssistantHandoffAudit_actorUserId_createdAt_idx" ON "AssistantHandoffAudit"("actorUserId", "createdAt");

-- Message enums
DO $$
BEGIN
  CREATE TYPE "AssistantMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
  CREATE TYPE "AssistantMessageChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP', 'PUSH');
  CREATE TYPE "AssistantMessageDeliveryStatus" AS ENUM ('PENDING', 'QUEUED', 'DELIVERED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AssistantMessage" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "handoffId" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "direction" "AssistantMessageDirection" NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,
  "channel" "AssistantMessageChannel" NOT NULL DEFAULT 'IN_APP',
  "deliveryStatus" "AssistantMessageDeliveryStatus" NOT NULL DEFAULT 'DELIVERED',
  CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AssistantMessage_tenantId_userId_createdAt_idx" ON "AssistantMessage"("tenantId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssistantMessage_tenantId_handoffId_idx" ON "AssistantMessage"("tenantId", "handoffId");
CREATE INDEX IF NOT EXISTS "AssistantMessage_traceId_idx" ON "AssistantMessage"("traceId");

-- Ops alerts
DO $$
BEGIN
  CREATE TYPE "OpsAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
  CREATE TYPE "OpsAlertStatus" AS ENUM ('OPEN', 'ACK', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "OpsAlert" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "OpsAlert_dedupeKey_key" ON "OpsAlert"("dedupeKey");
CREATE INDEX IF NOT EXISTS "OpsAlert_tenantId_status_createdAt_idx" ON "OpsAlert"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "OpsAlert_code_status_createdAt_idx" ON "OpsAlert"("code", "status", "createdAt");

COMMIT;

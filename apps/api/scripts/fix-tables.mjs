async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const sql = `
-- Add columns
ALTER TABLE "AssistantHandoff"
  ADD COLUMN IF NOT EXISTS "assignedToUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolutionNote" TEXT;

-- Normalize status
UPDATE "AssistantHandoff"
SET "status" = 'OPEN'
WHERE "status" IN ('PENDING', 'NOTIFIED', 'FAILED');

-- Change default
ALTER TABLE "AssistantHandoff"
  ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- Audit table
CREATE TABLE IF NOT EXISTS "AssistantHandoffAudit" (
  "id" TEXT NOT NULL,
  "handoffId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantHandoffAudit_pkey" PRIMARY KEY ("id")
);

-- Message enums
DO $$ BEGIN
  CREATE TYPE "AssistantMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
  CREATE TYPE "AssistantMessageChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP', 'PUSH');
  CREATE TYPE "AssistantMessageDeliveryStatus" AS ENUM ('PENDING', 'QUEUED', 'DELIVERED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Message table
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

-- Ops alerts
DO $$ BEGIN
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
`;

  console.log('Running SQL...');
  await prisma.$executeRaw`${sql}`;
  console.log('Done');
  process.exit(0);
}

main();

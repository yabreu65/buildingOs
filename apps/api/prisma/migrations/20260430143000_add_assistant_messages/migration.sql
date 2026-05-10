-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "AssistantMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "AssistantMessageChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP', 'PUSH');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "AssistantMessageDeliveryStatus" AS ENUM ('PENDING', 'QUEUED', 'DELIVERED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
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

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantMessage_tenantId_userId_createdAt_idx"
  ON "AssistantMessage"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantMessage_tenantId_handoffId_idx"
  ON "AssistantMessage"("tenantId", "handoffId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantMessage_traceId_idx"
  ON "AssistantMessage"("traceId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AssistantMessage_tenantId_fkey'
  ) THEN
    ALTER TABLE "AssistantMessage"
      ADD CONSTRAINT "AssistantMessage_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AssistantMessage_userId_fkey'
  ) THEN
    ALTER TABLE "AssistantMessage"
      ADD CONSTRAINT "AssistantMessage_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AssistantMessage_handoffId_fkey'
  ) THEN
    ALTER TABLE "AssistantMessage"
      ADD CONSTRAINT "AssistantMessage_handoffId_fkey"
      FOREIGN KEY ("handoffId") REFERENCES "AssistantHandoff"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AssistantMessage_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "AssistantMessage"
      ADD CONSTRAINT "AssistantMessage_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

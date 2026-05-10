-- Align HITL schema before ops metrics timestamp columns depend on OPEN/IN_PROGRESS states.
-- Additive and safe for existing databases where emergency repair scripts already ran.

ALTER TYPE "AssistantHandoffStatus" ADD VALUE IF NOT EXISTS 'OPEN';
ALTER TYPE "AssistantHandoffStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "AssistantHandoffStatus" ADD VALUE IF NOT EXISTS 'DISMISSED';

CREATE TABLE IF NOT EXISTS "AssistantHandoffAudit" (
  "id" TEXT NOT NULL,
  "handoffId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantHandoffAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AssistantHandoffAudit_handoffId_createdAt_idx"
  ON "AssistantHandoffAudit"("handoffId", "createdAt");

CREATE INDEX IF NOT EXISTS "AssistantHandoffAudit_actorUserId_createdAt_idx"
  ON "AssistantHandoffAudit"("actorUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "AssistantHandoffAudit_action_createdAt_idx"
  ON "AssistantHandoffAudit"("action", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AssistantHandoffAudit_handoffId_fkey'
  ) THEN
    ALTER TABLE "AssistantHandoffAudit"
      ADD CONSTRAINT "AssistantHandoffAudit_handoffId_fkey"
      FOREIGN KEY ("handoffId") REFERENCES "AssistantHandoff"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AssistantHandoffAudit_actorUserId_fkey'
  ) THEN
    ALTER TABLE "AssistantHandoffAudit"
      ADD CONSTRAINT "AssistantHandoffAudit_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

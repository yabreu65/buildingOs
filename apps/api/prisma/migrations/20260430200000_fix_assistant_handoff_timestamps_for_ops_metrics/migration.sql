-- Align AssistantHandoff table with Prisma schema used by Ops/HITL repositories.
-- This migration is additive and safe for existing data.

ALTER TABLE "AssistantHandoff"
  ADD COLUMN IF NOT EXISTS "assignedToUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolutionNote" TEXT;

ALTER TABLE "AssistantHandoff"
  ALTER COLUMN "status" SET DEFAULT 'OPEN';

CREATE INDEX IF NOT EXISTS "AssistantHandoff_assignedToUserId_status_createdAt_idx"
  ON "AssistantHandoff" ("assignedToUserId", "status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssistantHandoff_assignedToUserId_fkey'
  ) THEN
    ALTER TABLE "AssistantHandoff"
      ADD CONSTRAINT "AssistantHandoff_assignedToUserId_fkey"
      FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

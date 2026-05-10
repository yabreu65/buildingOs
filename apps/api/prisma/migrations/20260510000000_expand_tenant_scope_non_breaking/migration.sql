-- Expand phase: add tenant scope columns as nullable and backfill from existing parent relations.
-- This migration is intentionally additive and keeps existing indexes/constraints intact.

ALTER TABLE "Unit" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "MembershipRole" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "UserContext" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "UnitGroupMember" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "UnitGroupMember" ADD COLUMN IF NOT EXISTS "buildingId" TEXT;
ALTER TABLE "SupportTicketComment" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

DO $$
BEGIN
  IF to_regclass('public."AssistantHandoffAudit"') IS NOT NULL THEN
    ALTER TABLE "AssistantHandoffAudit" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
  END IF;
END $$;

UPDATE "Unit" u
SET "tenantId" = b."tenantId"
FROM "Building" b
WHERE u."buildingId" = b."id"
  AND u."tenantId" IS NULL;

UPDATE "MembershipRole" mr
SET "tenantId" = m."tenantId"
FROM "Membership" m
WHERE mr."membershipId" = m."id"
  AND mr."tenantId" IS NULL;

UPDATE "UserContext" uc
SET "tenantId" = m."tenantId"
FROM "Membership" m
WHERE uc."membershipId" = m."id"
  AND uc."tenantId" IS NULL;

UPDATE "UnitGroupMember" ugm
SET "tenantId" = ug."tenantId",
    "buildingId" = ug."buildingId"
FROM "UnitGroup" ug
WHERE ugm."unitGroupId" = ug."id"
  AND (ugm."tenantId" IS NULL OR ugm."buildingId" IS NULL);

UPDATE "SupportTicketComment" stc
SET "tenantId" = st."tenantId"
FROM "SupportTicket" st
WHERE stc."supportTicketId" = st."id"
  AND stc."tenantId" IS NULL;

DO $$
BEGIN
  IF to_regclass('public."AssistantHandoffAudit"') IS NOT NULL
     AND to_regclass('public."AssistantHandoff"') IS NOT NULL THEN
    UPDATE "AssistantHandoffAudit" aha
    SET "tenantId" = ah."tenantId"
    FROM "AssistantHandoff" ah
    WHERE aha."handoffId" = ah."id"
      AND aha."tenantId" IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Unit_tenantId_idx" ON "Unit"("tenantId");
CREATE INDEX IF NOT EXISTS "Unit_tenantId_buildingId_idx" ON "Unit"("tenantId", "buildingId");
CREATE INDEX IF NOT EXISTS "MembershipRole_tenantId_membershipId_idx" ON "MembershipRole"("tenantId", "membershipId");
CREATE INDEX IF NOT EXISTS "MembershipRole_tenantId_scopeBuildingId_idx" ON "MembershipRole"("tenantId", "scopeBuildingId");
CREATE INDEX IF NOT EXISTS "MembershipRole_tenantId_scopeUnitId_idx" ON "MembershipRole"("tenantId", "scopeUnitId");
CREATE INDEX IF NOT EXISTS "UserContext_tenantId_membershipId_idx" ON "UserContext"("tenantId", "membershipId");
CREATE INDEX IF NOT EXISTS "UserContext_tenantId_activeBuildingId_idx" ON "UserContext"("tenantId", "activeBuildingId");
CREATE INDEX IF NOT EXISTS "UserContext_tenantId_activeUnitId_idx" ON "UserContext"("tenantId", "activeUnitId");
CREATE INDEX IF NOT EXISTS "UnitGroupMember_tenantId_buildingId_idx" ON "UnitGroupMember"("tenantId", "buildingId");
CREATE INDEX IF NOT EXISTS "SupportTicketComment_tenantId_supportTicketId_idx" ON "SupportTicketComment"("tenantId", "supportTicketId");

DO $$
BEGIN
  IF to_regclass('public."AssistantHandoffAudit"') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "AssistantHandoffAudit_tenantId_handoffId_idx" ON "AssistantHandoffAudit"("tenantId", "handoffId");
  END IF;
END $$;

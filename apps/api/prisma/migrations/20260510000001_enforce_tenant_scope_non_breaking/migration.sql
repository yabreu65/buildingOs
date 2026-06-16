-- Fix: UnitAssociation table was originally created via prisma db push (not a migration).
-- This CREATE TABLE IF NOT EXISTS makes the migration replayable for shadow databases.
-- Safe for production: IF NOT EXISTS is a no-op when the table already exists.
CREATE TABLE IF NOT EXISTS "UnitAssociation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "parkingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitAssociation_pkey" PRIMARY KEY ("id")
);

-- Contract phase: validate backfill, then enforce NOT NULL, simple Tenant FKs, and additive tenant-aware uniques.
-- Existing constraints are intentionally preserved for compatibility.

DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count FROM "Unit" WHERE "tenantId" IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: Unit.tenantId has % NULL rows', missing_count;
  END IF;

  SELECT count(*) INTO missing_count FROM "MembershipRole" WHERE "tenantId" IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: MembershipRole.tenantId has % NULL rows', missing_count;
  END IF;

  SELECT count(*) INTO missing_count FROM "UserContext" WHERE "tenantId" IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: UserContext.tenantId has % NULL rows', missing_count;
  END IF;

  SELECT count(*) INTO missing_count FROM "UnitGroupMember" WHERE "tenantId" IS NULL OR "buildingId" IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: UnitGroupMember tenant/building scope has % NULL rows', missing_count;
  END IF;

  SELECT count(*) INTO missing_count FROM "SupportTicketComment" WHERE "tenantId" IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: SupportTicketComment.tenantId has % NULL rows', missing_count;
  END IF;

  IF to_regclass('public."AssistantHandoffAudit"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "AssistantHandoffAudit" WHERE "tenantId" IS NULL' INTO missing_count;
    IF missing_count > 0 THEN
      RAISE EXCEPTION 'Tenant scope migration blocked: AssistantHandoffAudit.tenantId has % NULL rows', missing_count;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT count(*) INTO mismatch_count
  FROM "Unit" u
  JOIN "Building" b ON b."id" = u."buildingId"
  WHERE u."tenantId" <> b."tenantId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: % Unit rows mismatch Building tenant', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "MembershipRole" mr
  JOIN "Membership" m ON m."id" = mr."membershipId"
  WHERE mr."tenantId" <> m."tenantId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: % MembershipRole rows mismatch Membership tenant', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "MembershipRole" mr
  JOIN "Building" b ON b."id" = mr."scopeBuildingId"
  WHERE mr."tenantId" <> b."tenantId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: % MembershipRole building scopes mismatch tenant', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "MembershipRole" mr
  JOIN "Unit" u ON u."id" = mr."scopeUnitId"
  WHERE mr."tenantId" <> u."tenantId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: % MembershipRole unit scopes mismatch tenant', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "UserContext" uc
  JOIN "Membership" m ON m."id" = uc."membershipId"
  WHERE uc."tenantId" <> m."tenantId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: % UserContext rows mismatch Membership tenant', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "UserContext" uc
  JOIN "Building" b ON b."id" = uc."activeBuildingId"
  WHERE uc."tenantId" <> b."tenantId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: % UserContext building scopes mismatch tenant', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "UserContext" uc
  JOIN "Unit" u ON u."id" = uc."activeUnitId"
  WHERE uc."tenantId" <> u."tenantId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: % UserContext unit scopes mismatch tenant', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "UnitGroupMember" ugm
  JOIN "UnitGroup" ug ON ug."id" = ugm."unitGroupId"
  JOIN "Unit" u ON u."id" = ugm."unitId"
  WHERE ugm."tenantId" <> ug."tenantId"
     OR ugm."buildingId" <> ug."buildingId"
     OR ugm."tenantId" <> u."tenantId"
     OR ugm."buildingId" <> u."buildingId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: % UnitGroupMember rows mismatch group/unit scope', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "SupportTicketComment" stc
  JOIN "SupportTicket" st ON st."id" = stc."supportTicketId"
  WHERE stc."tenantId" <> st."tenantId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Tenant scope migration blocked: % SupportTicketComment rows mismatch ticket tenant', mismatch_count;
  END IF;

  IF to_regclass('public."AssistantHandoffAudit"') IS NOT NULL
     AND to_regclass('public."AssistantHandoff"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "AssistantHandoffAudit" aha JOIN "AssistantHandoff" ah ON ah."id" = aha."handoffId" WHERE aha."tenantId" <> ah."tenantId"' INTO mismatch_count;
    IF mismatch_count > 0 THEN
      RAISE EXCEPTION 'Tenant scope migration blocked: % AssistantHandoffAudit rows mismatch handoff tenant', mismatch_count;
    END IF;
  END IF;
END $$;

ALTER TABLE "Unit" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "MembershipRole" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "UserContext" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "UnitGroupMember" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "UnitGroupMember" ALTER COLUMN "buildingId" SET NOT NULL;
ALTER TABLE "SupportTicketComment" ALTER COLUMN "tenantId" SET NOT NULL;

DO $$
BEGIN
  IF to_regclass('public."AssistantHandoffAudit"') IS NOT NULL THEN
    ALTER TABLE "AssistantHandoffAudit" ALTER COLUMN "tenantId" SET NOT NULL;
  END IF;
END $$;

ALTER TABLE "Unit" ADD CONSTRAINT "Unit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserContext" ADD CONSTRAINT "UserContext_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitGroupMember" ADD CONSTRAINT "UnitGroupMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitGroupMember" ADD CONSTRAINT "UnitGroupMember_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketComment" ADD CONSTRAINT "SupportTicketComment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF to_regclass('public."AssistantHandoffAudit"') IS NOT NULL THEN
    ALTER TABLE "AssistantHandoffAudit" ADD CONSTRAINT "AssistantHandoffAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Unit_tenantId_buildingId_code_key" ON "Unit"("tenantId", "buildingId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "UnitGroupMember_tenantId_unitGroupId_unitId_key" ON "UnitGroupMember"("tenantId", "unitGroupId", "unitId");
CREATE UNIQUE INDEX IF NOT EXISTS "UnitOccupant_tenantId_unitId_memberId_key" ON "UnitOccupant"("tenantId", "unitId", "memberId");
CREATE UNIQUE INDEX IF NOT EXISTS "UnitAssociation_tenantId_buildingId_apartmentId_parkingId_key" ON "UnitAssociation"("tenantId", "buildingId", "apartmentId", "parkingId");

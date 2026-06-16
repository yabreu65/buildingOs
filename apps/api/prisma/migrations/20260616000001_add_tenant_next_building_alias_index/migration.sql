-- AlterTable: add nextBuildingAliasIndex to Tenant
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "nextBuildingAliasIndex" INTEGER NOT NULL DEFAULT 1;

-- Fix: Building.alias was created via prisma db push, never in a migration.
-- Safe for production: IF NOT EXISTS is a no-op.
ALTER TABLE "Building" ADD COLUMN IF NOT EXISTS "alias" TEXT NOT NULL DEFAULT '';
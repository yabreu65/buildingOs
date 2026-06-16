-- AlterTable: add nextBuildingAliasIndex to Tenant
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "nextBuildingAliasIndex" INTEGER NOT NULL DEFAULT 1;
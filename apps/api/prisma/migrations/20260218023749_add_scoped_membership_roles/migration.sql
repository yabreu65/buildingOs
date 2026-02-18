-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('TENANT', 'BUILDING', 'UNIT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ROLE_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'ROLE_REMOVED';

-- DropIndex
DROP INDEX "MembershipRole_membershipId_role_key";

-- DropIndex
DROP INDEX "MembershipRole_role_idx";

-- AlterTable
ALTER TABLE "MembershipRole" ADD COLUMN     "scopeBuildingId" TEXT,
ADD COLUMN     "scopeType" "ScopeType" NOT NULL DEFAULT 'TENANT',
ADD COLUMN     "scopeUnitId" TEXT;

-- CreateIndex
CREATE INDEX "MembershipRole_membershipId_role_idx" ON "MembershipRole"("membershipId", "role");

-- CreateIndex
CREATE INDEX "MembershipRole_scopeType_scopeBuildingId_idx" ON "MembershipRole"("scopeType", "scopeBuildingId");

-- CreateIndex
CREATE INDEX "MembershipRole_scopeType_scopeUnitId_idx" ON "MembershipRole"("scopeType", "scopeUnitId");

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_scopeBuildingId_fkey" FOREIGN KEY ("scopeBuildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_scopeUnitId_fkey" FOREIGN KEY ("scopeUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

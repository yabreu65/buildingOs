-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('DRAFT', 'PENDING_INVITE', 'ACTIVE', 'DISABLED');

-- CreateTable TenantMember
CREATE TABLE "TenantMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'RESIDENT',
    "status" "MemberStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable TenantInvitation
CREATE TABLE "TenantInvitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantInvitation_pkey" PRIMARY KEY ("id")
);

-- Add columns to UnitOccupant
ALTER TABLE "UnitOccupant" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "UnitOccupant" ADD COLUMN "memberId" TEXT;
ALTER TABLE "UnitOccupant" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UnitOccupant" ADD COLUMN "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UnitOccupant" ADD COLUMN "endDate" TIMESTAMP(3);

-- CreateIndices
CREATE UNIQUE INDEX "TenantMember_tenantId_email_key" ON "TenantMember"("tenantId", "email");
CREATE UNIQUE INDEX "TenantMember_tenantId_phone_key" ON "TenantMember"("tenantId", "phone");
CREATE INDEX "TenantMember_tenantId_status_idx" ON "TenantMember"("tenantId", "status");
CREATE INDEX "TenantMember_tenantId_role_idx" ON "TenantMember"("tenantId", "role");
CREATE UNIQUE INDEX "TenantInvitation_tokenHash_key" ON "TenantInvitation"("tokenHash");
CREATE INDEX "TenantInvitation_tenantId_tokenHash_idx" ON "TenantInvitation"("tenantId", "tokenHash");
CREATE INDEX "TenantInvitation_tenantId_expiresAt_idx" ON "TenantInvitation"("tenantId", "expiresAt");

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TenantMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitOccupant" ADD CONSTRAINT "UnitOccupant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitOccupant" ADD CONSTRAINT "UnitOccupant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TenantMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

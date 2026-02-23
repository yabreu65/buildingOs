-- CreateEnum - only if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadStatus') THEN
    CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED');
  END IF;
END $$;

-- CreateTable - only if not exists
CREATE TABLE IF NOT EXISTS "Lead" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "tenantType" "TenantType" NOT NULL,
    "buildingsCount" INTEGER,
    "unitsEstimate" INTEGER NOT NULL,
    "location" TEXT,
    "message" TEXT,
    "source" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "contactedAt" TIMESTAMP(3),
    "notes" TEXT,
    "convertedTenantId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_email_key" ON "Lead"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_convertedTenantId_idx" ON "Lead"("convertedTenantId");

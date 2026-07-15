-- CreateEnum
CREATE TYPE "OnboardingImportStatus" AS ENUM ('PREVIEW', 'CONFIRMED');

-- CreateTable
CREATE TABLE "OnboardingImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "OnboardingImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingImportRow" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "apartment" TEXT NOT NULL,
    "tower" TEXT,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingImportJob_tenantId_status_idx" ON "OnboardingImportJob"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingImportRow_importJobId_index_key" ON "OnboardingImportRow"("importJobId", "index");

-- AddForeignKey
ALTER TABLE "OnboardingImportJob" ADD CONSTRAINT "OnboardingImportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingImportRow" ADD CONSTRAINT "OnboardingImportRow_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "OnboardingImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

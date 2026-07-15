-- CreateTable
CREATE TABLE "OnboardingImportConfirmation" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingImportConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingImportConfirmation_importJobId_key" ON "OnboardingImportConfirmation"("importJobId");

-- CreateIndex
CREATE INDEX "OnboardingImportConfirmation_tenantId_idx" ON "OnboardingImportConfirmation"("tenantId");

-- AddForeignKey
ALTER TABLE "OnboardingImportConfirmation" ADD CONSTRAINT "OnboardingImportConfirmation_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "OnboardingImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingImportConfirmation" ADD CONSTRAINT "OnboardingImportConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingImportConfirmation" ADD CONSTRAINT "OnboardingImportConfirmation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

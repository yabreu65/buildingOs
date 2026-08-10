-- AlterTable
ALTER TABLE "Adjustment" ADD COLUMN     "conversionDate" TIMESTAMP(3),
ADD COLUMN     "exchangeRateDirection" TEXT,
ADD COLUMN     "exchangeRateEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "exchangeRateId" TEXT,
ADD COLUMN     "exchangeRateValue" DECIMAL(28,12),
ADD COLUMN     "functionalAmountMinor" INTEGER,
ADD COLUMN     "functionalCurrencyCode" TEXT;

-- CreateIndex
CREATE INDEX "Adjustment_tenantId_exchangeRateId_idx" ON "Adjustment"("tenantId", "exchangeRateId");

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "ExchangeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

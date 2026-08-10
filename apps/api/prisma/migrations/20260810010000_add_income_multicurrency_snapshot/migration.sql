-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "conversionDate" TIMESTAMP(3),
ADD COLUMN     "exchangeRateDirection" TEXT,
ADD COLUMN     "exchangeRateEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "exchangeRateId" TEXT,
ADD COLUMN     "exchangeRateValue" DECIMAL(28,12),
ADD COLUMN     "functionalAmountMinor" INTEGER,
ADD COLUMN     "functionalCurrencyCode" TEXT;

-- CreateIndex
CREATE INDEX "Income_tenantId_exchangeRateId_idx" ON "Income"("tenantId", "exchangeRateId");

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "ExchangeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FIN-06: IncomeApplication OFFSET_EXPENSES → Liquidation net distributable
-- ADITIVA: columnas nullable en Liquidation (legacy rows no se reescriben)
-- y tabla relacional LiquidationIncomeOffset (void-safety + provenance).

-- AlterTable Liquidation (resumen financiero FIN-06, nullable = pre-FIN-06)
ALTER TABLE "Liquidation" ADD COLUMN     "grossExpenseAmountMinor" INTEGER,
ADD COLUMN     "adjustmentAmountMinor" INTEGER,
ADD COLUMN     "preIncomeAmountMinor" INTEGER,
ADD COLUMN     "incomeOffsetAmountMinor" INTEGER,
ADD COLUMN     "netDistributableAmountMinor" INTEGER,
ADD COLUMN     "incomeOffsetSnapshot" JSONB,
ADD COLUMN     "incomeOffsetsByCurrency" JSONB;

-- CreateTable LiquidationIncomeOffset
CREATE TABLE "LiquidationIncomeOffset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "liquidationId" TEXT NOT NULL,
    "incomeApplicationId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "originalAmountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "valuedAmountMinor" INTEGER NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidationIncomeOffset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LiquidationIncomeOffset_original_amount_positive" CHECK ("originalAmountMinor" > 0),
    CONSTRAINT "LiquidationIncomeOffset_valued_amount_positive" CHECK ("valuedAmountMinor" > 0)
);

-- AddForeignKey
ALTER TABLE "LiquidationIncomeOffset" ADD CONSTRAINT "LiquidationIncomeOffset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiquidationIncomeOffset" ADD CONSTRAINT "LiquidationIncomeOffset_liquidationId_fkey" FOREIGN KEY ("liquidationId") REFERENCES "Liquidation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiquidationIncomeOffset" ADD CONSTRAINT "LiquidationIncomeOffset_incomeApplicationId_fkey" FOREIGN KEY ("incomeApplicationId") REFERENCES "IncomeApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "LiquidationIncomeOffset_liquidationId_incomeApplicationId_key" ON "LiquidationIncomeOffset"("liquidationId", "incomeApplicationId");
CREATE INDEX "LiquidationIncomeOffset_tenantId_idx" ON "LiquidationIncomeOffset"("tenantId");
CREATE INDEX "LiquidationIncomeOffset_incomeApplicationId_idx" ON "LiquidationIncomeOffset"("incomeApplicationId");
CREATE INDEX "LiquidationIncomeOffset_liquidationId_idx" ON "LiquidationIncomeOffset"("liquidationId");
CREATE INDEX "LiquidationIncomeOffset_tenantId_liquidationId_idx" ON "LiquidationIncomeOffset"("tenantId", "liquidationId");

-- CreateEnum
CREATE TYPE "LiquidationValuationMode" AS ENUM ('FUNCTIONAL', 'LEGACY_NOMINAL');

-- AlterTable
ALTER TABLE "Liquidation" ADD COLUMN     "valuationMode" "LiquidationValuationMode";

-- AlterTable
ALTER TABLE "MovementAllocation" ADD COLUMN     "functionalAmountMinor" INTEGER,
ADD COLUMN     "functionalCurrencyCode" TEXT;

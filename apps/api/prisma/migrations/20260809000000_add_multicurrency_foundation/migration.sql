ALTER TABLE "Tenant" ADD COLUMN "functionalCurrency" TEXT;

UPDATE "Tenant" SET "functionalCurrency" = "currency"
WHERE "currency" IN ('USD', 'VES', 'ARS', 'COP');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Tenant" WHERE "functionalCurrency" IS NULL) THEN
    RAISE EXCEPTION 'Multicurrency migration blocked: Tenant.currency contains non-canonical values';
  END IF;
END $$;

ALTER TABLE "Tenant" ALTER COLUMN "functionalCurrency" SET NOT NULL;
ALTER TABLE "Tenant" ALTER COLUMN "functionalCurrency" SET DEFAULT 'ARS';

CREATE TABLE "ExchangeRate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "baseCurrency" TEXT NOT NULL,
  "quoteCurrency" TEXT NOT NULL,
  "rate" DECIMAL(28,12) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "source" TEXT,
  "createdByMembershipId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExchangeRate_rate_positive_check" CHECK ("rate" > 0),
  CONSTRAINT "ExchangeRate_distinct_currency_check" CHECK ("baseCurrency" <> "quoteCurrency")
);

CREATE UNIQUE INDEX "ExchangeRate_tenant_pair_effective_key" ON "ExchangeRate"("tenantId", "baseCurrency", "quoteCurrency", "effectiveAt");
CREATE INDEX "ExchangeRate_tenant_pair_effective_idx" ON "ExchangeRate"("tenantId", "baseCurrency", "quoteCurrency", "effectiveAt" DESC);
CREATE INDEX "ExchangeRate_createdByMembershipId_idx" ON "ExchangeRate"("createdByMembershipId");
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FIN-02: Funds + FundTransactions (ledger auditable por moneda)
-- ADITIVA: no altera datos financieros existentes.

-- CreateEnum
CREATE TYPE "FundScopeType" AS ENUM ('TENANT', 'BUILDING');

-- CreateEnum
CREATE TYPE "FundType" AS ENUM ('RESERVE', 'SPECIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FundStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FundTransactionDirection" AS ENUM ('CREDIT', 'DEBIT');

-- AlterEnum AuditAction (valores FUND_*)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FUND_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FUND_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FUND_ARCHIVE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FUND_TRANSACTION_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FUND_TRANSACTION_REVERSE';

-- CreateTable Fund
CREATE TABLE "Fund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "scopeType" "FundScopeType" NOT NULL,
    "type" "FundType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FundStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByMembershipId" TEXT NOT NULL,
    "archivedByMembershipId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateTable FundTransaction
CREATE TABLE "FundTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "direction" "FundTransactionDirection" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "createdByMembershipId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "reversalOfTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FundTransaction_amountMinor_positive" CHECK ("amountMinor" > 0)
);

-- CheckConstraint Fund scope invariant (FIN-02Q)
-- scopeType TENANT => buildingId NULL; scopeType BUILDING => buildingId NOT NULL
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_scope_building_invariant" CHECK (
  ("scopeType" = 'TENANT' AND "buildingId" IS NULL)
  OR
  ("scopeType" = 'BUILDING' AND "buildingId" IS NOT NULL)
);

-- AddForeignKey Fund
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_archivedByMembershipId_fkey" FOREIGN KEY ("archivedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey FundTransaction
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_reversalOfTransactionId_fkey" FOREIGN KEY ("reversalOfTransactionId") REFERENCES "FundTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex Fund
CREATE INDEX "Fund_tenantId_idx" ON "Fund"("tenantId");
CREATE INDEX "Fund_tenantId_buildingId_idx" ON "Fund"("tenantId", "buildingId");
CREATE INDEX "Fund_tenantId_status_idx" ON "Fund"("tenantId", "status");
CREATE INDEX "Fund_tenantId_scopeType_idx" ON "Fund"("tenantId", "scopeType");

-- Unique activo por nombre normalizado (FIN-02R)
-- Protección DB contra duplicados concurrentes del MISMO nombre activo en el
-- mismo scope. Normalización: trim + lower + colapso de espacios internos
-- (misma semántica que el service assertNoActiveDuplicateName). Se permiten:
-- mismo nombre en edificios distintos, y reutilizar un nombre cuyo fondo
-- anterior esté ARCHIVED.
CREATE UNIQUE INDEX "Fund_active_name_tenant_key"
ON "Fund" ("tenantId", lower(regexp_replace(trim("name"), '\s+', ' ', 'g')))
WHERE "scopeType" = 'TENANT' AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "Fund_active_name_building_key"
ON "Fund" ("tenantId", "buildingId", lower(regexp_replace(trim("name"), '\s+', ' ', 'g')))
WHERE "scopeType" = 'BUILDING' AND "status" = 'ACTIVE';

-- CreateIndex FundTransaction
CREATE UNIQUE INDEX "FundTransaction_tenantId_idempotencyKey_key" ON "FundTransaction"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "FundTransaction_reversalOfTransactionId_key" ON "FundTransaction"("reversalOfTransactionId");
CREATE INDEX "FundTransaction_tenantId_fundId_idx" ON "FundTransaction"("tenantId", "fundId");
CREATE INDEX "FundTransaction_tenantId_fundId_createdAt_idx" ON "FundTransaction"("tenantId", "fundId", "createdAt");
CREATE INDEX "FundTransaction_tenantId_fundId_currencyCode_idx" ON "FundTransaction"("tenantId", "fundId", "currencyCode");
CREATE INDEX "FundTransaction_tenantId_currencyCode_idx" ON "FundTransaction"("tenantId", "currencyCode");

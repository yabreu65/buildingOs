/*
  Warnings:

  - You are about to drop the column `userId` on the `UnitOccupant` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[tenantId,code]` on the table `ExpenseLedgerCategory` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,expenseId,buildingId]` on the table `MovementAllocation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,incomeId,buildingId]` on the table `MovementAllocation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[unitId,memberId]` on the table `UnitOccupant` will be added. If there are existing duplicate values, this will fail.
  - Made the column `tenantId` on table `UnitOccupant` required. This step will fail if there are existing NULL values in that column.
  - Made the column `memberId` on table `UnitOccupant` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "CatalogScope" AS ENUM ('BUILDING', 'CONDOMINIUM_COMMON');

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('MONTO_INCORRECTO', 'REFERENCIA_INVALIDA', 'SIN_COMPROBANTE', 'COMPROBANTE_ILEGIBLE', 'PAGO_DUPLICADO', 'CUENTA_DESTINO_INVALIDA', 'OTRO');

-- CreateEnum
CREATE TYPE "CommunicationPriority" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('DRAFT', 'VALIDATED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentAuditAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'RECONCILED', 'CANCELLED', 'VIEWED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TENANT_MEMBER_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_MEMBER_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_MEMBER_INVITED';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_MEMBER_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'INCOME_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'INCOME_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'INCOME_RECORD';
ALTER TYPE "AuditAction" ADD VALUE 'INCOME_VOID';
ALTER TYPE "AuditAction" ADD VALUE 'INCOME_ALLOCATION_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'UNIT_GROUP_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'UNIT_GROUP_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'UNIT_GROUP_MEMBER_ADD';
ALTER TYPE "AuditAction" ADD VALUE 'UNIT_GROUP_MEMBER_REMOVE';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_ALLOCATION_CREATE';

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_unitGroupId_fkey";

-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_buildingId_fkey";

-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_unitGroupId_fkey";

-- DropForeignKey
ALTER TABLE "MovementAllocation" DROP CONSTRAINT "MovementAllocation_buildingId_fkey";

-- DropForeignKey
ALTER TABLE "MovementAllocation" DROP CONSTRAINT "MovementAllocation_expenseId_fkey";

-- DropForeignKey
ALTER TABLE "MovementAllocation" DROP CONSTRAINT "MovementAllocation_incomeId_fkey";

-- DropForeignKey
ALTER TABLE "MovementAllocation" DROP CONSTRAINT "MovementAllocation_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "UnitGroup" DROP CONSTRAINT "UnitGroup_buildingId_fkey";

-- DropForeignKey
ALTER TABLE "UnitGroup" DROP CONSTRAINT "UnitGroup_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "UnitGroupMember" DROP CONSTRAINT "UnitGroupMember_unitGroupId_fkey";

-- DropForeignKey
ALTER TABLE "UnitGroupMember" DROP CONSTRAINT "UnitGroupMember_unitId_fkey";

-- DropForeignKey
ALTER TABLE "UnitOccupant" DROP CONSTRAINT "UnitOccupant_userId_fkey";

-- DropIndex
DROP INDEX "Charge_overdueSince_dueDate_idx";

-- DropIndex
DROP INDEX "Ticket_status_priority_escalatedAt_createdAt_idx";

-- DropIndex
DROP INDEX "UnitOccupant_unitId_userId_role_key";

-- DropIndex
DROP INDEX "UnitOccupant_userId_idx";

-- AlterTable
ALTER TABLE "Communication" ADD COLUMN     "priority" "CommunicationPriority" NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "liquidationPeriod" TEXT;

-- AlterTable
ALTER TABLE "ExpenseLedgerCategory" ADD COLUMN     "catalogScope" "CatalogScope" NOT NULL DEFAULT 'BUILDING';

-- AlterTable
ALTER TABLE "Liquidation" ADD COLUMN     "chargePeriod" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "destinationAccount" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "rejectionComment" TEXT,
ADD COLUMN     "rejectionReason" "RejectionReason",
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "sourceAccount" TEXT,
ADD COLUMN     "sourceBank" TEXT,
ADD COLUMN     "sourceHolder" TEXT,
ADD COLUMN     "transferDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UnitOccupant" DROP COLUMN "userId",
ALTER COLUMN "tenantId" SET NOT NULL,
ALTER COLUMN "memberId" SET NOT NULL;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategoryVendorPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategoryVendorPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "sourceInvoiceDate" TIMESTAMP(3) NOT NULL,
    "sourcePeriod" TEXT NOT NULL,
    "targetPeriod" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByMembershipId" TEXT NOT NULL,
    "validatedByMembershipId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "voidedByMembershipId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "action" "PaymentAuditAction" NOT NULL,
    "membershipId" TEXT,
    "reason" TEXT,
    "comment" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushSubscription_tenantId_userId_idx" ON "PushSubscription"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "PushSubscription_tenantId_revokedAt_idx" ON "PushSubscription"("tenantId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_tenantId_userId_endpoint_key" ON "PushSubscription"("tenantId", "userId", "endpoint");

-- CreateIndex
CREATE INDEX "ExpenseCategoryVendorPreference_tenantId_idx" ON "ExpenseCategoryVendorPreference"("tenantId");

-- CreateIndex
CREATE INDEX "ExpenseCategoryVendorPreference_tenantId_categoryId_idx" ON "ExpenseCategoryVendorPreference"("tenantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategoryVendorPreference_tenantId_categoryId_key" ON "ExpenseCategoryVendorPreference"("tenantId", "categoryId");

-- CreateIndex
CREATE INDEX "Adjustment_tenantId_buildingId_targetPeriod_status_idx" ON "Adjustment"("tenantId", "buildingId", "targetPeriod", "status");

-- CreateIndex
CREATE INDEX "Adjustment_tenantId_buildingId_sourcePeriod_idx" ON "Adjustment"("tenantId", "buildingId", "sourcePeriod");

-- CreateIndex
CREATE INDEX "Adjustment_tenantId_status_idx" ON "Adjustment"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PaymentAuditLog_paymentId_createdAt_idx" ON "PaymentAuditLog"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAuditLog_tenantId_action_createdAt_idx" ON "PaymentAuditLog"("tenantId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAuditLog_membershipId_createdAt_idx" ON "PaymentAuditLog"("membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "Expense_tenantId_buildingId_liquidationPeriod_status_idx" ON "Expense"("tenantId", "buildingId", "liquidationPeriod", "status");

-- CreateIndex
CREATE INDEX "ExpenseLedgerCategory_tenantId_movementType_catalogScope_idx" ON "ExpenseLedgerCategory"("tenantId", "movementType", "catalogScope");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseLedgerCategory_tenantId_code_key" ON "ExpenseLedgerCategory"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Liquidation_tenantId_buildingId_chargePeriod_status_idx" ON "Liquidation"("tenantId", "buildingId", "chargePeriod", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MovementAllocation_tenantId_expenseId_buildingId_key" ON "MovementAllocation"("tenantId", "expenseId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "MovementAllocation_tenantId_incomeId_buildingId_key" ON "MovementAllocation"("tenantId", "incomeId", "buildingId");

-- CreateIndex
CREATE INDEX "UnitOccupant_tenantId_memberId_idx" ON "UnitOccupant"("tenantId", "memberId");

-- CreateIndex
CREATE INDEX "UnitOccupant_unitId_isPrimary_idx" ON "UnitOccupant"("unitId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOccupant_unitId_memberId_key" ON "UnitOccupant"("unitId", "memberId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_unitGroupId_fkey" FOREIGN KEY ("unitGroupId") REFERENCES "UnitGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseLedgerCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_unitGroupId_fkey" FOREIGN KEY ("unitGroupId") REFERENCES "UnitGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementAllocation" ADD CONSTRAINT "MovementAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementAllocation" ADD CONSTRAINT "MovementAllocation_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementAllocation" ADD CONSTRAINT "MovementAllocation_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementAllocation" ADD CONSTRAINT "MovementAllocation_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitGroup" ADD CONSTRAINT "UnitGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitGroup" ADD CONSTRAINT "UnitGroup_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitGroupMember" ADD CONSTRAINT "UnitGroupMember_unitGroupId_fkey" FOREIGN KEY ("unitGroupId") REFERENCES "UnitGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitGroupMember" ADD CONSTRAINT "UnitGroupMember_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseLedgerCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAuditLog" ADD CONSTRAINT "PaymentAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAuditLog" ADD CONSTRAINT "PaymentAuditLog_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAuditLog" ADD CONSTRAINT "PaymentAuditLog_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

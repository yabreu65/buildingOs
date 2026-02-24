-- CreateEnum
CREATE TYPE "LeadIntent" AS ENUM ('DEMO', 'CONTACT');

-- CreateEnum
CREATE TYPE "PaymentVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_PAST_DUE';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBERSHIP_INVITE_RESENT';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBERSHIP_INVITE_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'DEMO_SEED_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_INTERACTION';
ALTER TYPE "AuditAction" ADD VALUE 'AI_TEMPLATE_RUN';
ALTER TYPE "AuditAction" ADD VALUE 'AI_BUDGET_WARNED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_BUDGET_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_BUDGET_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_DEGRADED_BUDGET';
ALTER TYPE "AuditAction" ADD VALUE 'AI_LIMIT_WARNED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_LIMIT_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_TENANT_OVERRIDE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_PLAN_CAPS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PLAN_CHANGE_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'PLAN_CHANGE_REQUEST_CANCELED';
ALTER TYPE "AuditAction" ADD VALUE 'PLAN_CHANGE_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'PLAN_CHANGE_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_CONVERTED';

-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'LEAD_NOTIFICATION';

-- DropForeignKey
ALTER TABLE "AiActionEvent" DROP CONSTRAINT "AiActionEvent_interactionId_fkey";

-- DropForeignKey
ALTER TABLE "AiActionEvent" DROP CONSTRAINT "AiActionEvent_membershipId_fkey";

-- DropForeignKey
ALTER TABLE "AiActionEvent" DROP CONSTRAINT "AiActionEvent_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "AiInteractionLog" DROP CONSTRAINT "AiInteractionLog_membershipId_fkey";

-- DropForeignKey
ALTER TABLE "AiInteractionLog" DROP CONSTRAINT "AiInteractionLog_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "AiInteractionLog" DROP CONSTRAINT "AiInteractionLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "SupportTicket" DROP CONSTRAINT "SupportTicket_assignedToUserId_fkey";

-- DropForeignKey
ALTER TABLE "SupportTicket" DROP CONSTRAINT "SupportTicket_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "SupportTicket" DROP CONSTRAINT "SupportTicket_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "SupportTicketComment" DROP CONSTRAINT "SupportTicketComment_authorUserId_fkey";

-- DropForeignKey
ALTER TABLE "SupportTicketComment" DROP CONSTRAINT "SupportTicketComment_supportTicketId_fkey";

-- AlterTable
ALTER TABLE "BillingPlan" ADD COLUMN     "aiAllowBigModel" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiBudgetCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiCallsMonthlyLimit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "canUseAI" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "intent" "LeadIntent" NOT NULL DEFAULT 'CONTACT';

-- CreateTable
CREATE TABLE "PlanChangeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedPlanId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByMembershipId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "note" TEXT,
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "PlanChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentVerification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "bankDetails" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scopeType" "ScopeType" NOT NULL DEFAULT 'TENANT',
    "requiredPermissions" JSONB NOT NULL,
    "enabledByDefault" BOOLEAN NOT NULL DEFAULT true,
    "promptSystem" TEXT,
    "promptUser" TEXT NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 350,
    "category" TEXT NOT NULL DEFAULT 'general',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantDailyAiUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantDailyAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAiBudget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "monthlyBudgetCents" INTEGER NOT NULL DEFAULT 500,
    "monthlyCallsLimit" INTEGER,
    "allowBigModelOverride" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAiBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMonthlyAiUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "warnedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "callsWarnedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMonthlyAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanChangeRequest_tenantId_status_idx" ON "PlanChangeRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PaymentVerification_tenantId_idx" ON "PaymentVerification"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentVerification_subscriptionId_idx" ON "PaymentVerification"("subscriptionId");

-- CreateIndex
CREATE INDEX "PaymentVerification_status_idx" ON "PaymentVerification"("status");

-- CreateIndex
CREATE INDEX "PaymentVerification_createdAt_idx" ON "PaymentVerification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiTemplate_key_key" ON "AiTemplate"("key");

-- CreateIndex
CREATE INDEX "AiTemplate_tenantId_isActive_idx" ON "AiTemplate"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "AiTemplate_category_isActive_idx" ON "AiTemplate"("category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AiTemplate_tenantId_key_key" ON "AiTemplate"("tenantId", "key");

-- CreateIndex
CREATE INDEX "TenantDailyAiUsage_tenantId_idx" ON "TenantDailyAiUsage"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantDailyAiUsage_tenantId_day_key" ON "TenantDailyAiUsage"("tenantId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAiBudget_tenantId_key" ON "TenantAiBudget"("tenantId");

-- CreateIndex
CREATE INDEX "TenantAiBudget_tenantId_idx" ON "TenantAiBudget"("tenantId");

-- CreateIndex
CREATE INDEX "TenantMonthlyAiUsage_tenantId_month_idx" ON "TenantMonthlyAiUsage"("tenantId", "month");

-- CreateIndex
CREATE INDEX "TenantMonthlyAiUsage_tenantId_idx" ON "TenantMonthlyAiUsage"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMonthlyAiUsage_tenantId_month_key" ON "TenantMonthlyAiUsage"("tenantId", "month");

-- CreateIndex
CREATE INDEX "Lead_intent_idx" ON "Lead"("intent");

-- AddForeignKey
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_requestedPlanId_fkey" FOREIGN KEY ("requestedPlanId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_requestedByMembershipId_fkey" FOREIGN KEY ("requestedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketComment" ADD CONSTRAINT "SupportTicketComment_supportTicketId_fkey" FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketComment" ADD CONSTRAINT "SupportTicketComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteractionLog" ADD CONSTRAINT "AiInteractionLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteractionLog" ADD CONSTRAINT "AiInteractionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteractionLog" ADD CONSTRAINT "AiInteractionLog_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionEvent" ADD CONSTRAINT "AiActionEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionEvent" ADD CONSTRAINT "AiActionEvent_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionEvent" ADD CONSTRAINT "AiActionEvent_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "AiInteractionLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTemplate" ADD CONSTRAINT "AiTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantDailyAiUsage" ADD CONSTRAINT "TenantDailyAiUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAiBudget" ADD CONSTRAINT "TenantAiBudget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMonthlyAiUsage" ADD CONSTRAINT "TenantMonthlyAiUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMonthlyAiUsage" ADD CONSTRAINT "TenantMonthlyAiUsage_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "TenantAiBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

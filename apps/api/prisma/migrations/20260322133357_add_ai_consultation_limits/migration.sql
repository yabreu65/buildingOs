-- Add AI consultation limit to BillingPlan
ALTER TABLE "BillingPlan" ADD COLUMN "aiConsultationsLimit" INTEGER NOT NULL DEFAULT 0;

-- Add AI consultation tracking to Subscription
ALTER TABLE "Subscription" ADD COLUMN "aiConsultationsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "aiConsultationsResetAt" TIMESTAMP(3);

-- CreateTable: PaymentProviderConfig
CREATE TABLE "PaymentProviderConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProcessedWebhookEvent
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EmailDelivery
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- Add payment gateway fields to Charge
ALTER TABLE "Charge" ADD COLUMN "paymentProviderId" TEXT;
ALTER TABLE "Charge" ADD COLUMN "paymentExternalId" TEXT;

-- Add webhook idempotency field to Payment
ALTER TABLE "Payment" ADD COLUMN "paymentEventId" TEXT;

-- CreateIndex: PaymentProviderConfig
CREATE UNIQUE INDEX "PaymentProviderConfig_tenantId_provider_key" ON "PaymentProviderConfig"("tenantId", "provider");
CREATE INDEX "PaymentProviderConfig_tenantId_idx" ON "PaymentProviderConfig"("tenantId");

-- CreateIndex: ProcessedWebhookEvent
CREATE UNIQUE INDEX "ProcessedWebhookEvent_eventId_provider_key" ON "ProcessedWebhookEvent"("eventId", "provider");
CREATE INDEX "ProcessedWebhookEvent_provider_idx" ON "ProcessedWebhookEvent"("provider");

-- CreateIndex: EmailDelivery
CREATE INDEX "EmailDelivery_tenantId_status_idx" ON "EmailDelivery"("tenantId", "status");
CREATE INDEX "EmailDelivery_messageId_idx" ON "EmailDelivery"("messageId");

-- CreateIndex: Charge payment gateway fields
CREATE INDEX "Charge_paymentExternalId_idx" ON "Charge"("paymentExternalId");

-- AddForeignKey: PaymentProviderConfig -> Tenant
ALTER TABLE "PaymentProviderConfig" ADD CONSTRAINT "PaymentProviderConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Charge -> PaymentProviderConfig
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_paymentProviderId_fkey" FOREIGN KEY ("paymentProviderId") REFERENCES "PaymentProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: EmailDelivery -> Tenant
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddColumn for currency and locale to Tenant
ALTER TABLE "Tenant" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "Tenant" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'es-AR';

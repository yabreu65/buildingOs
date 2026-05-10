-- Dashboard debt aging performance indexes
CREATE INDEX "Payment_tenantId_paidAt_idx" ON "Payment"("tenantId", "paidAt");
CREATE INDEX "Charge_tenantId_dueDate_canceledAt_idx" ON "Charge"("tenantId", "dueDate", "canceledAt");

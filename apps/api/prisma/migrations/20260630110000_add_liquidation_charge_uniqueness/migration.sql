-- Prevent duplicate charges for the same liquidation/unit/accounting period.
-- PostgreSQL allows multiple NULL values, so manual charges with NULL liquidation_id remain unaffected.
CREATE UNIQUE INDEX "Charge_tenantId_liquidationId_unitId_period_key"
ON "Charge"("tenantId", "liquidationId", "unitId", "period");

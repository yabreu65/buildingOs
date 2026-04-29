-- RLS pilot for tenant-sensitive tables.
-- Phase 1 (safe rollout): policies are permissive when app.tenant_id is missing.
-- Once tenant context propagation is complete, switch to strict mode by removing the NULL bypass.

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '');
$$;

ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Charge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_tenant_isolation ON "Ticket";
CREATE POLICY ticket_tenant_isolation
ON "Ticket"
USING (
  current_tenant_id() IS NULL OR "tenantId" = current_tenant_id()
)
WITH CHECK (
  current_tenant_id() IS NULL OR "tenantId" = current_tenant_id()
);

DROP POLICY IF EXISTS charge_tenant_isolation ON "Charge";
CREATE POLICY charge_tenant_isolation
ON "Charge"
USING (
  current_tenant_id() IS NULL OR "tenantId" = current_tenant_id()
)
WITH CHECK (
  current_tenant_id() IS NULL OR "tenantId" = current_tenant_id()
);

DROP POLICY IF EXISTS payment_tenant_isolation ON "Payment";
CREATE POLICY payment_tenant_isolation
ON "Payment"
USING (
  current_tenant_id() IS NULL OR "tenantId" = current_tenant_id()
)
WITH CHECK (
  current_tenant_id() IS NULL OR "tenantId" = current_tenant_id()
);

DROP POLICY IF EXISTS payment_allocation_tenant_isolation ON "PaymentAllocation";
CREATE POLICY payment_allocation_tenant_isolation
ON "PaymentAllocation"
USING (
  current_tenant_id() IS NULL OR "tenantId" = current_tenant_id()
)
WITH CHECK (
  current_tenant_id() IS NULL OR "tenantId" = current_tenant_id()
);

-- RLS strict mode toggle.
-- Usage:
--   SET app.rls_mode = 'strict';     -- deny access when app.tenant_id is missing
--   SET app.rls_mode = 'permissive'; -- allow legacy queries without app.tenant_id

CREATE OR REPLACE FUNCTION current_rls_mode()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.rls_mode', true), ''), 'permissive');
$$;

CREATE OR REPLACE FUNCTION tenant_scope_allows(row_tenant_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_tenant_id() IS NOT NULL THEN row_tenant_id = current_tenant_id()
    WHEN current_rls_mode() = 'strict' THEN FALSE
    ELSE TRUE
  END;
$$;

DROP POLICY IF EXISTS ticket_tenant_isolation ON "Ticket";
CREATE POLICY ticket_tenant_isolation
ON "Ticket"
USING (tenant_scope_allows("tenantId"))
WITH CHECK (tenant_scope_allows("tenantId"));

DROP POLICY IF EXISTS charge_tenant_isolation ON "Charge";
CREATE POLICY charge_tenant_isolation
ON "Charge"
USING (tenant_scope_allows("tenantId"))
WITH CHECK (tenant_scope_allows("tenantId"));

DROP POLICY IF EXISTS payment_tenant_isolation ON "Payment";
CREATE POLICY payment_tenant_isolation
ON "Payment"
USING (tenant_scope_allows("tenantId"))
WITH CHECK (tenant_scope_allows("tenantId"));

DROP POLICY IF EXISTS payment_allocation_tenant_isolation ON "PaymentAllocation";
CREATE POLICY payment_allocation_tenant_isolation
ON "PaymentAllocation"
USING (tenant_scope_allows("tenantId"))
WITH CHECK (tenant_scope_allows("tenantId"));

-- Ensure table owners do not bypass RLS policies.
-- Required for strict-mode guarantees under application DB role.

ALTER TABLE "Ticket" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Charge" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAllocation" FORCE ROW LEVEL SECURITY;

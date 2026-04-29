import { readFileSync } from 'fs';
import { join } from 'path';

describe('RLS policy migrations', () => {
  const root = process.cwd();
  const pilotMigrationPath = join(
    root,
    'prisma/migrations/20260423170000_add_rls_pilot_tenant_tables/migration.sql',
  );
  const strictTogglePath = join(
    root,
    'prisma/migrations/20260423174500_add_rls_strict_mode_toggle/migration.sql',
  );
  const forceRlsPath = join(
    root,
    'prisma/migrations/20260423190000_force_rls_on_pilot_tables/migration.sql',
  );

  it('enables RLS pilot for critical tenant tables', () => {
    const sql = readFileSync(pilotMigrationPath, 'utf8');

    expect(sql).toContain('ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "Charge" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;');
  });

  it('defines strict-mode deny path when tenant context is missing', () => {
    const sql = readFileSync(strictTogglePath, 'utf8');

    expect(sql).toContain("CREATE OR REPLACE FUNCTION current_rls_mode()");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION tenant_scope_allows(row_tenant_id text)");
    expect(sql).toContain("WHEN current_rls_mode() = 'strict' THEN FALSE");
  });

  it('applies tenant_scope_allows to all pilot table policies', () => {
    const sql = readFileSync(strictTogglePath, 'utf8');

    expect(sql).toContain('CREATE POLICY ticket_tenant_isolation');
    expect(sql).toContain('ON "Ticket"');
    expect(sql).toContain('CREATE POLICY charge_tenant_isolation');
    expect(sql).toContain('ON "Charge"');
    expect(sql).toContain('CREATE POLICY payment_tenant_isolation');
    expect(sql).toContain('ON "Payment"');
    expect(sql).toContain('CREATE POLICY payment_allocation_tenant_isolation');
    expect(sql).toContain('ON "PaymentAllocation"');
    expect((sql.match(/tenant_scope_allows\("tenantId"\)/g) || []).length).toBeGreaterThanOrEqual(8);
  });

  it('forces RLS on pilot tables so owner cannot bypass policies', () => {
    const sql = readFileSync(forceRlsPath, 'utf8');

    expect(sql).toContain('ALTER TABLE "Ticket" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "Charge" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "PaymentAllocation" FORCE ROW LEVEL SECURITY;');
  });
});

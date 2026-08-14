import { PaymentStatus } from '@prisma/client';
import { FinanceSummaryService } from './finance-summary.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { EmailService } from '../email/email.service';

const APPROVED = PaymentStatus.APPROVED;
const RECONCILED = PaymentStatus.RECONCILED;
const SUBMITTED = PaymentStatus.SUBMITTED;

// The service resolves "last month" from the current date; fixtures must
// use that same period so the MONTHLY ACTIVITY filter matches them.
function lastMonthPeriod(): string {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const PERIOD = lastMonthPeriod();

interface ChargeFixture {
  id?: string;
  unitId?: string;
  amount: number;
  currency?: string;
  period?: string;
  dueDate?: Date;
  canceledAt?: Date | null;
  liquidationId?: string | null;
  allocations?: Array<{ amount: number; payment?: { status?: string | null } | null }>;
  unitLabel?: string;
  buildingName?: string;
}

function charge({
  id = 'chg-1',
  unitId = 'unit-1',
  amount,
  currency = 'ARS',
  period = PERIOD,
  dueDate = new Date('2024-01-15T00:00:00Z'),
  canceledAt = null,
  liquidationId = 'liq-1',
  allocations = [],
  unitLabel = 'Apt 1',
  buildingName = 'Building 1',
}: ChargeFixture) {
  return {
    id,
    unitId,
    amount,
    currency,
    period,
    dueDate,
    canceledAt,
    liquidationId,
    tenantId: 'tenant-1',
    unit: { id: unitId, label: unitLabel, building: { name: buildingName } },
    paymentAllocations: allocations,
  };
}

describe('FinanceSummaryService', () => {
  let service: FinanceSummaryService;
  let membershipFindMany: jest.Mock;
  let chargeFindMany: jest.Mock;
  let sendEmail: jest.Mock;

  function mockCharges(charges: unknown[]) {
    chargeFindMany.mockResolvedValueOnce(charges).mockResolvedValue(charges);
  }

  function mockQueries(reportCharges: unknown[], delinquentCharges: unknown[]) {
    chargeFindMany.mockResolvedValueOnce(reportCharges).mockResolvedValue(delinquentCharges);
  }

  function mockAdmins(entries: Array<{ tenantId: string; tenantName: string; email: string }>) {
    membershipFindMany.mockResolvedValue(
      entries.map((e) => ({
        tenantId: e.tenantId,
        tenant: { id: e.tenantId, name: e.tenantName },
        user: { id: `u-${e.email}`, email: e.email },
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
      })),
    );
  }

  function mockAdminsWithRoles(
    entries: Array<{
      tenantId: string;
      tenantName: string;
      email: string;
      roles: Array<{ role: string; scopeType: string }>;
    }>,
  ) {
    // Simulate the database filter: Prisma returns only memberships whose
    // MembershipRole matches the query (role + scopeType).
    membershipFindMany.mockImplementation((args: { where: { roles: { some: { role: string; scopeType: string } } } }) => {
      const { role, scopeType } = args.where.roles.some;
      return Promise.resolve(
        entries
          .filter((e) => e.roles.some((r) => r.role === role && r.scopeType === scopeType))
          .map((e) => ({
            tenantId: e.tenantId,
            tenant: { id: e.tenantId, name: e.tenantName },
            user: { id: `u-${e.email}`, email: e.email },
            roles: e.roles,
          })),
      );
    });
  }

  beforeEach(() => {
    membershipFindMany = jest.fn().mockResolvedValue([]);
    chargeFindMany = jest.fn().mockResolvedValue([]);
    sendEmail = jest.fn().mockResolvedValue({ ok: true });
    const prisma = {
      membership: { findMany: membershipFindMany },
      charge: { findMany: chargeFindMany },
    } as unknown as PrismaService;
    const email = { sendEmail } as unknown as EmailService;
    service = new FinanceSummaryService(prisma, email);
  });

  describe('charge-side currency-safe aggregation', () => {
    it('A: single currency — exact buckets, no mixed totals', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([
        charge({ amount: 10000, allocations: [{ amount: 4000, payment: { status: APPROVED } }] }),
        charge({ id: 'chg-2', unitId: 'unit-2', amount: 20000 }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(sendEmail.mock.calls[0][0].subject).toBe(
        'Tenant A - Resumen Financiero ' +
          new Date(new Date().getFullYear(), new Date().getMonth() - 1).toLocaleDateString(
            'es-AR',
            { month: 'long', year: 'numeric' },
          ),
      );
      // 30000 charges, 4000 paid, 26000 outstanding, rate 13
      expect(html).toContain('300,00');
      expect(html).toContain('40,00');
      expect(html).toContain('260,00');
      expect(html).toContain('13% ARS');
      // Currency explicit, no bare $ mixed display
      expect(html).not.toContain('$300');
    });

    it('B: multi-currency — canonical order USD, VES, ARS, COP, no global total', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([
        charge({ amount: 10000, currency: 'USD' }),
        charge({ id: 'c2', unitId: 'u2', amount: 5000, currency: 'VES' }),
        charge({ id: 'c3', unitId: 'u3', amount: 2000, currency: 'ARS' }),
        charge({ id: 'c4', unitId: 'u4', amount: 3000, currency: 'COP' }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      // Intl emits non-breaking spaces; normalize before matching.
      const flat = html.replace(/\u00A0/g, ' ');
      // Each currency appears with its own explicit label/symbol, in
      // canonical order USD -> VES -> ARS -> COP.
      const usdIndex = flat.indexOf('US$ 100,00');
      const vesIndex = flat.indexOf('VES 50,00');
      const arsIndex = flat.indexOf('$ 20,00');
      const copIndex = flat.indexOf('COP 30,00');
      expect(usdIndex).toBeGreaterThan(-1);
      expect(vesIndex).toBeGreaterThan(-1);
      expect(arsIndex).toBeGreaterThan(-1);
      expect(copIndex).toBeGreaterThan(-1);
      expect(usdIndex).toBeLessThan(vesIndex);
      expect(vesIndex).toBeLessThan(arsIndex);
      expect(arsIndex).toBeLessThan(copIndex);
      // No single nominal global total anywhere
      expect(html).not.toContain('Global');
    });

    it('C: CROSS — allocation in Charge currency, no USD bucket from original payment', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      // Payment was USD 5000 original; allocation covers ARS 182500
      mockCharges([
        charge({ amount: 182500, allocations: [{ amount: 182500, payment: { status: APPROVED } }] }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).toContain('1.825,00');
      expect(html).toContain('100% ARS');
      expect(html).not.toContain('US$ 5.000,00');
      expect(html).not.toContain('US$ 1825');
    });

    it('D: SUBMITTED excluded — not paid, not reducing outstanding', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([
        charge({ amount: 10000, allocations: [{ amount: 7000, payment: { status: SUBMITTED } }] }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).toContain('100,00');
      expect(html).toContain('0% ARS');
    });

    it('E: RECONCILED effective — counts as paid, reduces outstanding', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([
        charge({ amount: 10000, allocations: [{ amount: 10000, payment: { status: RECONCILED } }] }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).toContain('100% ARS');
    });

    it('F: overallocation bounded — collected never exceeds charge amount', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([
        charge({ amount: 10000, allocations: [{ amount: 12000, payment: { status: APPROVED } }] }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).toContain('100,00');
      expect(html).toContain('100% ARS');
      // No 120 collected anywhere
      expect(html).not.toContain('120,00');
    });
  });

  describe('legacy and malformed historical currencies', () => {
    it('G: legacy UYU renders explicitly — no ARS fallback, no throw', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([
        charge({ amount: 500000, currency: 'UYU' }),
        charge({ id: 'c2', unitId: 'u2', amount: 10000 }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).toContain('UYU');
      expect(html).toContain('5.000,00');
      // ARS bucket present too, UYU after canonical
      expect(html).toContain('100,00');
    });

    it('H: malformed codes US / empty / XX12 never throw', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([
        charge({ amount: 12345, currency: 'US' }),
        charge({ id: 'c2', unitId: 'u2', amount: 67890, currency: '' }),
        charge({ id: 'c3', unitId: 'u3', amount: 11111, currency: 'XX12' }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      // Malformed codes use the raw fallback format (major units, dot
      // separator): amount + raw code when the code exists.
      expect(html).toContain('123.45 US');
      expect(html).toContain('678.90');
      expect(html).toContain('111.11 XX12');
    });

    it('I: malicious currency code is HTML-escaped, never executable markup', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([
        charge({ amount: 10000, currency: '<script>alert(1)</script>' }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('J: tenant name and unit labels are HTML-escaped', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: '<b>Tenant</b>', email: 'admin@a.com' }]);
      mockCharges([
        charge({
          amount: 10000,
          dueDate: new Date('2024-01-01T00:00:00Z'),
          unitLabel: '<img src=x onerror=alert(1)>',
        }),
      ]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).not.toContain('<b>Tenant</b>');
      expect(html).toContain('&lt;b&gt;Tenant&lt;/b&gt;');
      expect(html).toContain('&lt;img');
    });
  });

  describe('empty contract and delivery boundary', () => {
    it('K: empty tenant renders deterministic placeholder, no invented ARS zero', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([]);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).toContain('—');
      expect(html).toContain('Sin unidades morosas');
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('[object Object]');
    });

    it('L: delivery boundary — recipients, subject and call count unchanged', async () => {
      mockAdmins([
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'admin1@a.com' },
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'admin2@a.com' },
        { tenantId: 't-2', tenantName: 'Tenant B', email: 'admin@b.com' },
      ]);
      mockCharges([charge({ amount: 10000 })]);

      const result = await service.sendMonthlyFinanceSummaries();

      expect(result.sentCount).toBe(3);
      expect(sendEmail).toHaveBeenCalledTimes(3);
      const emails = sendEmail.mock.calls.map((c) => c[0].to);
      expect(emails).toContain('admin1@a.com');
      expect(emails).toContain('admin2@a.com');
      expect(emails).toContain('admin@b.com');
      const subjects = sendEmail.mock.calls.map((c) => c[0].subject);
      expect(subjects[0]).toContain('Tenant A - Resumen Financiero');
      expect(subjects[2]).toContain('Tenant B - Resumen Financiero');
    });

    it('L2: recipient query filters TENANT_ADMIN via MembershipRole (schema-accurate)', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockCharges([charge({ amount: 10000 })]);

      await service.sendMonthlyFinanceSummaries();

      const callArgs = membershipFindMany.mock.calls[0][0];
      const memberWhere = callArgs.where;
      // roles.some(TENANT_ADMIN) matches the RBAC source of truth
      // (MembershipRole[]); the parallel TenantMember table is not used.
      expect(memberWhere.roles.some.role).toBe('TENANT_ADMIN');
    });
  });

  describe('period semantics (remediation)', () => {
    it('M1: MONTHLY ACTIVITY only includes charges of the requested period', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      // Charge B belongs to the previous period with a large amount and an
      // APPROVED allocation: it must not leak into this month's KPIs.
      mockQueries(
        [
          charge({ id: 'A', amount: 10000, period: PERIOD }),
        ],
        [
          charge({ id: 'B', amount: 900000, period: '2026-06', dueDate: new Date('2026-06-01T00:00:00Z') }),
        ],
      );

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      // The Facturado KPI block must only contain this month's charge
      // (10000 minor -> 100,00); the 900000 charge of another period must
      // not appear in the monthly KPIs (it may appear in delinquency).
      const facturadoBlock = html.split('Total Facturado')[1]!.split('Total Cobrado')[0]!;
      expect(facturadoBlock).toContain('100,00');
      expect(facturadoBlock).not.toContain('9.000,00');
      expect(facturadoBlock).not.toContain('910');
    });

    it('M2: old overdue unpaid debt stays in the CURRENT DELINQUENCY SNAPSHOT', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      // No charges in the current period; one old (2026-06) overdue unpaid
      // charge. Monthly KPIs must be empty; delinquency must show it.
      mockQueries(
        [],
        [
          charge({
            id: 'old',
            amount: 900000,
            period: '2026-06',
            dueDate: new Date('2026-06-01T00:00:00Z'),
          }),
        ],
      );

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      // Empty monthly KPIs use the placeholder.
      expect(html).toContain('—');
      // Delinquency snapshot still lists the old debt.
      expect(html).toContain('Unidades Morosas (1)');
      expect(html).toContain('9.000,00');
    });

    it('M3: the financial query passes the period filter', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockQueries([], []);

      await service.sendMonthlyFinanceSummaries();

      const firstCall = chargeFindMany.mock.calls[0][0];
      expect(firstCall.where.period).toBe(PERIOD);
      // Delinquency query (second call) must NOT filter by period.
      const secondCall = chargeFindMany.mock.calls[1][0];
      expect(secondCall.where).not.toHaveProperty('period');
    });
  });

  describe('delinquent count semantics (remediation)', () => {
    it('M4: count reflects the real total; preview is capped at 10', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      const units = Array.from({ length: 17 }, (_, i) =>
        charge({
          id: `c-${i}`,
          unitId: `unit-${i}`,
          amount: 1000,
          dueDate: new Date('2024-01-01T00:00:00Z'),
        }),
      );
      mockQueries([charge({ amount: 10000 })], units);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).toContain('Unidades Morosas (17)');
      // Preview renders 10 rows: one header + 10 unit rows.
      const previewCount = (html.match(/<tr>/g) ?? []).length - 1;
      expect(previewCount).toBe(10);
    });

    it('M5: a unit with several overdue charges counts exactly once', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      mockQueries(
        [charge({ amount: 10000 })],
        [
          charge({ id: 'c1', unitId: 'unit-x', amount: 1000, dueDate: new Date('2024-01-01T00:00:00Z') }),
          charge({ id: 'c2', unitId: 'unit-x', amount: 2000, dueDate: new Date('2024-02-01T00:00:00Z') }),
          charge({ id: 'c3', unitId: 'unit-y', amount: 3000, dueDate: new Date('2024-03-01T00:00:00Z') }),
        ],
      );

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).toContain('Unidades Morosas (2)');
    });

    it('M6: no pre-limit can corrupt the count (fails with the old take:100)', async () => {
      mockAdmins([{ tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com' }]);
      // 110 overdue charges: 10 units with 10 old charges each (100) plus
      // 5 units with 2 newer charges each (10). A take:100 pre-limit on
      // dueDate ASC would only see the first 10 units.
      const charges: unknown[] = [];
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          charges.push(
            charge({
              id: `old-${i}-${j}`,
              unitId: `unit-old-${i}`,
              amount: 1000,
              dueDate: new Date(`2024-01-${String(j + 1).padStart(2, '0')}T00:00:00Z`),
            }),
          );
        }
      }
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 2; j++) {
          charges.push(
            charge({
              id: `new-${i}-${j}`,
              unitId: `unit-new-${i}`,
              amount: 1000,
              dueDate: new Date(`2025-01-0${j + 1}T00:00:00Z`),
            }),
          );
        }
      }
      mockQueries([charge({ amount: 10000 })], charges);

      await service.sendMonthlyFinanceSummaries();

      const html = sendEmail.mock.calls[0][0].htmlBody as string;
      expect(html).toContain('Unidades Morosas (15)');
    });
  });

  describe('recipient scope (remediation)', () => {
    it('M7: only TENANT-scoped TENANT_ADMIN memberships receive the email', async () => {
      mockAdminsWithRoles([
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'tenant-admin@a.com', roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }] },
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'building-admin@a.com', roles: [{ role: 'TENANT_ADMIN', scopeType: 'BUILDING' }] },
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'unit-admin@a.com', roles: [{ role: 'TENANT_ADMIN', scopeType: 'UNIT' }] },
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'owner@a.com', roles: [{ role: 'TENANT_OWNER', scopeType: 'TENANT' }] },
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'operator@a.com', roles: [{ role: 'OPERATOR', scopeType: 'TENANT' }] },
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'resident@a.com', roles: [{ role: 'RESIDENT', scopeType: 'TENANT' }] },
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'norole@a.com', roles: [] },
      ]);
      mockCharges([charge({ amount: 10000 })]);

      const result = await service.sendMonthlyFinanceSummaries();

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0].to).toBe('tenant-admin@a.com');
      expect(result.sentCount).toBe(1);
    });

    it('M8: multi-role membership sends exactly one email', async () => {
      mockAdminsWithRoles([
        {
          tenantId: 't-1',
          tenantName: 'Tenant A',
          email: 'multi@a.com',
          roles: [
            { role: 'TENANT_ADMIN', scopeType: 'TENANT' },
            { role: 'OPERATOR', scopeType: 'BUILDING' },
            { role: 'RESIDENT', scopeType: 'UNIT' },
          ],
        },
      ]);
      mockCharges([charge({ amount: 10000 })]);

      const result = await service.sendMonthlyFinanceSummaries();

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0].to).toBe('multi@a.com');
      expect(result.sentCount).toBe(1);
    });

    it('M9: recipient query requires scopeType TENANT', async () => {
      mockAdminsWithRoles([
        { tenantId: 't-1', tenantName: 'Tenant A', email: 'admin@a.com', roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }] },
      ]);
      mockCharges([charge({ amount: 10000 })]);

      await service.sendMonthlyFinanceSummaries();

      const memberWhere = membershipFindMany.mock.calls[0][0].where;
      expect(memberWhere.roles.some).toMatchObject({
        role: 'TENANT_ADMIN',
        scopeType: 'TENANT',
      });
    });
  });
});

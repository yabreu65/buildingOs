import { InboxService } from './inbox.service';
import type { PrismaService } from '../prisma/prisma.service';

interface RawDelinquencyRow {
  readonly buildingId: string;
  readonly buildingName: string;
  readonly unitId: string;
  readonly unitCode: string;
  readonly currency: string;
  readonly amountMinor: bigint | number;
}

function makePrisma(
  payments: unknown[] = [],
  delinquencyRows: readonly RawDelinquencyRow[] = [],
  accessibleBuildingIds: readonly string[] = ['b-1'],
) {
  return {
    membership: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'm-1',
        userId: 'u-1',
        tenantId: 't-1',
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
      }),
    },
    building: { findMany: jest.fn().mockResolvedValue(accessibleBuildingIds.map((id) => ({ id }))) },
    charge: { findMany: jest.fn() },
    payment: {
      findMany: jest.fn().mockImplementation(async (args: { where: { tenantId: string } }) =>
        payments.filter((item) => (item as { tenantId: string }).tenantId === args.where.tenantId),
      ),
    },
    ticket: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    communication: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue(delinquencyRows),
  };
}

function payment(o: {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  method?: string;
  status?: string;
  buildingId?: string;
  createdAt?: Date;
}) {
  return {
    id: o.id,
    tenantId: o.tenantId,
    buildingId: o.buildingId || 'b-1',
    amount: o.amount,
    currency: o.currency,
    method: o.method || 'TRANSFER',
    status: o.status || 'SUBMITTED',
    createdAt: o.createdAt || new Date('2026-01-01T00:00:00Z'),
    proofFileId: null,
    building: { name: 'B1' },
    unit: { code: 'U1' },
  };
}

function queryText(query: unknown): string {
  return Array.from((query as { strings: TemplateStringsArray }).strings).join('');
}

function queryValues(query: unknown): readonly unknown[] {
  return (query as { values: readonly unknown[] }).values;
}

type DelinquentUnitsAccessor = {
  getDelinquentUnits(tenantId: string, buildingIds: string[]): Promise<unknown[]>;
};

describe('InboxService.getPaymentSummary', () => {
  it('exposes Payment.currency per payment (USD)', async () => {
    const svc = new InboxService(
      makePrisma([payment({ id: 'p1', tenantId: 't-1', amount: 12345, currency: 'USD' })]) as unknown as PrismaService,
    );

    const summary = await svc.getInboxSummary('u-1', 't-1', 'b-1', 20);
    const p = summary.payments[0];

    expect(p.amount).toBe(12345);
    expect(p.currency).toBe('USD');
  });

  it('keeps each payment currency distinct (USD + ARS multi)', async () => {
    const svc = new InboxService(
      makePrisma([
        payment({ id: 'p1', tenantId: 't-1', amount: 10000, currency: 'USD' }),
        payment({ id: 'p2', tenantId: 't-1', amount: 2000000, currency: 'ARS' }),
        payment({ id: 'p3', tenantId: 't-1', amount: 500000, currency: 'VES' }),
        payment({ id: 'p4', tenantId: 't-1', amount: 7000000, currency: 'COP' }),
      ]) as unknown as PrismaService,
    );

    const summary = await svc.getInboxSummary('u-1', 't-1', 'b-1', 20);

    expect(summary.payments.map((p) => p.currency)).toEqual(['USD', 'ARS', 'VES', 'COP']);
    expect(summary.payments.map((p) => p.amount)).toEqual([10000, 2000000, 500000, 7000000]);
  });

  it('excludes payments from other tenants (tenant isolation)', async () => {
    const svc = new InboxService(
      makePrisma([
        payment({ id: 'p1', tenantId: 't-1', amount: 10000, currency: 'USD' }),
        payment({ id: 'p2', tenantId: 't-other', amount: 999999, currency: 'ARS' }),
      ]) as unknown as PrismaService,
    );

    const summary = await svc.getInboxSummary('u-1', 't-1', 'b-1', 20);

    expect(summary.payments).toHaveLength(1);
    expect(summary.payments[0]!.id).toBe('p1');
    expect(summary.payments[0]!.currency).toBe('USD');
  });

  it('uses Payment.currency even when it differs from any tenant default', async () => {
    const svc = new InboxService(
      makePrisma([payment({ id: 'p1', tenantId: 't-1', amount: 12345, currency: 'UYU' })]) as unknown as PrismaService,
    );

    const summary = await svc.getInboxSummary('u-1', 't-1', 'b-1', 20);

    expect(summary.payments[0]!.currency).toBe('UYU');
  });
});

describe('InboxService delinquency query', () => {
  it('uses the parameterized raw CTE rather than charge.findMany', async () => {
    const prisma = makePrisma([], [{
      buildingId: 'b-1', buildingName: 'Building 1', unitId: 'u-1', unitCode: '1A', currency: 'ARS', amountMinor: BigInt(1200),
    }]);
    const svc = new InboxService(prisma as unknown as PrismaService);

    const summary = await svc.getInboxSummary('u-1', 't-1', 'b-1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.charge.findMany).not.toHaveBeenCalled();
    expect(summary.alerts.delinquentUnitsTop).toEqual([{
      buildingId: 'b-1', buildingName: 'Building 1', unitId: 'u-1', unitCode: '1A',
      outstandingByCurrency: [{ currency: 'ARS', amountMinor: 1200 }],
    }]);
  });

  it('returns no delinquency rows and does not query when the building scope is empty', async () => {
    const prisma = makePrisma();
    const svc = new InboxService(prisma as unknown as PrismaService);

    await expect((svc as unknown as DelinquentUnitsAccessor).getDelinquentUnits('t-1', [])).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.charge.findMany).not.toHaveBeenCalled();
  });

  it('preserves SQL top-unit ordering and aggregates multicurrency including historical UYU deterministically', async () => {
    const prisma = makePrisma([], [
      { buildingId: 'b-1', buildingName: 'Building 1', unitId: 'u-early-a', unitCode: 'A', currency: 'UYU', amountMinor: BigInt(400) },
      { buildingId: 'b-1', buildingName: 'Building 1', unitId: 'u-early-a', unitCode: 'A', currency: 'USD', amountMinor: BigInt(300) },
      { buildingId: 'b-1', buildingName: 'Building 1', unitId: 'u-early-a', unitCode: 'A', currency: 'ARS', amountMinor: BigInt(200) },
      { buildingId: 'b-1', buildingName: 'Building 1', unitId: 'u-early-b', unitCode: 'B', currency: 'VES', amountMinor: BigInt(100) },
      { buildingId: 'b-1', buildingName: 'Building 1', unitId: 'u-third', unitCode: 'C', currency: 'COP', amountMinor: BigInt(90) },
      { buildingId: 'b-1', buildingName: 'Building 1', unitId: 'u-fourth', unitCode: 'D', currency: 'ARS', amountMinor: BigInt(80) },
      { buildingId: 'b-1', buildingName: 'Building 1', unitId: 'u-fifth', unitCode: 'E', currency: 'USD', amountMinor: BigInt(70) },
    ]);
    const svc = new InboxService(prisma as unknown as PrismaService);

    const summary = await svc.getInboxSummary('u-1', 't-1', 'b-1');
    const query = queryText(prisma.$queryRaw.mock.calls[0]![0]);

    expect(summary.alerts.delinquentUnitsTop.map((unit) => unit.unitId)).toEqual([
      'u-early-a', 'u-early-b', 'u-third', 'u-fourth', 'u-fifth',
    ]);
    expect(summary.alerts.delinquentUnitsTop[0]!.outstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: 300 },
      { currency: 'ARS', amountMinor: 200 },
      { currency: 'UYU', amountMinor: 400 },
    ]);
    expect(query).toContain('top_units AS');
    expect(query).toContain('GROUP BY\n          charge."id",');
    expect(query).toContain('SUM(charge."amountMinor") AS "amountMinor"');
    expect(query).toContain('GROUP BY\n        top_units."tenantId",');
    expect(query).toContain('ORDER BY "earliestDue" ASC, "unitId" ASC');
    expect(query).toContain('LIMIT 5');
  });

  it('limits payments to effective, non-canceled allocations and scopes every joined tenant/building relation', async () => {
    const prisma = makePrisma([], [], ['b-allowed', 'b-other']);
    const svc = new InboxService(prisma as unknown as PrismaService);

    await svc.getInboxSummary('u-1', 'tenant-1', 'b-allowed');
    const rawQuery = prisma.$queryRaw.mock.calls[0]![0];
    const query = queryText(rawQuery);

    expect(queryValues(rawQuery)).toEqual(expect.arrayContaining(['tenant-1', 'b-allowed']));
    expect(queryValues(rawQuery)).not.toContain('b-other');
    expect(query).toContain("payment.\"status\" IN ('APPROVED', 'RECONCILED')");
    expect(query).toContain('payment."canceledAt" IS NULL');
    expect(query).toContain('GREATEST(');
    expect(query).toContain('allocation."tenantId" = charge."tenantId"');
    expect(query).toContain('payment."tenantId" = charge."tenantId"');
    expect(query).toContain('payment."buildingId" = charge."buildingId"');
    expect(query).toContain('unit."tenantId" = charge."tenantId"');
    expect(query).toContain('building."tenantId" = charge."tenantId"');
    expect(query).not.toContain('payment."amount"');
    expect(query).not.toContain('payment."currency"');
    expect(query).not.toContain('functionalAmountMinor');
    expect(query).not.toContain('exchangeRate');
  });
});

import { AiContextSummaryService } from './context-summary.service';

function makePrisma(rawResults: unknown[][]) {
  return {
    ticket: { findMany: jest.fn().mockResolvedValue([]) },
    payment: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'payment-usd',
          amount: 1200,
          currency: 'USD',
          status: 'SUBMITTED',
          building: { name: 'Torre A' },
          unit: { label: 'A-101' },
        },
        {
          id: 'payment-uyu',
          amount: 3400,
          currency: 'UYU',
          status: 'SUBMITTED',
          building: { name: 'Torre A' },
          unit: { label: 'A-102' },
        },
      ]),
    },
    document: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce(rawResults[0])
      .mockResolvedValueOnce(rawResults[1]),
  };
}

function queryText(prisma: { $queryRaw: jest.Mock }, index: number): string {
  return Array.from(prisma.$queryRaw.mock.calls[index][0] as TemplateStringsArray).join('');
}

describe('AiContextSummaryService currency-safe financial context', () => {
  let service: AiContextSummaryService | undefined;

  afterEach(() => {
    service?.onModuleDestroy();
  });

  it('keeps outstanding, pending, and delinquency amounts in stored-currency buckets', async () => {
    const prisma = makePrisma([
      [
        { currency: 'USD', outstanding: BigInt(1000) },
        { currency: 'COP', outstanding: BigInt(2500) },
        { currency: 'VES', outstanding: BigInt(3000) },
        { currency: 'UYU', outstanding: BigInt(4000) },
      ],
      [
        {
          buildingId: 'building-a',
          unitId: 'unit-a-101',
          building: 'Torre A',
          unit: 'A-101',
          currency: 'VES',
          outstanding: BigInt(50),
        },
        {
          buildingId: 'building-a',
          unitId: 'unit-a-101',
          building: 'Torre A',
          unit: 'A-101',
          currency: 'USD',
          outstanding: BigInt(1000),
        },
        {
          buildingId: 'building-b',
          unitId: 'unit-b-101',
          building: 'Torre B',
          unit: 'B-101',
          currency: 'COP',
          outstanding: BigInt(2000),
        },
      ],
    ]);
    service = new AiContextSummaryService(prisma as never);

    const result = await service.getSummary({
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      page: 'finance',
      userRoles: ['TENANT_ADMIN'],
    });

    expect(result.snapshot.kpis).toEqual({
      openTickets: 0,
      submittedPayments: 2,
      outstandingByCurrency: [
        { currency: 'USD', amountMinor: 1000 },
        { currency: 'VES', amountMinor: 3000 },
        { currency: 'COP', amountMinor: 2500 },
        { currency: 'UYU', amountMinor: 4000 },
      ],
    });
    expect(result.snapshot.pendingPayments).toEqual([
      expect.objectContaining({ currency: 'USD', amount: 1200 }),
      expect.objectContaining({ currency: 'UYU', amount: 3400 }),
    ]);
    expect(result.snapshot.topDelinquentUnits).toEqual([
      {
        building: 'Torre A',
        unit: 'A-101',
        outstandingByCurrency: [
          { currency: 'USD', amountMinor: 1000 },
          { currency: 'VES', amountMinor: 50 },
        ],
      },
      {
        building: 'Torre B',
        unit: 'B-101',
        outstandingByCurrency: [{ currency: 'COP', amountMinor: 2000 }],
      },
    ]);
    expect(result.snapshot.kpis).not.toHaveProperty('outstandingAmount');
    expect(result.snapshot.topDelinquentUnits[0]).not.toHaveProperty('outstanding');
  });

  it('uses canonical outstanding SQL for context totals and top delinquent units', async () => {
    const prisma = makePrisma([
      [{ currency: 'USD', outstanding: BigInt(6000) }],
      [{ buildingId: 'building-1', unitId: 'unit-1', building: 'Torre', unit: '101', currency: 'USD', outstanding: BigInt(6000) }],
    ]);
    service = new AiContextSummaryService(prisma as never);

    await service.getSummary({
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      buildingId: 'building-1',
      page: 'finance',
      userRoles: ['TENANT_ADMIN'],
    });

    const totalsQuery = queryText(prisma, 0);
    const delinquencyQuery = queryText(prisma, 1);

    for (const sql of [totalsQuery, delinquencyQuery]) {
      expect(sql).toContain('charge.amount - COALESCE');
      expect(sql).toContain("payment.status IN ('APPROVED', 'RECONCILED')");
      expect(sql).toContain('payment."canceledAt" IS NULL');
      expect(sql).toContain('charge."canceledAt" IS NULL');
      expect(sql).toContain("charge.status IN ('PENDING', 'PARTIAL')");
      expect(sql).toContain('allocation."tenantId" =');
      expect(sql).toContain('payment."tenantId" =');
      expect(sql).not.toContain('SUM(c.amount)');
    }
  });

  it('uses selected unit identities for all currency buckets before the five-unit boundary', async () => {
    const prisma = makePrisma([
      [],
      [
        { buildingId: 'building-1', unitId: 'unit-1', building: 'Torre', unit: '101', currency: 'USD', outstanding: BigInt(1) },
        { buildingId: 'building-1', unitId: 'unit-1', building: 'Torre', unit: '101', currency: 'UYU', outstanding: BigInt(2) },
        { buildingId: 'building-1', unitId: 'unit-1', building: 'Torre', unit: '101', currency: 'COP', outstanding: BigInt(3) },
        { buildingId: 'building-2', unitId: 'unit-2', building: 'Torre', unit: '101', currency: 'VES', outstanding: BigInt(4) },
        { buildingId: 'building-3', unitId: 'unit-3', building: 'Torre', unit: null, currency: 'USD', outstanding: BigInt(5) },
        { buildingId: 'building-4', unitId: 'unit-4', building: 'Torre', unit: null, currency: 'USD', outstanding: BigInt(6) },
        { buildingId: 'building-5', unitId: null, building: 'Torre', unit: null, currency: 'USD', outstanding: BigInt(7) },
      ],
    ]);
    service = new AiContextSummaryService(prisma as never);

    const result = await service.getSummary({
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      page: 'finance',
      userRoles: ['TENANT_ADMIN'],
    });

    expect(result.snapshot.topDelinquentUnits).toEqual([
      {
        building: 'Torre',
        unit: '101',
        outstandingByCurrency: [
          { currency: 'USD', amountMinor: 1 },
          { currency: 'COP', amountMinor: 3 },
          { currency: 'UYU', amountMinor: 2 },
        ],
      },
      {
        building: 'Torre',
        unit: '101',
        outstandingByCurrency: [{ currency: 'VES', amountMinor: 4 }],
      },
      {
        building: 'Torre',
        unit: 'N/A',
        outstandingByCurrency: [{ currency: 'USD', amountMinor: 5 }],
      },
      {
        building: 'Torre',
        unit: 'N/A',
        outstandingByCurrency: [{ currency: 'USD', amountMinor: 6 }],
      },
      {
        building: 'Torre',
        unit: 'N/A',
        outstandingByCurrency: [{ currency: 'USD', amountMinor: 7 }],
      },
    ]);
    expect(result.snapshot.topDelinquentUnits).toHaveLength(5);

    const query = queryText(prisma, 1);
    expect(query).toContain('selected_units AS');
    expect(query).toMatch(/LIMIT 5/);
    expect(query).toMatch(/ORDER BY[\s\S]*"earliestDueDate" ASC NULLS LAST[\s\S]*"buildingId" ASC[\s\S]*"unitId" ASC/);
    expect(query).not.toContain('.slice(0, 5)');
  });

  it('emits exact MAX_SAFE_INTEGER for totals and top delinquent units', async () => {
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    const prisma = makePrisma([
      [{ currency: 'USD', outstanding: maxSafe }],
      [
        {
          buildingId: 'building-1',
          unitId: 'unit-1',
          building: 'Torre',
          unit: '101',
          currency: 'USD',
          outstanding: maxSafe,
        },
      ],
    ]);
    service = new AiContextSummaryService(prisma as never);

    const result = await service.getSummary({
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      page: 'finance',
      userRoles: ['TENANT_ADMIN'],
    });

    expect(result.snapshot.kpis.outstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: Number.MAX_SAFE_INTEGER },
    ]);
    expect(result.snapshot.topDelinquentUnits).toEqual([
      {
        building: 'Torre',
        unit: '101',
        outstandingByCurrency: [{ currency: 'USD', amountMinor: Number.MAX_SAFE_INTEGER }],
      },
    ]);
  });

  it('omits totals above MAX_SAFE_INTEGER without blocking the summary', async () => {
    const overflow = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const prisma = makePrisma([
      [{ currency: 'USD', outstanding: overflow }],
      [
        {
          buildingId: 'building-1',
          unitId: 'unit-1',
          building: 'Torre',
          unit: '101',
          currency: 'USD',
          outstanding: BigInt(1000),
        },
      ],
    ]);
    service = new AiContextSummaryService(prisma as never);

    const result = await service.getSummary({
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      page: 'finance',
      userRoles: ['TENANT_ADMIN'],
    });

    expect(result.snapshot.kpis).toMatchObject({
      openTickets: 0,
      submittedPayments: 2,
      outstandingByCurrency: [],
    });
    expect(result.snapshot.topDelinquentUnits).toEqual([]);
  });

  it('omits per-unit delinquency values above MAX_SAFE_INTEGER while retaining totals', async () => {
    const overflow = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const prisma = makePrisma([
      [{ currency: 'USD', outstanding: BigInt(1000) }],
      [
        {
          buildingId: 'building-1',
          unitId: 'unit-1',
          building: 'Torre',
          unit: '101',
          currency: 'USD',
          outstanding: overflow,
        },
      ],
    ]);
    service = new AiContextSummaryService(prisma as never);

    const result = await service.getSummary({
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      page: 'finance',
      userRoles: ['TENANT_ADMIN'],
    });

    expect(result.snapshot.kpis.outstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: 1000 },
    ]);
    expect(result.snapshot.topDelinquentUnits).toEqual([]);
  });
});

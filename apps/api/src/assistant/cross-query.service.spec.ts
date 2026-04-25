import { CrossQueryService, TEMPLATE_ALLOWLIST } from './cross-query.service';

describe('CrossQueryService P3.1b', () => {
  const mockPrisma = {
    building: { count: jest.fn() },
    unitBalanceMonthlySnapshot: { findMany: jest.fn() },
    buildingBalanceMonthlySnapshot: { findFirst: jest.fn() },
    ticket: { findMany: jest.fn(), count: jest.fn() },
    payment: { findMany: jest.fn() },
    unit: { count: jest.fn() },
    unitOccupant: { count: jest.fn() },
  } as any;

  const mockProcessSearch = {
    searchProcesses: jest.fn(),
    getProcessSummary: jest.fn(),
  } as any;

  let service: CrossQueryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CrossQueryService(mockPrisma, mockProcessSearch);

    mockPrisma.building.count.mockResolvedValue(1);
    mockPrisma.unitBalanceMonthlySnapshot.findMany.mockResolvedValue([]);
    mockPrisma.buildingBalanceMonthlySnapshot.findFirst.mockResolvedValue(null);
    mockPrisma.ticket.findMany.mockResolvedValue([]);
    mockPrisma.ticket.count.mockResolvedValue(0);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.unit.count.mockResolvedValue(0);
    mockPrisma.unitOccupant.count.mockResolvedValue(0);
    mockProcessSearch.searchProcesses.mockResolvedValue({
      processes: [],
      pagination: { total: 0, limit: 20, hasMore: false },
      asOf: new Date().toISOString(),
    });
  });

  it('returns contract_mismatch for invalid template', async () => {
    const result = await service.execute('tenant-1', 'TENANT_ADMIN', { templateId: 'TPL-99' as any, params: {} });
    expect(result.responseType).toBe('error');
    expect(result.errorCode).toBe('contract_mismatch');
  });

  it('returns role_denied for invalid role', async () => {
    const result = await service.execute('tenant-1', 'OPERATOR', { templateId: 'TPL-10', params: {} });
    expect(result.responseType).toBe('error');
    expect(result.errorCode).toBe('role_denied');
  });

  it('TPL-01 data-backed from snapshots + occupants', async () => {
    mockPrisma.unitBalanceMonthlySnapshot.findMany.mockResolvedValue([
      {
        id: 's1',
        unitId: 'u1',
        chargedMinor: 120000,
        collectedMinor: 90000,
        outstandingMinor: 30000,
        overdueMinor: 5000,
        collectionRateBp: 7500,
        asOf: new Date('2026-03-31T23:59:59.000Z'),
        unit: {
          code: '101',
          label: '101',
          building: { name: 'Torre A' },
          unitOccupants: [{ role: 'OWNER', member: { name: 'Ana' } }],
        },
      },
      {
        id: 's2',
        unitId: 'u2',
        chargedMinor: 100000,
        collectedMinor: 100000,
        outstandingMinor: 0,
        overdueMinor: 0,
        collectionRateBp: 10000,
        asOf: new Date('2026-03-31T23:59:59.000Z'),
        unit: {
          code: '102',
          label: '102',
          building: { name: 'Torre A' },
          unitOccupants: [],
        },
      },
    ]);

    const result = await service.execute('tenant-1', 'TENANT_ADMIN', {
      templateId: 'TPL-01',
      params: { period: '2026-03', topN: 10, limit: 20, buildingId: 'b1' },
    });

    expect(result.answerSource).toBe('snapshot');
    expect(result.responseType).toBe('list');
    expect(result.sections[0]?.title).toBe('Resumen');
    expect((result.sections[0]?.data as any).totalDebt).toBe(30000);
    expect(result.coverage).toEqual({ from: '2026-03', to: '2026-03', completeness: 1 });
  });

  it('TPL-05 stable pagination two pages no overlap', async () => {
    mockProcessSearch.searchProcesses.mockResolvedValue({
      processes: [
        { id: 'p1', title: 'Proc 1', status: 'PENDING', priority: 3, overdueSla: true, createdAt: '2026-03-01T10:00:00.000Z', buildingId: 'b1', unitId: 'u1' },
        { id: 'p2', title: 'Proc 2', status: 'IN_PROGRESS', priority: 1, overdueSla: false, createdAt: '2026-03-02T10:00:00.000Z', buildingId: 'b1', unitId: 'u2' },
      ],
      pagination: { total: 2, limit: 20, hasMore: false },
      asOf: new Date().toISOString(),
    });
    mockPrisma.ticket.findMany.mockResolvedValue([
      { id: 't1', title: 'Ticket 1', status: 'OPEN', priority: 'HIGH', createdAt: new Date('2026-03-01T11:00:00.000Z'), buildingId: 'b1', unitId: 'u1' },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      { id: 'pay1', reference: 'REF-1', status: 'SUBMITTED', createdAt: new Date('2026-03-01T12:00:00.000Z'), buildingId: 'b1', unitId: 'u1' },
    ]);

    const page1 = await service.execute('tenant-1', 'TENANT_ADMIN', {
      templateId: 'TPL-05',
      params: { buildingId: 'b1', limit: 2, topN: 2 },
    });
    expect(page1.responseType).toBe('list');
    expect(page1.pagination?.hasMore).toBe(true);

    const page1Items = page1.sections[1]?.data as Array<{ id: string }>;
    const cursor = page1.pagination?.nextCursor as string;

    const page2 = await service.execute('tenant-1', 'TENANT_ADMIN', {
      templateId: 'TPL-05',
      params: { buildingId: 'b1', limit: 2, topN: 2, cursor },
    });

    const page2Items = page2.sections[1]?.data as Array<{ id: string }>;
    const ids1 = new Set((page1Items ?? []).map((i) => i.id));
    const overlap = (page2Items ?? []).some((i) => ids1.has(i.id));
    expect(overlap).toBe(false);
  });

  it('TPL-10 data-backed with snapshot + live sections and asOf/coverage consistency', async () => {
    mockPrisma.buildingBalanceMonthlySnapshot.findFirst.mockResolvedValue({
      chargedMinor: 500000,
      collectedMinor: 420000,
      outstandingMinor: 80000,
      overdueMinor: 25000,
      collectionRateBp: 8400,
      asOf: new Date('2026-03-31T23:59:59.000Z'),
    });
    mockProcessSearch.searchProcesses.mockResolvedValue({
      processes: [
        { id: 'p1', status: 'PENDING', overdueSla: true },
        { id: 'p2', status: 'COMPLETED', overdueSla: false },
      ],
      pagination: { total: 2, limit: 20, hasMore: false },
      asOf: new Date().toISOString(),
    });
    mockPrisma.ticket.count.mockResolvedValue(7);
    mockPrisma.unit.count.mockResolvedValue(10);
    mockPrisma.unitOccupant.count.mockResolvedValue(8);

    const result = await service.execute('tenant-1', 'TENANT_OWNER', {
      templateId: 'TPL-10',
      params: { buildingId: 'b1', period: '2026-03' },
    });

    expect(result.answerSource).toBe('snapshot');
    expect(result.responseType).toBe('dashboard');
    expect(result.asOf).toBe('2026-03-31T23:59:59.000Z');
    expect(result.coverage).toEqual({ from: '2026-03', to: '2026-03', completeness: 1 });
    expect(result.sections).toHaveLength(3);
  });

  it('enforces clamps topN<=50 limit<=50 monthsBack<=24', async () => {
    const tpl5 = await service.execute('tenant-1', 'TENANT_ADMIN', { templateId: 'TPL-05', params: { buildingId: 'b1', topN: 500, limit: 999 } });
    expect(tpl5.pagination?.limit).toBe(50);

    const tpl6 = await service.execute('tenant-1', 'TENANT_ADMIN', { templateId: 'TPL-06', params: { monthsBack: 999 } });
    expect(tpl6.coverage?.completeness).toBeLessThanOrEqual(1);
  });

  it('requires building when tenant has multiple buildings', async () => {
    mockPrisma.building.count.mockResolvedValue(3);
    const result = await service.execute('tenant-1', 'TENANT_ADMIN', { templateId: 'TPL-01', params: {} });
    expect(result.responseType).toBe('clarification');
  });

  it('allowlist definition remains complete', () => {
    expect(Object.keys(TEMPLATE_ALLOWLIST)).toHaveLength(10);
    expect(TEMPLATE_ALLOWLIST['TPL-10'].roles).toContain('TENANT_OWNER');
    expect(TEMPLATE_ALLOWLIST['TPL-10'].roles).toContain('SUPER_ADMIN');
  });
});

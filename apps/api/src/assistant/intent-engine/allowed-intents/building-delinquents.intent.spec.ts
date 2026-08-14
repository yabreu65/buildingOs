import { BadRequestException } from '@nestjs/common';
import { buildingDelinquentsIntent } from './building-delinquents.intent';
import { IntentExecutionResult } from '../intent.types';

function chg(o: {
  id?: string;
  unitId: string;
  amount: number;
  currency?: string;
  dueDate: string;
  status?: string;
  overdueSince?: string | null;
  allocations?: Array<{ amount: number; payment?: { status?: string } | null }>;
}) {
  return {
    id: o.id || `c-${o.unitId}`,
    unitId: o.unitId,
    amount: o.amount,
    currency: o.currency || 'ARS',
    dueDate: new Date(o.dueDate),
    canceledAt: null,
    status: o.status || 'PENDING',
    overdueSince: o.overdueSince === undefined ? new Date('2026-01-01T00:00:00Z') : o.overdueSince,
    unit: { id: o.unitId, code: `code-${o.unitId}`, label: `Label ${o.unitId}` },
    paymentAllocations: o.allocations || [],
  };
}

function makePrisma(charges: unknown[]) {
  return {
    charge: { findMany: async () => charges },
    tenant: { findUniqueOrThrow: async () => ({ currency: 'ARS' }) },
  };
}

async function run(
  filters: Record<string, unknown> | undefined,
  charges: unknown[],
): Promise<IntentExecutionResult> {
  return buildingDelinquentsIntent.executor({
    tenantId: 'tenant-1',
    entityIds: { buildingId: 'building-1' },
    filters,
    pagination: { limit: 20 },
    prisma: makePrisma(charges) as never,
    userRoles: ['TENANT_ADMIN'],
  } as never);
}

describe('building_delinquents intent (3F5 decision B)', () => {
  it('default list: NON-monetary ordering (earliest dueDate ASC, then label)', async () => {
    const result = await run(undefined, [
      chg({ unitId: 'unit-a', amount: 1, currency: 'USD', dueDate: '2026-03-01T00:00:00Z' }),
      chg({ unitId: 'unit-b', amount: 1000000000, dueDate: '2026-01-01T00:00:00Z' }),
    ]);

    const data = result.data as { delinquents: Array<{ label: string; outstandingByCurrency: unknown[] }> };
    // ARS 10M (earlier dueDate) first even though its nominal value dwarfs USD 1.
    expect(data.delinquents[0]!.label).toBe('Label unit-b');
    expect(data.delinquents[1]!.label).toBe('Label unit-a');
    expect(data.delinquents[0]!.outstandingByCurrency).toEqual([
      { currency: 'ARS', amountMinor: 1000000000 },
    ]);
  });

  it('USD filter: compares ONLY the USD bucket (same-currency)', async () => {
    const result = await run(
      { currency: 'USD', minAmount: 500 },
      [
        chg({ unitId: 'unit-a', amount: 1000000000, currency: 'ARS', dueDate: '2026-01-01T00:00:00Z' }),
        chg({ unitId: 'unit-b', amount: 100, currency: 'USD', dueDate: '2026-01-02T00:00:00Z' }),
        chg({ unitId: 'unit-c', amount: 60000, currency: 'USD', dueDate: '2026-01-03T00:00:00Z' }),
      ],
    );

    const data = result.data as { delinquents: Array<{ label: string }> };
    // unit-a (ARS 10M, USD 0) and unit-b (USD 1) do NOT match; only unit-c (USD 600).
    expect(data.delinquents.map((d) => d.label)).toEqual(['Label unit-c']);
  });

  it('missing currency with monetary operation => clarification (BadRequest, query not executed)', async () => {
    const prisma = makePrisma([]);
    prisma.charge.findMany = jest.fn().mockResolvedValue([]);

    await expect(
      buildingDelinquentsIntent.executor({
        tenantId: 'tenant-1',
        entityIds: { buildingId: 'building-1' },
        filters: { minAmount: 500 },
        pagination: { limit: 20 },
        prisma: prisma as never,
        userRoles: ['TENANT_ADMIN'],
      } as never),
    ).rejects.toThrow(BadRequestException);

    // The monetary filter must never execute without a currency.
    expect(prisma.charge.findMany).not.toHaveBeenCalled();
  });

  it('same-currency monetary ranking: USD amounts only', async () => {
    const result = await run(
      { currency: 'USD', sortField: 'amount', sortOrder: 'desc' },
      [
        chg({ unitId: 'unit-a', amount: 10000, currency: 'USD', dueDate: '2026-01-01T00:00:00Z' }),
        chg({ unitId: 'unit-b', amount: 50000, currency: 'USD', dueDate: '2026-01-02T00:00:00Z' }),
        chg({ unitId: 'unit-c', amount: 20000, currency: 'USD', dueDate: '2026-01-03T00:00:00Z' }),
      ],
    );

    const data = result.data as { delinquents: Array<{ label: string }> };
    expect(data.delinquents.map((d) => d.label)).toEqual([
      'Label unit-b',
      'Label unit-c',
      'Label unit-a',
    ]);
  });

  it('cross-currency "biggest debtors" without currency => clarification, no nominal ranking', async () => {
    const prisma = makePrisma([]);
    prisma.charge.findMany = jest.fn().mockResolvedValue([]);

    await expect(
      buildingDelinquentsIntent.executor({
        tenantId: 'tenant-1',
        entityIds: { buildingId: 'building-1' },
        filters: { sortField: 'amount' },
        pagination: { limit: 20 },
        prisma: prisma as never,
        userRoles: ['TENANT_ADMIN'],
      } as never),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.charge.findMany).not.toHaveBeenCalled();
  });
});

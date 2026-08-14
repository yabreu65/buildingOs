import { InboxService } from './inbox.service';
import type { PrismaService } from '../prisma/prisma.service';

function makePrisma(payments: unknown[]) {
  return {
    membership: {
      findUnique: async () => ({
        id: 'm-1',
        userId: 'u-1',
        tenantId: 't-1',
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
      }),
    },
    building: { findMany: async () => [{ id: 'b-1' }] },
    charge: { findMany: async () => [] },
    payment: {
      findMany: async (args: { where: { tenantId: string } }) =>
        payments.filter((p) => (p as { tenantId: string }).tenantId === args.where.tenantId),
    },
    ticket: { findMany: async () => [], count: async () => 0 },
    communication: { findMany: async () => [] },
  } as unknown as PrismaService;
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

describe('InboxService.getPaymentSummary', () => {
  it('exposes Payment.currency per payment (USD)', async () => {
    const svc = new InboxService(
      makePrisma([payment({ id: 'p1', tenantId: 't-1', amount: 12345, currency: 'USD' })]),
      undefined,
      undefined,
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
      ]),
      undefined,
      undefined,
    );

    const summary = await svc.getInboxSummary('u-1', 't-1', 'b-1', 20);

    expect(summary.payments.map((p) => p.currency)).toEqual([
      'USD',
      'ARS',
      'VES',
      'COP',
    ]);
    expect(summary.payments.map((p) => p.amount)).toEqual([
      10000,
      2000000,
      500000,
      7000000,
    ]);
  });

  it('excludes payments from other tenants (tenant isolation)', async () => {
    const svc = new InboxService(
      makePrisma([
        payment({ id: 'p1', tenantId: 't-1', amount: 10000, currency: 'USD' }),
        payment({ id: 'p2', tenantId: 't-other', amount: 999999, currency: 'ARS' }),
      ]),
      undefined,
      undefined,
    );

    const summary = await svc.getInboxSummary('u-1', 't-1', 'b-1', 20);

    expect(summary.payments).toHaveLength(1);
    expect(summary.payments[0]!.id).toBe('p1');
    expect(summary.payments[0]!.currency).toBe('USD');
  });

  it('uses Payment.currency even when it differs from any tenant default', async () => {
    // The tenant default is irrelevant: Payment.currency is authoritative.
    const svc = new InboxService(
      makePrisma([payment({ id: 'p1', tenantId: 't-1', amount: 12345, currency: 'UYU' })]),
      undefined,
      undefined,
    );

    const summary = await svc.getInboxSummary('u-1', 't-1', 'b-1', 20);

    expect(summary.payments[0]!.currency).toBe('UYU');
  });
});

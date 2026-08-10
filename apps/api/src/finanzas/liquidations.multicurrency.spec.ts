import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { LiquidationsService } from './liquidations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createLiquidationWorkflowDependencies,
  LiquidationPublicationUseCase,
} from './liquidation-publication.use-case';

const legacyExpense = (overrides: Record<string, unknown> = {}) => ({
  id: 'exp-1',
  tenantId: 'tenant-1',
  buildingId: 'building-1',
  period: '2026-08',
  liquidationPeriod: '2026-08',
  category: { name: 'Maintenance' },
  vendor: { name: 'Vendor' },
  amountMinor: 1000,
  currencyCode: 'ARS',
  invoiceDate: new Date('2026-08-05T00:00:00.000Z'),
  description: null,
  status: 'VALIDATED',
  scopeType: 'BUILDING',
  ...overrides,
});

const functionalExpense = (overrides: Record<string, unknown> = {}) =>
  legacyExpense({
    currencyCode: 'USD',
    functionalAmountMinor: 36500,
    functionalCurrencyCode: 'VES',
    exchangeRateId: 'rate-1',
    exchangeRateValue: '36.5',
    exchangeRateDirection: 'DIRECT',
    exchangeRateEffectiveAt: new Date('2026-08-04T00:00:00.000Z'),
    conversionDate: new Date('2026-08-05T00:00:00.000Z'),
    ...overrides,
  });

const identityExpense = (overrides: Record<string, unknown> = {}) =>
  legacyExpense({
    currencyCode: 'VES',
    amountMinor: 500,
    functionalAmountMinor: 500,
    functionalCurrencyCode: 'VES',
    exchangeRateId: null,
    exchangeRateValue: '1',
    exchangeRateDirection: 'IDENTITY',
    exchangeRateEffectiveAt: null,
    conversionDate: new Date('2026-08-05T00:00:00.000Z'),
    ...overrides,
  });

const legacyAdjustment = (overrides: Record<string, unknown> = {}) => ({
  id: 'adj-1',
  amountMinor: 200,
  currencyCode: 'ARS',
  sourceInvoiceDate: new Date('2026-08-01T00:00:00.000Z'),
  sourcePeriod: '2026-08',
  reason: 'Correction',
  category: { name: 'Water' },
  ...overrides,
});

const functionalAdjustment = (overrides: Record<string, unknown> = {}) =>
  legacyAdjustment({
    currencyCode: 'COP',
    functionalAmountMinor: 125,
    functionalCurrencyCode: 'VES',
    exchangeRateId: 'rate-inv',
    exchangeRateValue: '25',
    exchangeRateDirection: 'INVERSE',
    exchangeRateEffectiveAt: new Date('2026-07-20T00:00:00.000Z'),
    conversionDate: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  });

describe('LiquidationsService multicurrency valuation', () => {
  let service: LiquidationsService;
  let prisma: PrismaService;
  let tx: {
    tenant: { findFirst: jest.Mock };
    membership: { findFirst: jest.Mock };
    building: { findFirst: jest.Mock };
    expense: { count: jest.Mock; findMany: jest.Mock };
    adjustment: { findMany: jest.Mock };
    unit: { findMany: jest.Mock };
    liquidation: {
      findFirst: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    charge: {
      count: jest.Mock;
      findMany: jest.Mock;
      createMany: jest.Mock;
      updateMany: jest.Mock;
    };
    paymentAllocation: { count: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  const setupPrisma = () => {
    prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
  };

  beforeEach(async () => {
    tx = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tenant-1', functionalCurrency: 'VES' }),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
        }),
      },
      building: {
        findFirst: jest.fn().mockResolvedValue({ id: 'building-1' }),
      },
      expense: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      adjustment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      unit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
          { id: 'unit-2', code: '1B', label: '1B', unitCategory: null },
        ]),
      },
      liquidation: {
        findFirst: jest.fn().mockImplementation(({ where }: { where?: { status?: string } }) => {
          if (where?.status === 'PUBLISHED') {
            return Promise.resolve(null);
          }
          const createdData =
            (tx.liquidation.create as jest.Mock).mock.calls[0]?.[0]?.data ?? {};
          return Promise.resolve({
            id: 'liq-created',
            tenantId: 'tenant-1',
            buildingId: 'building-1',
            period: '2026-08',
            chargePeriod: null,
            status: 'DRAFT',
            valuationMode: createdData.valuationMode ?? 'LEGACY_NOMINAL',
            baseCurrency: createdData.baseCurrency ?? 'VES',
            totalAmountMinor: 0,
            totalsByCurrency: {},
            expenseSnapshot: [],
            publicationSnapshot: null,
            unitCount: 2,
            generatedAt: new Date(),
            reviewedAt: null,
            publishedAt: null,
            canceledAt: null,
            createdAt: new Date(),
          });
        }),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'liq-created', ...data, createdAt: new Date(), updatedAt: new Date() }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      charge: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      paymentAllocation: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    setupPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { createLog: jest.fn(), createLogRequired: jest.fn() } },
        {
          provide: FinanzasValidators,
          useValue: { isAdminOrOperator: jest.fn().mockReturnValue(true) },
        },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        {
          provide: LiquidationPublicationUseCase,
          useFactory: () =>
            new LiquidationPublicationUseCase(
              createLiquidationWorkflowDependencies(
                prisma,
                { isAdminOrOperator: () => true },
                jest.fn(),
              ),
            ),
        },
      ],
    }).compile();

    service = module.get<LiquidationsService>(LiquidationsService);
  });

  const createDraft = (baseCurrency = 'VES', period = '2026-08') =>
    service.createDraft('tenant-1', 'member-1', {
      buildingId: 'building-1',
      period,
      baseCurrency,
    });

  const lastCreated = () => {
    expect(tx.liquidation.create).toHaveBeenCalledTimes(1);
    const call = (tx.liquidation.create as jest.Mock).mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return call[0].data;
  };

  describe('FUNCTIONAL mode', () => {
    it('single functional expense in functional currency produces FUNCTIONAL valuation', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([identityExpense()])
        .mockResolvedValueOnce([]);

      const result = await createDraft();

      const data = lastCreated();
      expect(data.valuationMode).toBe('FUNCTIONAL');
      expect(data.baseCurrency).toBe('VES');
      expect(data.totalAmountMinor).toBe(500);
      expect(result.valuationMode).toBe('FUNCTIONAL');
    });

    it('USD + COP sources converge to functional VES total', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([functionalExpense()])
        .mockResolvedValueOnce([]);
      tx.adjustment.findMany.mockResolvedValueOnce([functionalAdjustment()]);

      const result = await createDraft();

      const data = lastCreated();
      expect(data.valuationMode).toBe('FUNCTIONAL');
      expect(data.baseCurrency).toBe('VES');
      expect(data.totalAmountMinor).toBe(36500 + 125);
      expect(data.totalsByCurrency).toEqual({ USD: 1000, COP: 200 });
      expect(result.valuationMode).toBe('FUNCTIONAL');
    });

    it('keeps original totals by currency and functional total in the snapshot items', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([functionalExpense(), identityExpense()])
        .mockResolvedValueOnce([]);

      await createDraft();

      const data = lastCreated();
      const snapshot = data.expenseSnapshot as Array<Record<string, unknown>>;
      expect(data.totalAmountMinor).toBe(37000);
      expect(data.totalsByCurrency).toEqual({ USD: 1000, VES: 500 });
      expect(snapshot).toHaveLength(2);
      expect(snapshot[0]).toMatchObject({
        expenseId: 'exp-1',
        functionalAmountMinor: 36500,
        functionalCurrencyCode: 'VES',
        exchangeRateDirection: 'DIRECT',
      });
      expect(snapshot[1]).toMatchObject({
        exchangeRateDirection: 'IDENTITY',
        exchangeRateId: null,
      });
    });

    it('rejects a base currency that differs from the tenant functional currency', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([functionalExpense()])
        .mockResolvedValueOnce([]);

      await expect(createDraft('USD')).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_BASE_CURRENCY_MISMATCH',
        },
      });
      expect(tx.liquidation.create).not.toHaveBeenCalled();
    });
  });

  describe('LEGACY_NOMINAL mode', () => {
    it('all legacy sources with single currency equal to base produce LEGACY_NOMINAL', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([legacyExpense()])
        .mockResolvedValueOnce([]);
      tx.adjustment.findMany.mockResolvedValueOnce([legacyAdjustment()]);

      const result = await createDraft('ARS');

      const data = lastCreated();
      expect(data.valuationMode).toBe('LEGACY_NOMINAL');
      expect(data.baseCurrency).toBe('ARS');
      expect(data.totalAmountMinor).toBe(1200);
      expect(result.valuationMode).toBe('LEGACY_NOMINAL');
    });

    it('blocks legacy single currency different from base currency', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([legacyExpense()])
        .mockResolvedValueOnce([]);

      await expect(createDraft('USD')).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_BASE_CURRENCY_MISMATCH',
        },
      });
    });

    it('blocks legacy mixed currencies', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([legacyExpense(), legacyExpense({ id: 'exp-2', currencyCode: 'USD' })])
        .mockResolvedValueOnce([]);

      await expect(createDraft('ARS')).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'MIXED_CURRENCY_LIQUIDATION_NOT_SUPPORTED',
        },
      });
    });
  });

  describe('HYBRID / PARTIAL blocks', () => {
    it('blocks functional expense + legacy adjustment', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([functionalExpense()])
        .mockResolvedValueOnce([]);
      tx.adjustment.findMany.mockResolvedValueOnce([legacyAdjustment()]);

      await expect(createDraft()).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
        },
      });
      expect(tx.liquidation.create).not.toHaveBeenCalled();
    });

    it('blocks legacy expense + functional adjustment', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([legacyExpense()])
        .mockResolvedValueOnce([]);
      tx.adjustment.findMany.mockResolvedValueOnce([functionalAdjustment()]);

      await expect(createDraft('VES')).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
        },
      });
    });

    it('blocks a corrupted IDENTITY snapshot (rate present, direction missing)', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([
          identityExpense({
            exchangeRateDirection: null,
            exchangeRateId: 'rate-x',
          }),
        ])
        .mockResolvedValueOnce([]);

      await expect(createDraft()).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
        },
      });
    });

    it('blocks a DIRECT snapshot with non-positive rate', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([
          functionalExpense({ exchangeRateValue: '0' }),
        ])
        .mockResolvedValueOnce([]);

      await expect(createDraft()).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
        },
      });
    });

    it('blocks a snapshot with missing provenance (no exchangeRateId on DIRECT)', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([
          functionalExpense({ exchangeRateId: null }),
        ])
        .mockResolvedValueOnce([]);

      await expect(createDraft()).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
        },
      });
    });

    it('blocks a snapshot whose functional currency differs from base currency', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([
          functionalExpense({ functionalCurrencyCode: 'ARS' }),
        ])
        .mockResolvedValueOnce([]);

      await expect(createDraft()).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
        },
      });
    });
  });

  describe('functional currency changed before draft', () => {
    it('blocks when the frozen functional snapshot predates a tenant currency change', async () => {
      tx.expense.findMany
        .mockResolvedValueOnce([functionalExpense()])
        .mockResolvedValueOnce([]);
      tx.tenant.findFirst.mockResolvedValueOnce({
        id: 'tenant-1',
        functionalCurrency: 'USD',
      });

      await expect(createDraft('USD')).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
        },
      });
      expect(tx.liquidation.create).not.toHaveBeenCalled();
    });
  });

  describe('tenant isolation', () => {
    it('does not leak rates or sources across tenants (membership scoped)', async () => {
      tx.membership.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createDraft('other-tenant', 'member-1', {
          buildingId: 'building-1',
          period: '2026-08',
          baseCurrency: 'VES',
        }),
      ).rejects.toThrow();
    });
  });
});

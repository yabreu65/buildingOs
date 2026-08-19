import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LiquidationsService } from './liquidations.service';
import { LiquidationIncomeOffsetsService } from './liquidation-income-offsets.service';
import { LegacyIncomeBackfillService } from './legacy-income-backfill.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createLiquidationWorkflowDependencies,
  LiquidationPublicationUseCase,
} from './liquidation-publication.use-case';

const baseLiquidation = {
  id: 'liq-1',
  tenantId: 'tenant-1',
  buildingId: 'building-1',
  period: '2026-05',
  chargePeriod: '2026-06',
  status: 'REVIEWED',
  baseCurrency: 'ARS',
  totalAmountMinor: 101,
  totalsByCurrency: { ARS: 101 },
  expenseSnapshot: [
    {
      expenseId: 'exp-1',
      categoryName: 'Water',
      vendorName: 'Vendor',
      amountMinor: 101,
      currencyCode: 'ARS',
      invoiceDate: '2026-05-01T00:00:00.000Z',
      description: null,
      type: 'EXPENSE',
    },
  ],
  unitCount: 2,
  generatedAt: new Date('2026-05-01T00:00:00.000Z'),
  reviewedAt: null,
  publishedAt: null,
  canceledAt: null,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
};

describe('LiquidationsService', () => {
  let service: LiquidationsService;
  let prisma: PrismaService;
  let auditService: { createLog: jest.Mock; createLogRequired: jest.Mock };
  let validators: { isAdminOrOperator: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };
  let publicationUseCase: LiquidationPublicationUseCase;
  let tx: {
    membership: {
      findFirst: jest.Mock;
    };
    building: {
      findFirst: jest.Mock;
    };
    expense: {
      count: jest.Mock;
      findMany: jest.Mock;
    };
    adjustment: {
      findMany: jest.Mock;
    };
    unit: {
      findMany: jest.Mock;
    };
    liquidation: {
      findFirst: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    charge: {
      count: jest.Mock;
      findMany: jest.Mock;
      createMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    paymentAllocation: { count: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tenant-1', functionalCurrency: 'ARS' }),
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
      income: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      incomeApplication: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      liquidationIncomeOffset: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
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

          return Promise.resolve(baseLiquidation);
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          ...baseLiquidation,
          ...data,
          status: 'DRAFT',
          publicationSnapshot: null,
        })),
        delete: jest.fn(),
      },
      charge: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        deleteMany: jest.fn(),
      },
      paymentAllocation: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    validators = { isAdminOrOperator: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationsService,
        LiquidationIncomeOffsetsService,
        {
          provide: LegacyIncomeBackfillService,
          useValue: {
            materializeForLiquidation: jest.fn().mockResolvedValue(undefined),
            preview: jest.fn().mockResolvedValue([]),
            apply: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: LiquidationPublicationUseCase,
          inject: [PrismaService, AuditService, FinanzasValidators, NotificationsService],
          useFactory: (
            prisma: PrismaService,
            auditService: AuditService,
            validators: FinanzasValidators,
            notificationsService: NotificationsService,
          ) =>
            new LiquidationPublicationUseCase(
              createLiquidationWorkflowDependencies({
                prisma,
                auditService,
                validators,
                notificationsService,
              }),
            ),
        },
        {
          provide: PrismaService,
          useValue: {
            membership: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'member-1',
              tenantId: 'tenant-1',
              userId: 'user-1',
              roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
            }),
            },
            unit: {
              findMany: jest.fn().mockResolvedValue([
                { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
                { id: 'unit-2', code: '1B', label: '1B', unitCategory: null },
              ]),
              findFirst: jest.fn().mockResolvedValue({
                id: 'unit-1',
                label: '1A',
                unitOccupants: [],
              }),
            },
            expense: {
              count: jest.fn().mockResolvedValue(0),
              findMany: jest.fn().mockResolvedValue([]),
            },
            adjustment: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            building: {
              findFirst: jest.fn().mockResolvedValue({ id: 'building-1' }),
            },
          charge: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn(),
          },
            paymentAllocation: { count: jest.fn().mockResolvedValue(0) },
            liquidation: {
              findMany: jest.fn().mockResolvedValue([baseLiquidation]),
              findFirst: jest.fn().mockImplementation(({ where }: { where?: { status?: string; id?: { not?: string } } }) => {
                if (where?.status === 'PUBLISHED' && where?.id?.not === 'liq-1') {
                  return Promise.resolve(null);
                }

                return Promise.resolve(baseLiquidation);
              }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              delete: jest.fn(),
              findUniqueOrThrow: jest.fn().mockResolvedValue({
                ...baseLiquidation,
                status: 'PUBLISHED',
                publishedAt: new Date('2026-05-02T00:00:00.000Z'),
              }),
            },
            $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
          },
        },
        {
          provide: AuditService,
          useValue: (auditService = {
            createLog: jest.fn(),
            createLogRequired: jest.fn().mockResolvedValue(undefined),
          }),
        },
        {
          provide: FinanzasValidators,
          useValue: validators,
        },
        {
          provide: NotificationsService,
          useValue: (notificationsService = { createNotification: jest.fn() }),
        },
      ],
    }).compile();

    service = module.get<LiquidationsService>(LiquidationsService);
    publicationUseCase = module.get<LiquidationPublicationUseCase>(LiquidationPublicationUseCase);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('includes chargePeriod when mapping a liquidation response', async () => {
    const liquidations = await service.listLiquidations(
      'tenant-1',
      'member-1',
      {},
    );

    expect(liquidations).toEqual([
      expect.objectContaining({ chargePeriod: '2026-06' }),
    ]);
  });

  it('maps FIN-07C income offset snapshot and per-currency totals', async () => {
    prisma.liquidation.findMany.mockResolvedValueOnce([
      {
        ...baseLiquidation,
        incomeOffsetsByCurrency: { ARS: 1500 },
        incomeOffsetSnapshot: [
          {
            incomeId: 'income-1',
            incomeApplicationId: 'app-1',
            categoryId: 'cat-1',
            categoryName: 'Alquiler',
            policyVersionId: null,
            legacyDestination: null,
            scopeType: 'BUILDING',
            currencyCode: 'ARS',
            applicationAmountMinor: 1500,
            buildingAmountMinor: 1500,
            valuedAmountMinor: 1500,
            functionalCurrencyCode: null,
            exchangeRateId: null,
            exchangeRateValue: null,
            exchangeRateDirection: null,
            exchangeRateEffectiveAt: null,
            conversionDate: null,
            receivedDate: '2026-05-01',
            period: '2026-05',
          },
        ],
      },
    ]);

    const [liquidation] = await service.listLiquidations('tenant-1', 'member-1', {});

    expect(liquidation.incomeOffsetsByCurrency).toEqual({ ARS: 1500 });
    expect(liquidation.incomeOffsetSnapshot).toHaveLength(1);
    expect(liquidation.incomeOffsetSnapshot?.[0]?.categoryName).toBe('Alquiler');
  });

  it('maps null income offset fields for historical liquidations', async () => {
    prisma.liquidation.findMany.mockResolvedValueOnce([baseLiquidation]);

    const [liquidation] = await service.listLiquidations('tenant-1', 'member-1', {});

    expect(liquidation.incomeOffsetsByCurrency).toBeNull();
    expect(liquidation.incomeOffsetSnapshot).toBeNull();
  });

  it('accepts a valid zero-offset V3 liquidation (empty maps, non-null)', async () => {
    prisma.liquidation.findMany.mockResolvedValueOnce([
      {
        ...baseLiquidation,
        grossExpenseAmountMinor: 10000,
        adjustmentAmountMinor: 0,
        preIncomeAmountMinor: 10000,
        incomeOffsetAmountMinor: 0,
        netDistributableAmountMinor: 10000,
        incomeOffsetSnapshot: [],
        incomeOffsetsByCurrency: {},
      },
    ]);

    const [liquidation] = await service.listLiquidations('tenant-1', 'member-1', {});

    expect(liquidation.incomeOffsetsByCurrency).toEqual({});
    expect(liquidation.incomeOffsetSnapshot).toEqual([]);
  });

  it('fails closed on malformed incomeOffsetsByCurrency instead of downgrading to null', async () => {
    prisma.liquidation.findMany.mockResolvedValueOnce([
      { ...baseLiquidation, incomeOffsetsByCurrency: ['ARS', 1500] },
    ]);

    await expect(
      service.listLiquidations('tenant-1', 'member-1', {}),
    ).rejects.toThrow('Liquidation incomeOffsetsByCurrency is invalid');
  });

  it('fails closed on malformed incomeOffsetSnapshot instead of downgrading to null', async () => {
    prisma.liquidation.findMany.mockResolvedValueOnce([
      {
        ...baseLiquidation,
        incomeOffsetSnapshot: [{ incomeId: 'income-1' }],
      },
    ]);

    await expect(
      service.listLiquidations('tenant-1', 'member-1', {}),
    ).rejects.toThrow('Liquidation incomeOffsetSnapshot');
  });

  // ==========================================================================
  // FIN-07CR3: read-contract hardening del snapshot de ingresos (maq. A–V)
  // ==========================================================================

  const V3_OFFSET_ITEM = {
    incomeId: 'income-1',
    incomeApplicationId: 'app-1',
    categoryId: 'cat-1',
    categoryName: 'Alquiler',
    policyVersionId: null,
    legacyDestination: null,
    scopeType: 'BUILDING',
    currencyCode: 'ARS',
    applicationAmountMinor: 1500,
    buildingAmountMinor: 1500,
    valuedAmountMinor: 1500,
    functionalCurrencyCode: null,
    exchangeRateId: null,
    exchangeRateValue: null,
    exchangeRateDirection: null,
    exchangeRateEffectiveAt: null,
    conversionDate: null,
    receivedDate: '2026-05-01',
    period: '2026-05',
  };

  const V3_LIQUIDATION = {
    ...baseLiquidation,
    grossExpenseAmountMinor: 10000,
    adjustmentAmountMinor: 0,
    preIncomeAmountMinor: 10000,
    incomeOffsetAmountMinor: 1500,
    netDistributableAmountMinor: 8500,
    incomeOffsetsByCurrency: { ARS: 1500 },
    incomeOffsetSnapshot: [V3_OFFSET_ITEM],
  };

  async function listWith(liquidation: Record<string, unknown>) {
    prisma.liquidation.findMany.mockResolvedValueOnce([liquidation as never]);
    return service.listLiquidations('tenant-1', 'member-1', {});
  }

  it('A. accepts a historical record (summary null, artifacts null)', async () => {
    const [liquidation] = await listWith(baseLiquidation);
    expect(liquidation.grossExpenseAmountMinor).toBeNull();
    expect(liquidation.incomeOffsetSnapshot).toBeNull();
    expect(liquidation.incomeOffsetsByCurrency).toBeNull();
  });

  it('B. accepts a zero-offset V3 (summary present, [] and {})', async () => {
    const [liquidation] = await listWith({
      ...V3_LIQUIDATION,
      incomeOffsetAmountMinor: 0,
      netDistributableAmountMinor: 10000,
      incomeOffsetSnapshot: [],
      incomeOffsetsByCurrency: {},
    });
    expect(liquidation.incomeOffsetSnapshot).toEqual([]);
    expect(liquidation.incomeOffsetsByCurrency).toEqual({});
  });

  it('C. accepts a valid full V3 snapshot unchanged', async () => {
    const [liquidation] = await listWith(V3_LIQUIDATION);
    expect(liquidation.incomeOffsetSnapshot?.[0]).toMatchObject({
      incomeId: 'income-1',
      applicationAmountMinor: 1500,
      buildingAmountMinor: 1500,
      valuedAmountMinor: 1500,
    });
  });

  it.each([
    ['D. buildingAmountMinor = "bad"', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, buildingAmountMinor: 'bad' }] }],
    ['E. valuedAmountMinor = "bad"', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, valuedAmountMinor: 'bad' }] }],
    ['F. negative application amount', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, applicationAmountMinor: -500 }] }],
    ['G. currencyCode numeric', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, currencyCode: 123 }] }],
    ['G2. currencyCode empty', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, currencyCode: '' }] }],
    ['H. baseCurrency numeric', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, baseCurrency: 123 }] }],
    ['H2. baseCurrency empty', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, baseCurrency: '' }] }],
    ['I. scopeType INVALID', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, scopeType: 'INVALID' }] }],
    ['J. buildingId numeric (invalid relation)', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, buildingId: 7 }] }],
    ['K. period malformed (numeric)', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, period: 123 }] }],
    ['L. receivedDate malformed', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, receivedDate: 'not-a-date' }] }],
    ['M. provenance shape invalid', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, legacyDestination: 42 }] }],
    ['N. functional FX conversionDate malformed', { ...V3_LIQUIDATION, incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, exchangeRateEffectiveAt: 'garbage', functionalCurrencyCode: 'ARS' }] }],
  ])('%s => fails closed', async (_name, liquidation) => {
    await expect(listWith(liquidation)).rejects.toThrow('Liquidation incomeOffsetSnapshot');
  });

  it.each([
    ['O. empty currency key ""', { '': 100 }],
    ['P. whitespace-only key', { ' ': 100 }],
  ])('%s => fails closed', async (_name, byCurrency) => {
    await expect(
      listWith({ ...V3_LIQUIDATION, incomeOffsetsByCurrency: byCurrency }),
    ).rejects.toThrow('Liquidation incomeOffsetsByCurrency');
  });

  it.each([
    ['Q. string amount', { ARS: '1500' }],
    ['R. unsafe integer', { ARS: Number.MAX_SAFE_INTEGER + 2 }],
    ['S. negative amount', { ARS: -1 }],
  ])('%s => fails closed', async (_name, byCurrency) => {
    await expect(
      listWith({ ...V3_LIQUIDATION, incomeOffsetsByCurrency: byCurrency }),
    ).rejects.toThrow('Liquidation incomeOffsetsByCurrency');
  });

  it('T. modern summary present + snapshot null => fails', async () => {
    await expect(
      listWith({ ...V3_LIQUIDATION, incomeOffsetSnapshot: null }),
    ).rejects.toThrow('Liquidation V3 is missing incomeOffset snapshot artifacts');
  });

  it('U. modern summary present + byCurrency null => fails', async () => {
    await expect(
      listWith({ ...V3_LIQUIDATION, incomeOffsetsByCurrency: null }),
    ).rejects.toThrow('Liquidation V3 is missing incomeOffset snapshot artifacts');
  });

  it('V. control: summary all null + artifacts null => still accepted', async () => {
    const [liquidation] = await listWith(baseLiquidation);
    expect(liquidation.incomeOffsetSnapshot).toBeNull();
    expect(liquidation.incomeOffsetsByCurrency).toBeNull();
  });

  it('W. partially populated summary => rejected (no silent historical downgrade)', async () => {
    await expect(
      listWith({
        ...baseLiquidation,
        grossExpenseAmountMinor: 10000,
        incomeOffsetAmountMinor: null,
      }),
    ).rejects.toThrow('Liquidation V3 summary fields are partially populated');
  });

  // ==========================================================================
  // FIN-07CR4: cierre del contrato del item (categoryId, legacyDestination,
  // period, montos estrictamente positivos, nullables normalizados)
  // ==========================================================================

  it('rejects categoryId empty string', async () => {
    await expect(
      listWith({
        ...V3_LIQUIDATION,
        incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, categoryId: '' }],
      }),
    ).rejects.toThrow('Liquidation incomeOffsetSnapshot');
  });

  it('normalizes missing categoryId to empty string (historical contract)', async () => {
    const { categoryId: _omit, ...withoutCategoryId } = V3_OFFSET_ITEM;
    const [liquidation] = await listWith({
      ...V3_LIQUIDATION,
      incomeOffsetSnapshot: [withoutCategoryId],
    });
    expect(liquidation.incomeOffsetSnapshot?.[0]?.categoryId).toBe('');
  });

  it.each([
    ['APPLY_TO_EXPENSES', 'APPLY_TO_EXPENSES'],
    ['RESERVE_FUND', 'RESERVE_FUND'],
    ['SPECIAL_FUND', 'SPECIAL_FUND'],
  ])('accepts valid legacyDestination %s', async (_name, legacyDestination) => {
    const [liquidation] = await listWith({
      ...V3_LIQUIDATION,
      incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, legacyDestination }],
    });
    expect(liquidation.incomeOffsetSnapshot?.[0]?.legacyDestination).toBe(legacyDestination);
  });

  it('rejects arbitrary legacyDestination string', async () => {
    await expect(
      listWith({
        ...V3_LIQUIDATION,
        incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, legacyDestination: 'NONSENSE' }],
      }),
    ).rejects.toThrow('Liquidation incomeOffsetSnapshot');
  });

  it('normalizes missing legacyDestination to null', async () => {
    const { legacyDestination: _omit, ...withoutLegacy } = V3_OFFSET_ITEM;
    const [liquidation] = await listWith({
      ...V3_LIQUIDATION,
      incomeOffsetSnapshot: [withoutLegacy],
    });
    expect(liquidation.incomeOffsetSnapshot?.[0]?.legacyDestination).toBeNull();
  });

  it.each([
    ['period "abc"', 'abc'],
    ['period "2026-13"', '2026-13'],
    ['period "26-05"', '26-05'],
  ])('rejects malformed %s', async (_name, period) => {
    await expect(
      listWith({
        ...V3_LIQUIDATION,
        incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, period }],
      }),
    ).rejects.toThrow('Liquidation incomeOffsetSnapshot');
  });

  it('accepts valid period "2026-05"', async () => {
    const [liquidation] = await listWith({
      ...V3_LIQUIDATION,
      incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, period: '2026-05' }],
    });
    expect(liquidation.incomeOffsetSnapshot?.[0]?.period).toBe('2026-05');
  });

  it.each([
    ['applicationAmountMinor = 0', 'applicationAmountMinor'],
    ['buildingAmountMinor = 0', 'buildingAmountMinor'],
    ['valuedAmountMinor = 0', 'valuedAmountMinor'],
  ])('rejects zero item amount %s', async (_name, field) => {
    await expect(
      listWith({
        ...V3_LIQUIDATION,
        incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, [field]: 0 }],
      }),
    ).rejects.toThrow('Liquidation incomeOffsetSnapshot');
  });

  it('normalizes missing historical nullable fields to null', async () => {
    const {
      categoryName: _a,
      policyVersionId: _b,
      functionalCurrencyCode: _c,
      exchangeRateId: _d,
      exchangeRateValue: _e,
      exchangeRateDirection: _f,
      exchangeRateEffectiveAt: _g,
      conversionDate: _h,
      ...onlyRequired
    } = V3_OFFSET_ITEM;
    const [liquidation] = await listWith({
      ...V3_LIQUIDATION,
      incomeOffsetSnapshot: [onlyRequired],
    });
    const item = liquidation.incomeOffsetSnapshot?.[0];
    expect(item?.categoryName).toBeNull();
    expect(item?.policyVersionId).toBeNull();
    expect(item?.functionalCurrencyCode).toBeNull();
    expect(item?.exchangeRateId).toBeNull();
    expect(item?.exchangeRateValue).toBeNull();
    expect(item?.exchangeRateDirection).toBeNull();
    expect(item?.exchangeRateEffectiveAt).toBeNull();
    expect(item?.conversionDate).toBeNull();
  });

  it('rejects wrong-type nullable field (categoryName numeric)', async () => {
    await expect(
      listWith({
        ...V3_LIQUIDATION,
        incomeOffsetSnapshot: [{ ...V3_OFFSET_ITEM, categoryName: 42 }],
      }),
    ).rejects.toThrow('Liquidation incomeOffsetSnapshot');
  });

  it('creates one charge per billable unit when publishing', async () => {
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(tx.charge.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ unitId: 'unit-1', amount: 51, liquidationId: 'liq-1' }),
        expect.objectContaining({ unitId: 'unit-2', amount: 50, liquidationId: 'liq-1' }),
      ]),
    });
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'liq-1',
          tenantId: 'tenant-1',
          status: 'REVIEWED',
          publicationSnapshot: { equals: Prisma.DbNull },
        },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('returns an already published liquidation without creating duplicate charges', async () => {
    tx.liquidation.findFirst.mockResolvedValueOnce({
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    });

    const result = await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('rejects draft creation when the base currency is missing from totalsByCurrency', async () => {
    tx.liquidation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.expense.count.mockResolvedValueOnce(0);
    tx.expense.findMany
      .mockResolvedValueOnce([
        {
          id: 'exp-1',
          amountMinor: 100,
          currencyCode: 'ARS',
          invoiceDate: new Date('2026-05-01T00:00:00.000Z'),
          description: null,
          category: { name: 'Water' },
          vendor: { name: 'Vendor' },
          allocations: [],
        },
      ])
      .mockResolvedValueOnce([]);
    tx.adjustment.findMany.mockResolvedValueOnce([]);
    tx.unit.findMany.mockResolvedValueOnce([
      { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
    ]);

    await expect(service.createDraft('tenant-1', 'member-1', {
        buildingId: 'building-1',
        period: '2026-05',
        baseCurrency: 'USD',
      })).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_BASE_CURRENCY_MISMATCH',
          message: 'La moneda de los movimientos (ARS) no coincide con la moneda base de la liquidación (USD).',
        },
      });

    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it.each([
    ['ARS', ['ARS', 'ARS']],
    ['USD', ['USD', 'USD']],
  ])('creates a %s draft when every movement uses the base currency', async (baseCurrency, currencies) => {
    tx.liquidation.findFirst.mockResolvedValueOnce(null);
    tx.expense.findMany
      .mockResolvedValueOnce(currencies.map((currencyCode, index) => ({
        id: `exp-${index + 1}`,
        amountMinor: 100 + index,
        currencyCode,
        invoiceDate: new Date('2026-05-01T00:00:00.000Z'),
        description: null,
        category: { name: 'Water' },
        vendor: { name: 'Vendor' },
      })))
      .mockResolvedValueOnce([]);

    await service.createDraft('tenant-1', 'member-1', {
      buildingId: 'building-1', period: '2026-05', baseCurrency,
    });

    expect(tx.liquidation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-1', baseCurrency, totalAmountMinor: 201,
        totalsByCurrency: { [baseCurrency]: 201 },
      }),
    }));
  });

  it.each([
    ['MIXED_CURRENCY_LIQUIDATION_NOT_SUPPORTED', ['USD', 'ARS'], 'No se puede generar una liquidación con movimientos en distintas monedas.'],
    ['LIQUIDATION_BASE_CURRENCY_MISMATCH', ['USD', 'USD'], 'La moneda de los movimientos (USD) no coincide con la moneda base de la liquidación (ARS).'],
  ])('rejects invalid currencies with %s before financial writes', async (error, currencies, message) => {
    tx.liquidation.findFirst.mockResolvedValueOnce(null);
    tx.expense.findMany
      .mockResolvedValueOnce(currencies.map((currencyCode, index) => ({
        id: `exp-${index + 1}`, amountMinor: 100, currencyCode,
        invoiceDate: new Date('2026-05-01T00:00:00.000Z'), description: null,
        category: { name: 'Water' }, vendor: { name: 'Vendor' },
      })))
      .mockResolvedValueOnce([]);

    const promise = service.createDraft('tenant-1', 'member-1', {
      buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
    });

    await expect(promise).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(promise).rejects.toMatchObject({ response: { statusCode: 422, error, message } });
    expect(tx.unit.findMany).not.toHaveBeenCalled();
    expect(tx.liquidation.create).not.toHaveBeenCalled();
    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('guards included adjustments and preserves the existing empty behavior', async () => {
    tx.liquidation.findFirst.mockResolvedValueOnce(null);
    tx.adjustment.findMany.mockResolvedValueOnce([{
      id: 'adj-1', amountMinor: 100, currencyCode: 'USD',
      sourceInvoiceDate: new Date('2026-04-01T00:00:00.000Z'), sourcePeriod: '2026-04',
      reason: 'Correction', category: { name: 'Water' },
    }]);

    await expect(service.createDraft('tenant-1', 'member-1', {
      buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
    })).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_BASE_CURRENCY_MISMATCH' },
    });
    expect(tx.liquidation.create).not.toHaveBeenCalled();

    tx.liquidation.findFirst.mockResolvedValueOnce(null);
    tx.adjustment.findMany.mockResolvedValueOnce([]);
    await expect(service.createDraft('tenant-1', 'member-1', {
      buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
    })).rejects.toThrow('No hay gastos VALIDADOS ni ajustes');
  });

  it('rejects a legacy mixed-currency draft before publication writes', async () => {
    tx.liquidation.findFirst.mockResolvedValueOnce({
      ...baseLiquidation,
      totalsByCurrency: { ARS: 100, USD: 100 },
      expenseSnapshot: [
        { ...baseLiquidation.expenseSnapshot[0], amountMinor: 100 },
        { ...baseLiquidation.expenseSnapshot[0], expenseId: 'exp-2', amountMinor: 100, currencyCode: 'USD' },
      ],
    });

    await expect(service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    })).rejects.toMatchObject({
      response: { statusCode: 422, error: 'MIXED_CURRENCY_LIQUIDATION_NOT_SUPPORTED' },
    });
    expect(tx.unit.findMany).not.toHaveBeenCalled();
    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('finishes publication without creating charges when all charges already exist', async () => {
    tx.charge.findMany.mockResolvedValueOnce([
      {
        unitId: 'unit-1',
        amount: 51,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        buildingId: 'building-1',
        period: '2026-05',
        liquidationId: 'liq-1',
        concept: 'Expensas comunes 2026-05',
      },
      {
        unitId: 'unit-2',
        amount: 50,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        buildingId: 'building-1',
        period: '2026-05',
        liquidationId: 'liq-1',
        concept: 'Expensas comunes 2026-05',
      },
    ]);
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.charge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          liquidationId: 'liq-1',
          buildingId: 'building-1',
          period: '2026-05',
        },
      }),
    );
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'liq-1',
          tenantId: 'tenant-1',
          status: 'REVIEWED',
          publicationSnapshot: { equals: Prisma.DbNull },
        },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('rejects publish when only some charges already exist', async () => {
    tx.charge.findMany.mockResolvedValueOnce([
      {
        unitId: 'unit-1',
        amount: 51,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        buildingId: 'building-1',
        period: '2026-05',
        liquidationId: 'liq-1',
        concept: 'Expensas comunes 2026-05',
      },
    ]);

    await expect(
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.charge.createMany).not.toHaveBeenCalled();
  });

  it('rejects publish when existing charges do not match the publication snapshot', async () => {
    tx.charge.findMany.mockResolvedValueOnce([
      {
        unitId: 'unit-1',
        amount: 999,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        buildingId: 'building-1',
        period: '2026-05',
        liquidationId: 'liq-1',
        concept: 'Expensas comunes 2026-05',
      },
      {
        unitId: 'unit-2',
        amount: 50,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        buildingId: 'building-1',
        period: '2026-05',
        liquidationId: 'liq-1',
        concept: 'Expensas comunes 2026-05',
      },
    ]);

    await expect(
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.charge.createMany).not.toHaveBeenCalled();
  });

  it('rejects a concurrent publication of another liquidation for the same period inside the transaction', async () => {
    const publishedOtherLiquidation = {
      ...baseLiquidation,
      id: 'liq-2',
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };

    tx.liquidation.findFirst
      .mockResolvedValueOnce(baseLiquidation)
      .mockResolvedValueOnce({ status: 'REVIEWED' })
      .mockResolvedValueOnce(publishedOtherLiquidation);

    await expect(
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).rejects.toThrow(ConflictException);

    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('returns the current published liquidation when publication completes concurrently', async () => {
    const publishedLiquidation = {
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };

    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'PUBLISHED' })
      .mockResolvedValueOnce(publishedLiquidation);

    const result = await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('returns the published liquidation after a serializable conflict when the row is already published', async () => {
    const serializationError = new Error('Transaction conflict');
    Object.assign(serializationError, { code: 'P2034' });
    Object.setPrototypeOf(serializationError, Prisma.PrismaClientKnownRequestError.prototype);

    const publishedLiquidation = {
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };

    prisma.$transaction.mockRejectedValueOnce(serializationError);
    prisma.liquidation.findFirst.mockResolvedValueOnce(publishedLiquidation);

    const result = await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.charge.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['DRAFT', 'draft'],
    ['REVIEWED', 'approved'],
  ])('cancels a %s liquidation transactionally without hard deleting it', async (status) => {
    const liquidation = {
      ...baseLiquidation,
      status,
      reviewedAt: status === 'REVIEWED' ? new Date('2026-05-02T00:00:00.000Z') : null,
    };

    prisma.liquidation.findFirst.mockResolvedValue(liquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(liquidation)
      .mockResolvedValueOnce({
        ...liquidation,
        status: 'CANCELED',
        canceledAt: new Date('2026-05-03T00:00:00.000Z'),
        canceledByMembershipId: 'member-1',
      });
    tx.liquidation.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.cancelLiquidation(
      'tenant-1',
      'liq-1',
      'member-1',
      { reason: 'Board decision' },
    );

    expect(result.status).toBe('CANCELED');
    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(tx.liquidation.delete).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_CANCEL',
        entityType: 'Liquidation',
        entityId: 'liq-1',
        metadata: expect.objectContaining({
          period: '2026-05',
          buildingId: 'building-1',
          previousStatus: status,
          reason: 'Board decision',
        }),
      }),
      tx,
    );
  });

  it('rejects cancellation of a published liquidation', async () => {
    const publishedLiquidation = {
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };
    prisma.liquidation.findFirst.mockResolvedValue(publishedLiquidation);
    tx.liquidation.findFirst.mockResolvedValue(publishedLiquidation);

    await expect(
      service.cancelLiquidation(
        'tenant-1',
        'liq-1',
        'member-1',
        { reason: 'Board decision' },
      ),
    ).rejects.toThrow(ConflictException);

    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('uses a fallback reason when none is provided', async () => {
    const draftLiquidation = {
      ...baseLiquidation,
      status: 'DRAFT',
    };
    prisma.liquidation.findFirst.mockResolvedValue(draftLiquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce({
        ...draftLiquidation,
        status: 'CANCELED',
        canceledAt: new Date('2026-05-03T00:00:00.000Z'),
        canceledByMembershipId: 'member-1',
      });
    tx.liquidation.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          reason: 'No reason provided',
        }),
      }),
      tx,
    );
  });

  it('rejects cancellation when the requested buildingId does not match', async () => {
    const publishedLiquidation = {
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };
    prisma.liquidation.findFirst.mockResolvedValue(publishedLiquidation);
    tx.liquidation.findFirst.mockResolvedValue(publishedLiquidation);

    await expect(
      service.cancelLiquidation('tenant-1', 'liq-1', 'member-1', {
        buildingId: 'building-2',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('rejects cancellation for resident roles', async () => {
    validators.isAdminOrOperator.mockReturnValue(false);

    await expect(
      service.cancelLiquidation('tenant-1', 'liq-1', 'member-1'),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.liquidation.findFirst).not.toHaveBeenCalled();
  });

  it('returns not found for another tenant', async () => {
    prisma.liquidation.findFirst.mockResolvedValue(null);

    await expect(
      service.cancelLiquidation('tenant-2', 'liq-1', 'member-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns an already canceled liquidation without mutating it again', async () => {
    const canceledLiquidation = {
      ...baseLiquidation,
      status: 'CANCELED',
      canceledAt: new Date('2026-05-03T00:00:00.000Z'),
    };
    prisma.liquidation.findFirst.mockResolvedValue(canceledLiquidation);

    const result = await service.cancelLiquidation(
      'tenant-1',
      'liq-1',
      'member-1',
    );

    expect(result.status).toBe('CANCELED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not hard delete liquidation records or their charges', async () => {
    const draftLiquidation = {
      ...baseLiquidation,
      status: 'DRAFT',
    };
    prisma.liquidation.findFirst.mockResolvedValue(draftLiquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce({
        ...draftLiquidation,
        status: 'CANCELED',
        canceledAt: new Date('2026-05-03T00:00:00.000Z'),
        canceledByMembershipId: 'member-1',
      });
    tx.liquidation.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(prisma.liquidation.delete).not.toHaveBeenCalled();
    expect(tx.liquidation.delete).not.toHaveBeenCalled();
    expect(tx.charge.deleteMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith({
      where: { id: 'liq-1', tenantId: 'tenant-1', canceledAt: null, status: { not: 'CANCELED' } },
      data: {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        canceledByMembershipId: 'member-1',
      },
    });
  });

  it('scopes notification lookups by tenant when publishing', async () => {
    tx.charge.count.mockResolvedValueOnce(2);
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });
    prisma.charge.findMany.mockResolvedValueOnce([
      {
        id: 'charge-1',
        unitId: 'unit-1',
        amount: 100,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
      },
    ]);

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(prisma.charge.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', liquidationId: 'liq-1' },
    });
    expect(prisma.unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          id: 'unit-1',
        },
      }),
    );
  });

  it('continues notification dispatch when one recipient fails', async () => {
    tx.charge.count.mockResolvedValueOnce(2);
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });
    prisma.charge.findMany.mockResolvedValueOnce([
      {
        id: 'charge-1',
        unitId: 'unit-1',
        amount: 100,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
      },
    ]);
    prisma.unit.findFirst.mockResolvedValueOnce({
      id: 'unit-1',
      label: '1A',
      unitOccupants: [
        {
          member: { id: 'member-1', user: { id: 'user-1' } },
        },
        {
          member: { id: 'member-2', user: { id: 'user-2' } },
        },
      ],
    });
    const notifications = notificationsService.createNotification;
    notifications
      .mockRejectedValueOnce(new Error('notification failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-2',
      }),
    );
    expect(notifications).not.toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    );
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_PUBLISH',
        entityType: 'Liquidation',
        entityId: 'liq-1',
        metadata: expect.objectContaining({
          snapshotVersion: 2,
          dueDate: '2026-06-10',
        }),
      }),
      tx,
    );
    expect(prisma.unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          id: 'unit-1',
        },
      }),
    );
  });

  it('is idempotent when the same liquidation is canceled twice', async () => {
    const draftLiquidation = {
      ...baseLiquidation,
      status: 'DRAFT',
    };
    const canceledLiquidation = {
      ...baseLiquidation,
      status: 'CANCELED',
      canceledAt: new Date('2026-05-03T00:00:00.000Z'),
    };

    prisma.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce(canceledLiquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce({
        ...draftLiquidation,
        status: 'CANCELED',
        canceledAt: new Date('2026-05-03T00:00:00.000Z'),
        canceledByMembershipId: 'member-1',
      });
    tx.liquidation.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');
    const secondResult = await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(secondResult.status).toBe('CANCELED');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.liquidation.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith({
      where: { id: 'liq-1', tenantId: 'tenant-1', canceledAt: null, status: { not: 'CANCELED' } },
      data: {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        canceledByMembershipId: 'member-1',
      },
    });
    expect(auditService.createLogRequired).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('treats a concurrent cancellation race as idempotent when the record is already canceled', async () => {
    const draftLiquidation = {
      ...baseLiquidation,
      status: 'DRAFT',
    };
    const canceledLiquidation = {
      ...baseLiquidation,
      status: 'CANCELED',
      canceledAt: new Date('2026-05-03T00:00:00.000Z'),
    };

    prisma.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce(canceledLiquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce(canceledLiquidation);
    tx.liquidation.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(result.status).toBe('CANCELED');
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith({
      where: { id: 'liq-1', tenantId: 'tenant-1', canceledAt: null, status: { not: 'CANCELED' } },
      data: {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        canceledByMembershipId: 'member-1',
      },
    });
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('applies the same finance membership validation in the service path and the publication use case', async () => {
    (prisma.membership.findFirst as jest.Mock).mockResolvedValueOnce(null);
    tx.membership.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.listLiquidations('tenant-1', 'member-1', {}),
    ).rejects.toThrow('No se encontró una membresía válida para el tenant');

    await expect(
      publicationUseCase.execute(
        'tenant-1',
        'liq-1',
        'member-1',
        { dueDate: '2026-06-10' },
        'disabled',
      ),
    ).rejects.toThrow('No se encontró una membresía válida para el tenant');
  });

  describe('FIN-06 createDraft with income offsets', () => {
    const offsetIncome = {
      id: 'income-1',
      buildingId: 'building-1',
      period: '2026-05',
      scopeType: 'BUILDING',
      status: 'RECORDED',
      functionalAmountMinor: null,
      functionalCurrencyCode: null,
      exchangeRateId: null,
      exchangeRateValue: null,
      exchangeRateDirection: null,
      exchangeRateEffectiveAt: null,
      conversionDate: null,
      receivedDate: new Date('2026-05-10T00:00:00.000Z'),
      categoryId: 'cat-1',
      category: { name: 'Parrillera' },
      allocations: [],
      applications: [
        {
          id: 'app-offset-1',
          destinationType: 'OFFSET_EXPENSES',
          amountMinor: 7000,
          currencyCode: 'ARS',
          policyVersionId: 'pv-1',
        },
      ],
    };

    function mockExpenses(totalAmountMinor: number) {
      tx.liquidation.findFirst.mockResolvedValueOnce(null);
      tx.expense.findMany
        .mockResolvedValueOnce([
          {
            id: 'exp-1',
            amountMinor: totalAmountMinor,
            currencyCode: 'ARS',
            invoiceDate: new Date('2026-05-01T00:00:00.000Z'),
            description: null,
            category: { name: 'Water' },
            vendor: { name: 'Vendor' },
          },
        ])
        .mockResolvedValueOnce([]);
      tx.adjustment.findMany.mockResolvedValueOnce([]);
      tx.unit.findMany.mockResolvedValueOnce([
        { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
        { id: 'unit-2', code: '1B', label: '1B', unitCategory: null },
      ]);
    }

    function mockOffsetIncome(income: unknown) {
      const record = income as { id: string; status?: string; period?: string };
      // collectEligibleOffsets (FIN-06R2):
      // 1. query inicial SOLO de IDs candidatos
      // 2. reload COMPLETO post-lock (income + applications + allocations)
      tx.income.findMany
        .mockResolvedValueOnce([{ id: record.id }])
        .mockResolvedValueOnce(
          (record.status ?? 'RECORDED') === 'RECORDED' &&
            (record.period ?? '2026-05') === '2026-05'
            ? [income]
            : [],
        );
    }

    it('reduces the net distributable by eligible OFFSET applications', async () => {
      mockExpenses(10000);
      mockOffsetIncome(offsetIncome);
      tx.incomeApplication.findMany.mockResolvedValueOnce([]);
      (tx.liquidation.create as jest.Mock).mockResolvedValue({
        ...baseLiquidation,
        status: 'DRAFT',
        totalAmountMinor: 3000,
        grossExpenseAmountMinor: 10000,
        adjustmentAmountMinor: 0,
        preIncomeAmountMinor: 10000,
        incomeOffsetAmountMinor: 7000,
        netDistributableAmountMinor: 3000,
        publicationSnapshot: null,
      });

      await service.createDraft('tenant-1', 'member-1', {
        buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
      });

      expect(tx.liquidation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          totalAmountMinor: 3000,
          grossExpenseAmountMinor: 10000,
          adjustmentAmountMinor: 0,
          preIncomeAmountMinor: 10000,
          incomeOffsetAmountMinor: 7000,
          netDistributableAmountMinor: 3000,
        }),
      }));
      expect(tx.liquidationIncomeOffset.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            incomeApplicationId: 'app-offset-1',
            buildingId: 'building-1',
            originalAmountMinor: 7000,
            valuedAmountMinor: 7000,
            baseCurrency: 'ARS',
          }),
        ],
      });
    });

    it('rejects the draft when offsets exceed the pre-income total', async () => {
      mockExpenses(5000);
      mockOffsetIncome(offsetIncome);

      await expect(service.createDraft('tenant-1', 'member-1', {
        buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
      })).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS',
        },
      });

      expect(tx.liquidation.create).not.toHaveBeenCalled();
      expect(tx.liquidationIncomeOffset.createMany).not.toHaveBeenCalled();
    });

    it('ignores FUND and CARRY_FORWARD applications (no net reduction)', async () => {
      mockExpenses(10000);
      mockOffsetIncome({
        ...offsetIncome,
        applications: [
          { id: 'app-fund', destinationType: 'FUND', amountMinor: 10000, currencyCode: 'ARS', policyVersionId: null },
        ],
      });

      await service.createDraft('tenant-1', 'member-1', {
        buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
      });

      expect(tx.liquidation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          totalAmountMinor: 10000,
          incomeOffsetAmountMinor: 0,
        }),
      }));
    });

    it('rejects cross-currency nominal offsets', async () => {
      mockExpenses(10000);
      mockOffsetIncome({
        ...offsetIncome,
        applications: [
          { id: 'app-usd', destinationType: 'OFFSET_EXPENSES', amountMinor: 1000, currencyCode: 'USD', policyVersionId: null },
        ],
      });

      await expect(service.createDraft('tenant-1', 'member-1', {
        buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
      })).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH',
        },
      });
    });

    it('ignores OFFSET from a VOID income (not eligible)', async () => {
      mockExpenses(10000);
      mockOffsetIncome({ ...offsetIncome, status: 'VOID' });

      await service.createDraft('tenant-1', 'member-1', {
        buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
      });

      expect(tx.liquidation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          totalAmountMinor: 10000,
          incomeOffsetAmountMinor: 0,
        }),
      }));
    });

    it('ignores OFFSET from another period', async () => {
      mockExpenses(10000);
      mockOffsetIncome({ ...offsetIncome, period: '2026-04' });

      await service.createDraft('tenant-1', 'member-1', {
        buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
      });

      expect(tx.liquidation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          totalAmountMinor: 10000,
          incomeOffsetAmountMinor: 0,
        }),
      }));
    });

    it('supports exact zero net (offset == pre-income)', async () => {
      mockExpenses(10000);
      mockOffsetIncome({
        ...offsetIncome,
        applications: [
          { id: 'app-offset-1', destinationType: 'OFFSET_EXPENSES', amountMinor: 10000, currencyCode: 'ARS', policyVersionId: null },
        ],
      });

      await service.createDraft('tenant-1', 'member-1', {
        buildingId: 'building-1', period: '2026-05', baseCurrency: 'ARS',
      });

      expect(tx.liquidation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          totalAmountMinor: 0,
          incomeOffsetAmountMinor: 10000,
          netDistributableAmountMinor: 0,
        }),
      }));
    });
  });
});

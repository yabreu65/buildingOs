import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';
import { CurrencyConversionService } from './currency-conversion.service';

const makeSharedExpense = (overrides: Record<string, unknown> = {}) => ({
  id: 'exp-shared-1',
  tenantId: 'tenant-1',
  buildingId: null,
  period: '2026-08',
  liquidationPeriod: '2026-08',
  categoryId: 'cat-1',
  vendorId: 'vendor-1',
  amountMinor: 1000,
  currencyCode: 'USD',
  invoiceDate: new Date('2026-08-09T00:00:00.000Z'),
  description: null,
  attachmentFileKey: null,
  status: 'DRAFT',
  scopeType: 'TENANT_SHARED',
  unitGroupId: null,
  functionalAmountMinor: null,
  functionalCurrencyCode: null,
  exchangeRateId: null,
  exchangeRateValue: null,
  exchangeRateDirection: null,
  exchangeRateEffectiveAt: null,
  conversionDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  category: { name: 'Shared' },
  vendor: { name: 'Vendor' },
  ...overrides,
});

describe('ExpensesService TENANT_SHARED functional allocation', () => {
  let service: ExpensesService;
  let prisma: PrismaService;
  let exchangeRateFindFirst: jest.Mock;
  let allocationUpdates: Array<{ id: string; data: Record<string, unknown> }>;

  beforeEach(async () => {
    exchangeRateFindFirst = jest.fn();
    allocationUpdates = [];

    const prismaValue = {
      expense: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      tenant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          functionalCurrency: 'VES',
        }),
      },
      exchangeRate: { findFirst: exchangeRateFindFirst },
      liquidation: { findFirst: jest.fn() },
      expenseLedgerCategory: { findFirst: jest.fn() },
      vendor: { findFirst: jest.fn() },
      unitGroup: { findFirst: jest.fn() },
      adjustment: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      movementAllocation: {
        findMany: jest.fn(),
        update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          allocationUpdates.push({ id: where.id, data });
          return Promise.resolve({ id: where.id, ...data });
        }),
      },
      $transaction: jest.fn((callback: (client: typeof prismaValue) => unknown) =>
        callback(prismaValue),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: prismaValue },
        { provide: AuditService, useValue: { createLog: jest.fn() } },
        {
          provide: FinanzasValidators,
          useValue: { isAdminOrOperator: jest.fn().mockReturnValue(true) },
        },
        {
          provide: MovementAllocationService,
          useValue: { createForExpense: jest.fn() },
        },
        {
          provide: CurrencyConversionService,
          useFactory: (prismaService: PrismaService) =>
            new CurrencyConversionService(prismaService),
          inject: [PrismaService],
        },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  const validate = () =>
    service.validateExpense('tenant-1', 'exp-shared-1', 'member-1', ['TENANT_ADMIN']);

  const setup = (allocations: Array<{ id: string; amountMinor: number; percentage: number | null }>) => {
    (prisma.expense.findFirst as jest.Mock).mockResolvedValue(makeSharedExpense());
    exchangeRateFindFirst.mockResolvedValue({
      id: 'rate-1',
      rate: new Prisma.Decimal('36.5'),
      effectiveAt: new Date('2026-08-08T00:00:00.000Z'),
    });
    (prisma.movementAllocation.findMany as jest.Mock).mockResolvedValue(allocations);
    (prisma.expense.update as jest.Mock).mockResolvedValue(
      makeSharedExpense({
        status: 'VALIDATED',
        functionalAmountMinor: 36500,
        functionalCurrencyCode: 'VES',
        exchangeRateId: 'rate-1',
        exchangeRateValue: new Prisma.Decimal('36.5'),
        exchangeRateDirection: 'DIRECT',
        exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
        conversionDate: new Date('2026-08-09T00:00:00.000Z'),
      }),
    );
  };

  it('distributes the functional amount by percentage-created nominal weights (60/40)', async () => {
    setup([
      { id: 'alloc-1', amountMinor: 600, percentage: 60 },
      { id: 'alloc-2', amountMinor: 400, percentage: 40 },
    ]);

    const result = await validate();

    expect(result.functionalAmountMinor).toBe(36500);
    expect(allocationUpdates).toHaveLength(2);
    const shares = allocationUpdates.map((update) => update.data.functionalAmountMinor);
    expect(shares).toEqual([21900, 14600]);
    expect(
      allocationUpdates.every((update) => update.data.functionalCurrencyCode === 'VES'),
    ).toBe(true);
    expect(shares.reduce((sum, share) => sum + (share as number), 0)).toBe(36500);
  });

  it('distributes by amount-mode nominal weights and preserves exact sum', async () => {
    setup([
      { id: 'alloc-1', amountMinor: 250, percentage: null },
      { id: 'alloc-2', amountMinor: 750, percentage: null },
    ]);

    await validate();

    const shares = allocationUpdates.map((update) => update.data.functionalAmountMinor);
    expect(shares).toEqual([9125, 27375]);
    expect(shares.reduce((sum, share) => sum + (share as number), 0)).toBe(36500);
  });

  it('handles thirds with a deterministic residual and exact total', async () => {
    setup([
      { id: 'alloc-1', amountMinor: 333, percentage: 33.3 },
      { id: 'alloc-2', amountMinor: 333, percentage: 33.3 },
      { id: 'alloc-3', amountMinor: 334, percentage: 33.4 },
    ]);

    await validate();

    const shares = allocationUpdates.map((update) => update.data.functionalAmountMinor);
    const total = (shares as number[]).reduce((sum, share) => sum + share, 0);
    expect(total).toBe(36500);
    expect(shares.every((share) => Number.isSafeInteger(share))).toBe(true);
  });

  it('leaves allocations untouched for BUILDING scope expenses', async () => {
    (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
      makeSharedExpense({ id: 'exp-building', scopeType: 'BUILDING', buildingId: 'building-1' }),
    );
    exchangeRateFindFirst.mockResolvedValue({
      id: 'rate-1',
      rate: new Prisma.Decimal('36.5'),
      effectiveAt: new Date('2026-08-08T00:00:00.000Z'),
    });
    (prisma.expense.update as jest.Mock).mockResolvedValue(
      makeSharedExpense({ scopeType: 'BUILDING', buildingId: 'building-1', status: 'VALIDATED' }),
    );

    await service.validateExpense('tenant-1', 'exp-building', 'member-1', ['TENANT_ADMIN']);

    expect(prisma.movementAllocation.findMany).not.toHaveBeenCalled();
    expect(prisma.movementAllocation.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

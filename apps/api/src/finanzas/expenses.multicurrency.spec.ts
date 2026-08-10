import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';
import { CurrencyConversionService } from './currency-conversion.service';

const makeExpense = (overrides: Record<string, unknown> = {}) => ({
  id: 'expense-1',
  tenantId: 'tenant-1',
  buildingId: 'building-1',
  period: '2026-08',
  liquidationPeriod: '2026-08',
  categoryId: 'cat-1',
  vendorId: 'vendor-1',
  amountMinor: 1000,
  currencyCode: 'ARS',
  invoiceDate: new Date('2026-08-09T00:00:00.000Z'),
  description: null,
  attachmentFileKey: null,
  status: 'DRAFT',
  scopeType: 'BUILDING',
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
  category: { name: 'Maintenance' },
  vendor: { name: 'Vendor' },
  ...overrides,
});

const validatedExpense = (snapshot: Record<string, unknown>) =>
  makeExpense({ status: 'VALIDATED', ...snapshot });

describe('ExpensesService multicurrency snapshot', () => {
  let service: ExpensesService;
  let prisma: PrismaService;
  let exchangeRateFindFirst: jest.Mock;

  const rate = (
    overrides: Partial<{
      id: string;
      rate: string;
      effectiveAt: Date;
    }> = {},
  ) => ({
    id: overrides.id ?? 'rate-1',
    rate: new Prisma.Decimal(overrides.rate ?? '36.500000000001'),
    effectiveAt: overrides.effectiveAt ?? new Date('2026-08-08T00:00:00.000Z'),
  });

  beforeEach(async () => {
    exchangeRateFindFirst = jest.fn();

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
    service.validateExpense('tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN']);

  const validateFromBulk = () =>
    service.validateExpenseFromBulk('tenant-1', 'expense-1', 'member-1');

  const lastUpdateData = (): Record<string, unknown> => {
    expect(prisma.expense.update).toHaveBeenCalledTimes(1);
    const call = (prisma.expense.update as jest.Mock).mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return call[0].data;
  };

  const expectTenantScopedLookups = (tenantId: string) => {
    expect(
      (prisma.tenant.findFirst as jest.Mock).mock.calls.every(
        ([query]) => query.where.id === tenantId,
      ),
    ).toBe(true);
    expect(
      exchangeRateFindFirst.mock.calls.every(
        ([query]) => query.where.tenantId === tenantId,
      ),
    ).toBe(true);
  };

  describe('IDENTITY (original === functional)', () => {
    beforeEach(() => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({
        id: 'tenant-1',
        functionalCurrency: 'ARS',
      });
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ currencyCode: 'ARS', amountMinor: 1250 }) as never,
      );
      (prisma.expense.update as jest.Mock).mockResolvedValue(
        validatedExpense({
          currencyCode: 'ARS',
          amountMinor: 1250,
          functionalAmountMinor: 1250,
          functionalCurrencyCode: 'ARS',
          exchangeRateId: null,
          exchangeRateValue: '1',
          exchangeRateDirection: 'IDENTITY',
          exchangeRateEffectiveAt: null,
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }) as never,
      );
    });

    it('persists an identity snapshot in the same update that validates, without rate lookups', async () => {
      const result = await validate();

      expect(result.status).toBe('VALIDATED');
      expect(result.functionalAmountMinor).toBe(1250);
      expect(result.functionalCurrencyCode).toBe('ARS');
      expect(result.exchangeRateValue).toBe('1');
      expect(result.exchangeRateDirection).toBe('IDENTITY');
      expect(result.exchangeRateId).toBeNull();
      expect(result.exchangeRateEffectiveAt).toBeNull();
      expect(result.conversionDate?.toISOString()).toBe('2026-08-09T00:00:00.000Z');

      expect(lastUpdateData()).toMatchObject({
        status: 'VALIDATED',
        validatedByMembershipId: 'member-1',
        functionalAmountMinor: 1250,
        functionalCurrencyCode: 'ARS',
        exchangeRateValue: '1',
        exchangeRateDirection: 'IDENTITY',
        exchangeRateId: null,
        exchangeRateEffectiveAt: null,
      });
      expect(exchangeRateFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('DIRECT', () => {
    beforeEach(() => {
      exchangeRateFindFirst.mockResolvedValue(rate());
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ currencyCode: 'USD', amountMinor: 100 }) as never,
      );
      (prisma.expense.update as jest.Mock).mockResolvedValue(
        validatedExpense({
          currencyCode: 'USD',
          amountMinor: 100,
          functionalAmountMinor: 3650,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: '36.500000000001',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }) as never,
      );
    });

    it('converts with the source rate and persists applied rate, source id, effectiveAt and date', async () => {
      const result = await validate();

      expect(result.functionalAmountMinor).toBe(3650);
      expect(result.functionalCurrencyCode).toBe('VES');
      expect(result.exchangeRateId).toBe('rate-1');
      expect(result.exchangeRateValue).toBe('36.500000000001');
      expect(result.exchangeRateDirection).toBe('DIRECT');
      expect(result.exchangeRateEffectiveAt?.toISOString()).toBe(
        '2026-08-08T00:00:00.000Z',
      );
      expect(result.conversionDate?.toISOString()).toBe('2026-08-09T00:00:00.000Z');

      expect(lastUpdateData()).toMatchObject({
        status: 'VALIDATED',
        functionalAmountMinor: 3650,
        functionalCurrencyCode: 'VES',
        exchangeRateId: 'rate-1',
        exchangeRateValue: '36.500000000001',
        exchangeRateDirection: 'DIRECT',
      });
      expect(exchangeRateFindFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          baseCurrency: 'USD',
          quoteCurrency: 'VES',
          effectiveAt: { lte: new Date('2026-08-09T00:00:00.000Z') },
        },
        orderBy: { effectiveAt: 'desc' },
        select: { id: true, rate: true, effectiveAt: true },
      });
      expect(exchangeRateFindFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('INVERSE', () => {
    beforeEach(() => {
      exchangeRateFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          rate({ id: 'inverse-rate-1', rate: '4' }),
        );
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ currencyCode: 'USD', amountMinor: 100 }) as never,
      );
      (prisma.expense.update as jest.Mock).mockResolvedValue(
        validatedExpense({
          currencyCode: 'USD',
          amountMinor: 100,
          functionalAmountMinor: 25,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'inverse-rate-1',
          exchangeRateValue: '0.25',
          exchangeRateDirection: 'INVERSE',
          exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }) as never,
      );
    });

    it('falls back to the reciprocal rate and persists applied reciprocal + source row id', async () => {
      const result = await validate();

      expect(result.functionalAmountMinor).toBe(25);
      expect(result.exchangeRateId).toBe('inverse-rate-1');
      expect(result.exchangeRateValue).toBe('0.25');
      expect(result.exchangeRateDirection).toBe('INVERSE');

      expect(lastUpdateData()).toMatchObject({
        functionalAmountMinor: 25,
        exchangeRateId: 'inverse-rate-1',
        exchangeRateValue: '0.25',
        exchangeRateDirection: 'INVERSE',
      });
      expect(exchangeRateFindFirst).toHaveBeenNthCalledWith(2, {
        where: {
          tenantId: 'tenant-1',
          baseCurrency: 'VES',
          quoteCurrency: 'USD',
          effectiveAt: { lte: new Date('2026-08-09T00:00:00.000Z') },
        },
        orderBy: { effectiveAt: 'desc' },
        select: { id: true, rate: true, effectiveAt: true },
      });
    });
  });

  describe('missing rate', () => {
    let draftExpense: Record<string, unknown>;

    beforeEach(() => {
      exchangeRateFindFirst.mockResolvedValue(null);
      draftExpense = makeExpense({ currencyCode: 'USD', amountMinor: 100 });
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(draftExpense);
    });

    it('propagates EXCHANGE_RATE_NOT_FOUND 422 and never calls expense.update (stays DRAFT)', async () => {
      const error = await validate().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        code: 'EXCHANGE_RATE_NOT_FOUND',
        originalCurrency: 'USD',
        functionalCurrency: 'VES',
        conversionDate: '2026-08-09',
      });
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });

    it('keeps the expense DRAFT with no partial snapshot through the bulk path', async () => {
      const error = await validateFromBulk().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.expense.update).not.toHaveBeenCalled();
      expect(draftExpense.status).toBe('DRAFT');
    });
  });

  describe('invalid rate', () => {
    beforeEach(() => {
      exchangeRateFindFirst.mockResolvedValue(rate({ rate: '0' }));
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ currencyCode: 'USD', amountMinor: 100 }) as never,
      );
    });

    it('propagates INVALID_EXCHANGE_RATE 422 without updating the expense', async () => {
      const error = await validate().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'INVALID_EXCHANGE_RATE',
      });
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });
  });

  describe('tenant isolation', () => {
    beforeEach(() => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ currencyCode: 'USD', amountMinor: 100 }) as never,
      );
      (prisma.expense.update as jest.Mock).mockResolvedValue(
        validatedExpense({
          currencyCode: 'USD',
          amountMinor: 100,
          functionalAmountMinor: 1000,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'other-tenant-rate',
          exchangeRateValue: '10',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }) as never,
      );
    });

    it('never uses a rate that belongs to another tenant', async () => {
      exchangeRateFindFirst.mockImplementation(
        async ({ where }: { where: { tenantId: string } }) =>
          where.tenantId === 'tenant-other' ? rate() : null,
      );

      const error = await validate().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.expense.update).not.toHaveBeenCalled();
      expectTenantScopedLookups('tenant-1');
    });

    it('scopes tenant lookup and every rate query by the acting tenantId', async () => {
      exchangeRateFindFirst.mockResolvedValue(rate({ id: 'tenant-1-rate' }));
      (prisma.expense.update as jest.Mock).mockResolvedValue(
        validatedExpense({
          currencyCode: 'USD',
          amountMinor: 100,
          functionalAmountMinor: 3650,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'tenant-1-rate',
          exchangeRateValue: '36.500000000001',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }) as never,
      );

      await validate();

      expectTenantScopedLookups('tenant-1');
    });

    it('fails with NotFound when the tenant does not exist', async () => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(null);

      const error = await validate().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.expense.update).not.toHaveBeenCalled();
      expect(exchangeRateFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('conversion date', () => {
    beforeEach(() => {
      (prisma.expense.update as jest.Mock).mockResolvedValue(
        validatedExpense({}) as never,
      );
    });

    it('derives the UTC date-only from invoiceDate regardless of time-of-day', async () => {
      exchangeRateFindFirst.mockResolvedValue(rate());
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({
          currencyCode: 'USD',
          amountMinor: 100,
          invoiceDate: new Date('2026-08-09T23:45:00.000Z'),
        }) as never,
      );

      await validate();

      expect(exchangeRateFindFirst.mock.calls[0][0].where.effectiveAt).toEqual({
        lte: new Date('2026-08-09T00:00:00.000Z'),
      });
      expect(lastUpdateData()).toMatchObject({
        conversionDate: new Date('2026-08-09T00:00:00.000Z'),
      });
    });

    it('uses same-day rate, prior rate, and never a future rate', async () => {
      exchangeRateFindFirst
        .mockResolvedValueOnce(rate({ id: 'same-day' }))
        .mockResolvedValueOnce(rate({ id: 'future' }));
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ currencyCode: 'USD', amountMinor: 100 }) as never,
      );

      await validate();

      expect(exchangeRateFindFirst.mock.calls[0][0].where).toMatchObject({
        effectiveAt: { lte: new Date('2026-08-09T00:00:00.000Z') },
      });
      expect(exchangeRateFindFirst.mock.calls[0][0].orderBy).toEqual({
        effectiveAt: 'desc',
      });
    });
  });

  describe('immutability', () => {
    it('stores the snapshot as a value: later ExchangeRate edits do not change the persisted snapshot', async () => {
      exchangeRateFindFirst
        .mockResolvedValueOnce(
          rate({ id: 'rate-1', rate: '36.5', effectiveAt: new Date('2026-08-08T00:00:00.000Z') }),
        )
        .mockResolvedValueOnce(
          rate({ id: 'rate-2', rate: '1000', effectiveAt: new Date('2026-08-10T00:00:00.000Z') }),
        );
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ currencyCode: 'USD', amountMinor: 100 }) as never,
      );
      (prisma.expense.update as jest.Mock).mockResolvedValue(
        validatedExpense({
          currencyCode: 'USD',
          amountMinor: 100,
          functionalAmountMinor: 3650,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: '36.5',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }) as never,
      );

      const persisted = await validate();

      expect(exchangeRateFindFirst).toHaveBeenCalledTimes(1);
      expect(persisted.exchangeRateId).toBe('rate-1');
      expect(persisted.exchangeRateValue).toBe('36.5');
      expect(persisted.functionalAmountMinor).toBe(3650);
      expect(lastUpdateData()).toMatchObject({ exchangeRateValue: '36.5' });
    });

    it('rejects updating a VALIDATED expense through the existing DRAFT-only lifecycle', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ status: 'VALIDATED' }) as never,
      );

      await expect(
        service.updateExpense(
          'tenant-1',
          'expense-1',
          'member-1',
          ['TENANT_ADMIN'],
          { description: 'late edit' },
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });
  });

  describe('precision', () => {
    beforeEach(() => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ currencyCode: 'USD', amountMinor: 100 }) as never,
      );
    });

    it.each([
      ['12-decimal rate', '1.123456789012', 112],
      ['small rate', '0.000000000001', 0],
    ])(
      'converts %s exactly and persists the fixed-point applied rate without exponent',
      async (_label, sourceRate, expectedFunctionalAmount) => {
        exchangeRateFindFirst.mockResolvedValue(rate({ rate: sourceRate }));
        (prisma.expense.update as jest.Mock).mockResolvedValue(
          validatedExpense({
            currencyCode: 'USD',
            amountMinor: 100,
            functionalAmountMinor: expectedFunctionalAmount,
            functionalCurrencyCode: 'VES',
            exchangeRateId: 'rate-1',
            exchangeRateValue: sourceRate,
            exchangeRateDirection: 'DIRECT',
            exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
            conversionDate: new Date('2026-08-09T00:00:00.000Z'),
          }) as never,
        );

        const result = await validate();

        expect(result.functionalAmountMinor).toBe(expectedFunctionalAmount);
        expect(result.exchangeRateValue).toBe(sourceRate);
        expect(result.exchangeRateValue).not.toMatch(/[eE]/);
        expect(lastUpdateData()).toMatchObject({ exchangeRateValue: sourceRate });
      },
    );

    it.each([
      ['even-down tie', '2.5', 1, 2],
      ['odd-up tie', '3.5', 1, 4],
    ])(
      'uses ROUND_HALF_EVEN for %s',
      async (_label, sourceRate, amountMinor, expectedFunctionalAmount) => {
        exchangeRateFindFirst.mockResolvedValue(rate({ rate: sourceRate }));
        (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
          makeExpense({ currencyCode: 'USD', amountMinor }) as never,
        );
        (prisma.expense.update as jest.Mock).mockResolvedValue(
          validatedExpense({
            currencyCode: 'USD',
            amountMinor,
            functionalAmountMinor: expectedFunctionalAmount,
            functionalCurrencyCode: 'VES',
            exchangeRateId: 'rate-1',
            exchangeRateValue: sourceRate,
            exchangeRateDirection: 'DIRECT',
            exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
            conversionDate: new Date('2026-08-09T00:00:00.000Z'),
          }) as never,
        );

        const result = await validate();

        expect(result.functionalAmountMinor).toBe(expectedFunctionalAmount);
      },
    );
  });

  describe('legacy expenses', () => {
    it('maps an expense without snapshot fields through toDto with nulls (no speculative backfill)', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({
          status: 'VALIDATED',
          functionalAmountMinor: undefined,
          functionalCurrencyCode: undefined,
          exchangeRateId: undefined,
          exchangeRateValue: undefined,
          exchangeRateDirection: undefined,
          exchangeRateEffectiveAt: undefined,
          conversionDate: undefined,
        }) as never,
      );

      const result = await service.getExpense(
        'tenant-1',
        'expense-1',
        ['TENANT_ADMIN'],
      );

      expect(result.status).toBe('VALIDATED');
      expect(result.functionalAmountMinor).toBeNull();
      expect(result.functionalCurrencyCode).toBeNull();
      expect(result.exchangeRateId).toBeNull();
      expect(result.exchangeRateValue).toBeNull();
      expect(result.exchangeRateDirection).toBeNull();
      expect(result.exchangeRateEffectiveAt).toBeNull();
      expect(result.conversionDate).toBeNull();
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });
  });

  describe('bulk validation', () => {
    it('persists the snapshot in the same update that validates from bulk', async () => {
      exchangeRateFindFirst.mockResolvedValue(rate({ rate: '2' }));
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(
        makeExpense({ currencyCode: 'USD', amountMinor: 100 }) as never,
      );
      (prisma.expense.update as jest.Mock).mockResolvedValue(
        validatedExpense({
          currencyCode: 'USD',
          amountMinor: 100,
          functionalAmountMinor: 200,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: '2',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }) as never,
      );

      const result = await validateFromBulk();

      expect(result.status).toBe('VALIDATED');
      expect(result.functionalAmountMinor).toBe(200);
      expect(lastUpdateData()).toMatchObject({
        status: 'VALIDATED',
        validatedByMembershipId: 'member-1',
        functionalAmountMinor: 200,
        exchangeRateDirection: 'DIRECT',
      });
    });
  });
});

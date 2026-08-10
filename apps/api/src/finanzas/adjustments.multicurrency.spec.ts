import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdjustmentsService } from './adjustments.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { CurrencyConversionService } from './currency-conversion.service';
import { CreateAdjustmentDto } from './expense-ledger.dto';

const makeAdjustment = (overrides: Record<string, unknown> = {}) => ({
  id: 'adjustment-1',
  tenantId: 'tenant-1',
  buildingId: 'building-1',
  sourceInvoiceDate: new Date('2026-08-09T00:00:00.000Z'),
  sourcePeriod: '2026-08',
  targetPeriod: '2026-09',
  categoryId: 'cat-1',
  amountMinor: 1000,
  currencyCode: 'USD',
  reason: 'Ajuste retroactivo por factura omitida',
  status: 'DRAFT',
  createdByMembershipId: 'member-1',
  validatedByMembershipId: null,
  validatedAt: null,
  voidedByMembershipId: null,
  voidedAt: null,
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
  ...overrides,
});

const validatedAdjustment = (snapshot: Record<string, unknown>) =>
  makeAdjustment({ status: 'VALIDATED', ...snapshot });

const createDto: CreateAdjustmentDto = {
  buildingId: 'building-1',
  sourceInvoiceDate: '2026-08-09',
  categoryId: 'cat-1',
  amountMinor: 1000,
  currencyCode: 'USD',
  reason: 'Ajuste retroactivo por factura omitida',
  targetPeriod: '2026-09',
};

describe('AdjustmentsService multicurrency snapshot', () => {
  let service: AdjustmentsService;
  let prisma: PrismaService;
  let exchangeRateFindFirst: jest.Mock;

  const rate = (
    overrides: Partial<{
      id: string;
      rate: string;
      effectiveAt: Date;
      baseCurrency: string;
      quoteCurrency: string;
      tenantId: string;
    }> = {},
  ) => ({
    id: overrides.id ?? 'rate-1',
    rate: new Prisma.Decimal(overrides.rate ?? '36.5'),
    effectiveAt: overrides.effectiveAt ?? new Date('2026-08-08T00:00:00.000Z'),
    baseCurrency: overrides.baseCurrency ?? 'USD',
    quoteCurrency: overrides.quoteCurrency ?? 'VES',
    tenantId: overrides.tenantId ?? 'tenant-1',
  });

  const createRateResolver =
    (rates: Array<ReturnType<typeof rate>>) =>
    ({ where }: { where: Record<string, unknown> }): Promise<unknown> => {
      const limit = where.effectiveAt?.lte;
      if (limit === undefined) {
        return Promise.resolve(null);
      }
      const effectiveLimit = limit as Date;
      const candidates = rates.filter(
        (candidate) =>
          candidate.tenantId === where.tenantId &&
          candidate.effectiveAt <= effectiveLimit,
      );
      if (candidates.length === 0) {
        return Promise.resolve(null);
      }
      const latest = candidates.reduce((winner, candidate) =>
        candidate.effectiveAt > winner.effectiveAt ? candidate : winner,
      );
      return Promise.resolve(latest);
    };

  beforeEach(async () => {
    exchangeRateFindFirst = jest.fn();

    const prismaValue = {
      adjustment: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      tenant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          functionalCurrency: 'VES',
        }),
      },
      exchangeRate: { findFirst: exchangeRateFindFirst },
      expenseLedgerCategory: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'cat-1',
          tenantId: 'tenant-1',
          name: 'Maintenance',
          isActive: true,
        }),
      },
      building: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdjustmentsService,
        { provide: PrismaService, useValue: prismaValue },
        { provide: AuditService, useValue: { createLog: jest.fn() } },
        {
          provide: FinanzasValidators,
          useValue: {
            isAdminOrOperator: jest.fn().mockReturnValue(true),
            validateBuildingBelongsToTenant: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CurrencyConversionService,
          useFactory: (prismaService: PrismaService) =>
            new CurrencyConversionService(prismaService),
          inject: [PrismaService],
        },
      ],
    }).compile();

    service = module.get<AdjustmentsService>(AdjustmentsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  const validate = () =>
    service.validateAdjustment('tenant-1', 'adjustment-1', 'member-1', ['TENANT_ADMIN']);

  const create = () => service.createAdjustment('tenant-1', 'member-1', ['TENANT_ADMIN'], createDto);

  const lastUpdateData = (): Record<string, unknown> => {
    expect(prisma.adjustment.update).toHaveBeenCalledTimes(1);
    const call = (prisma.adjustment.update as jest.Mock).mock.calls[0] as [
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
  };

  describe('LIFECYCLE', () => {
    it('create persists a DRAFT adjustment without any snapshot fields', async () => {
      (prisma.adjustment.create as jest.Mock).mockResolvedValue(makeAdjustment());

      const result = await create();

      expect(result.status).toBe('DRAFT');
      expect(result.functionalAmountMinor).toBeNull();
      expect(result.functionalCurrencyCode).toBeNull();
      expect(result.exchangeRateValue).toBeNull();

      const createdData = (
        (prisma.adjustment.create as jest.Mock).mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(createdData.status).toBe('DRAFT');
      expect(createdData).not.toHaveProperty('functionalAmountMinor');
      expect(createdData).not.toHaveProperty('functionalCurrencyCode');
      expect(createdData).not.toHaveProperty('exchangeRateValue');
      expect(createdData).not.toHaveProperty('conversionDate');
      expect(exchangeRateFindFirst).not.toHaveBeenCalled();
    });

    it('DRAFT to VALIDATED persists the snapshot in the same update', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockImplementation(
        createRateResolver([rate({ rate: '36.5', effectiveAt: new Date('2026-08-08T00:00:00.000Z') })]),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(
        validatedAdjustment({
          functionalAmountMinor: 36500,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: new Prisma.Decimal('36.5'),
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }),
      );

      const result = await validate();

      const data = lastUpdateData();
      expect(data.status).toBe('VALIDATED');
      expect(data.validatedByMembershipId).toBe('member-1');
      expect(data.functionalAmountMinor).toBe(36500);
      expect(data.functionalCurrencyCode).toBe('VES');
      expect(data.exchangeRateId).toBe('rate-1');
      expect(data.exchangeRateValue?.toString()).toBe('36.5');
      expect(data.exchangeRateDirection).toBe('DIRECT');
      expect(data.conversionDate).toEqual(new Date('2026-08-09T00:00:00.000Z'));
      expect(result.functionalAmountMinor).toBe(36500);
    });

    it('rejects validating an adjustment that is not DRAFT', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(
        validatedAdjustment({}),
      );

      await expect(validate()).rejects.toThrow(BadRequestException);
      expect(prisma.adjustment.update).not.toHaveBeenCalled();
    });
  });

  describe('IDENTITY', () => {
    it('same currency produces an IDENTITY snapshot with rate 1 and zero ExchangeRate queries', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(
        makeAdjustment({ currencyCode: 'VES' }),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(
        validatedAdjustment({
          currencyCode: 'VES',
          functionalAmountMinor: 1000,
          functionalCurrencyCode: 'VES',
          exchangeRateId: null,
          exchangeRateValue: new Prisma.Decimal('1'),
          exchangeRateDirection: 'IDENTITY',
          exchangeRateEffectiveAt: null,
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }),
      );

      const result = await validate();

      const data = lastUpdateData();
      expect(data.functionalAmountMinor).toBe(1000);
      expect(data.functionalCurrencyCode).toBe('VES');
      expect(data.exchangeRateId).toBeNull();
      expect(data.exchangeRateValue?.toString()).toBe('1');
      expect(data.exchangeRateDirection).toBe('IDENTITY');
      expect(data.exchangeRateEffectiveAt).toBeNull();
      expect(data.conversionDate).toEqual(new Date('2026-08-09T00:00:00.000Z'));
      expect(result.functionalAmountMinor).toBe(1000);
      expect(exchangeRateFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('DIRECT', () => {
    it('uses a rate effective on the same day as the conversion date', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockImplementation(
        createRateResolver([rate({ rate: '36.5', effectiveAt: new Date('2026-08-09T00:00:00.000Z') })]),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const data = lastUpdateData();
      expect(data.functionalAmountMinor).toBe(36500);
      expect(data.exchangeRateDirection).toBe('DIRECT');
      expect(data.exchangeRateId).toBe('rate-1');
    });

    it('uses a previous valid rate when no same-day rate exists', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockImplementation(
        createRateResolver([rate({ rate: '35', effectiveAt: new Date('2026-08-05T00:00:00.000Z') })]),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const data = lastUpdateData();
      expect(data.functionalAmountMinor).toBe(35000);
      expect(data.exchangeRateId).toBe('rate-1');
    });

    it('picks the latest valid rate among candidates', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockImplementation(
        createRateResolver([
          rate({ id: 'rate-old', rate: '30', effectiveAt: new Date('2026-08-01T00:00:00.000Z') }),
          rate({ id: 'rate-new', rate: '36.5', effectiveAt: new Date('2026-08-08T00:00:00.000Z') }),
        ]),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const data = lastUpdateData();
      expect(data.functionalAmountMinor).toBe(36500);
      expect(data.exchangeRateId).toBe('rate-new');
    });

    it('ignores future rates and falls back to missing-rate behavior', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockImplementation(
        createRateResolver([rate({ effectiveAt: new Date('2026-08-10T00:00:00.000Z') })]),
      );

      await expect(validate()).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.adjustment.update).not.toHaveBeenCalled();
    });

    it('scopes the rate lookup to tenant, pair and conversion date', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockResolvedValue(rate({}));
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const query = exchangeRateFindFirst.mock.calls[0][0] as {
        where: Record<string, unknown>;
        orderBy: Record<string, string>;
      };
      expect(query.where.tenantId).toBe('tenant-1');
      expect(query.where.baseCurrency).toBe('USD');
      expect(query.where.quoteCurrency).toBe('VES');
      expect(query.where.effectiveAt.lte).toEqual(new Date('2026-08-09T00:00:00.000Z'));
      expect(query.orderBy.effectiveAt).toBe('desc');
    });
  });

  describe('INVERSE', () => {
    it('falls back to the inverse pair and persists the reciprocal applied rate with the inverse source id', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (where.baseCurrency === 'VES' && where.quoteCurrency === 'USD') {
          return Promise.resolve(
            rate({
              id: 'rate-inverse',
              rate: '0.04',
              effectiveAt: new Date('2026-08-08T00:00:00.000Z'),
              baseCurrency: 'VES',
              quoteCurrency: 'USD',
            }),
          );
        }
        return Promise.resolve(null);
      });
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const data = lastUpdateData();
      expect(data.functionalAmountMinor).toBe(25000);
      expect(data.exchangeRateValue?.toString()).toBe('25');
      expect(data.exchangeRateDirection).toBe('INVERSE');
      expect(data.exchangeRateId).toBe('rate-inverse');
      expect(data.exchangeRateEffectiveAt).toEqual(new Date('2026-08-08T00:00:00.000Z'));
    });
  });

  describe('PRIORITY', () => {
    it('DIRECT always wins over INVERSE when both pairs exist', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (where.baseCurrency === 'USD' && where.quoteCurrency === 'VES') {
          return Promise.resolve(
            rate({ id: 'rate-direct', rate: '36.5', effectiveAt: new Date('2026-08-08T00:00:00.000Z') }),
          );
        }
        if (where.baseCurrency === 'VES' && where.quoteCurrency === 'USD') {
          return Promise.resolve(
            rate({
              id: 'rate-inverse',
              rate: '0.04',
              effectiveAt: new Date('2026-08-08T00:00:00.000Z'),
              baseCurrency: 'VES',
              quoteCurrency: 'USD',
            }),
          );
        }
        return Promise.resolve(null);
      });
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const data = lastUpdateData();
      expect(data.exchangeRateDirection).toBe('DIRECT');
      expect(data.exchangeRateId).toBe('rate-direct');
      expect(data.functionalAmountMinor).toBe(36500);
      expect(exchangeRateFindFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('MISSING', () => {
    it('returns 422 EXCHANGE_RATE_NOT_FOUND and never partially persists', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockResolvedValue(null);

      try {
        await validate();
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(UnprocessableEntityException);
        expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
          code: 'EXCHANGE_RATE_NOT_FOUND',
        });
      }

      expect(prisma.adjustment.update).not.toHaveBeenCalled();
    });
  });

  describe('INVALID', () => {
    it('rejects a zero rate with INVALID_EXCHANGE_RATE without touching the adjustment', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockResolvedValue(rate({ rate: '0' }));

      try {
        await validate();
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(UnprocessableEntityException);
        expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
          code: 'INVALID_EXCHANGE_RATE',
        });
      }

      expect(prisma.adjustment.update).not.toHaveBeenCalled();
    });
  });

  describe('TENANT ISOLATION', () => {
    it('a rate owned by another tenant never satisfies the conversion', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockImplementation(
        createRateResolver([
          rate({
            id: 'rate-foreign',
            rate: '36.5',
            effectiveAt: new Date('2026-08-08T00:00:00.000Z'),
            tenantId: 'tenant-2',
          }),
        ]),
      );

      try {
        await validate();
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(UnprocessableEntityException);
      }

      expect(prisma.adjustment.update).not.toHaveBeenCalled();
      expectTenantScopedLookups('tenant-1');
    });
  });

  describe('FUNCTIONAL CURRENCY', () => {
    it('uses Tenant.functionalCurrency and never Tenant.currency', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(
        makeAdjustment({ currencyCode: 'USD' }),
      );
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({
        id: 'tenant-1',
        functionalCurrency: 'ARS',
        currency: 'USD',
      });
      exchangeRateFindFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (where.baseCurrency === 'USD' && where.quoteCurrency === 'ARS') {
          return Promise.resolve(
            rate({
              id: 'rate-usd-ars',
              rate: '1400',
              effectiveAt: new Date('2026-08-08T00:00:00.000Z'),
              baseCurrency: 'USD',
              quoteCurrency: 'ARS',
            }),
          );
        }
        return Promise.resolve(null);
      });
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(
        validatedAdjustment({
          functionalAmountMinor: 1400000,
          functionalCurrencyCode: 'ARS',
          exchangeRateId: 'rate-usd-ars',
          exchangeRateValue: new Prisma.Decimal('1400'),
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }),
      );

      const result = await validate();

      const data = lastUpdateData();
      expect(data.functionalCurrencyCode).toBe('ARS');
      expect(data.functionalAmountMinor).toBe(1400000);
      expect(data.exchangeRateDirection).toBe('DIRECT');
      expect(result.functionalCurrencyCode).toBe('ARS');

      const tenantQuery = (prisma.tenant.findFirst as jest.Mock).mock.calls[0][0] as {
        select: Record<string, boolean>;
      };
      expect(tenantQuery.select.functionalCurrency).toBe(true);
    });
  });

  describe('DATE', () => {
    it('uses sourceInvoiceDate normalized as UTC date-only at the timezone boundary', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(
        makeAdjustment({
          sourceInvoiceDate: new Date('2026-08-09T23:30:00.000Z'),
        }),
      );
      exchangeRateFindFirst.mockResolvedValue(rate({}));
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const query = exchangeRateFindFirst.mock.calls[0][0] as {
        where: { effectiveAt: { lte: Date } };
      };
      expect(query.where.effectiveAt.lte.toISOString()).toBe('2026-08-09T00:00:00.000Z');

      const data = lastUpdateData();
      expect(data.conversionDate).toEqual(new Date('2026-08-09T00:00:00.000Z'));
    });
  });

  describe('IMMUTABILITY', () => {
    it('freezes the applied rate value so later source-rate edits cannot change the snapshot', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockResolvedValue(
        rate({ id: 'rate-1', rate: '36.5', effectiveAt: new Date('2026-08-08T00:00:00.000Z') }),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const data = lastUpdateData();
      expect(data.exchangeRateValue?.toString()).toBe('36.5');
      expect(data.functionalAmountMinor).toBe(36500);

      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(
        validatedAdjustment({
          functionalAmountMinor: 36500,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: new Prisma.Decimal('36.5'),
          exchangeRateDirection: 'DIRECT',
        }),
      );
      exchangeRateFindFirst.mockResolvedValue(
        rate({ id: 'rate-1', rate: '99', effectiveAt: new Date('2026-08-10T00:00:00.000Z') }),
      );

      await expect(validate()).rejects.toThrow(BadRequestException);
      expect(prisma.adjustment.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('LEGACY', () => {
    it('a historical adjustment with NULL snapshot is readable without conversion', async () => {
      (prisma.adjustment.findMany as jest.Mock).mockResolvedValue([
        validatedAdjustment({
          functionalAmountMinor: null,
          functionalCurrencyCode: null,
          exchangeRateId: null,
          exchangeRateValue: null,
          exchangeRateDirection: null,
          exchangeRateEffectiveAt: null,
          conversionDate: null,
        }),
      ]);

      const results = await service.listAdjustments('tenant-1', ['TENANT_ADMIN']);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('VALIDATED');
      expect(results[0].functionalAmountMinor).toBeNull();
      expect(results[0].functionalCurrencyCode).toBeNull();
      expect(results[0].exchangeRateValue).toBeNull();
      expect(results[0].conversionDate).toBeNull();
      expect(exchangeRateFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('PRECISION', () => {
    it('applies ROUND_HALF_EVEN rounding down on a .5 tie', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockResolvedValue(
        rate({ rate: '0.0545', effectiveAt: new Date('2026-08-08T00:00:00.000Z') }),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const data = lastUpdateData();
      expect(data.functionalAmountMinor).toBe(54);
    });

    it('applies ROUND_HALF_EVEN rounding up on a .5 tie to the next even number', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockResolvedValue(
        rate({ rate: '0.0555', effectiveAt: new Date('2026-08-08T00:00:00.000Z') }),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const data = lastUpdateData();
      expect(data.functionalAmountMinor).toBe(56);
    });
  });

  describe('UNSUPPORTED CURRENCY', () => {
    it('a non-canonical currency fails controlled at runtime without persisting anything', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(
        makeAdjustment({ currencyCode: 'XYZ' }),
      );

      try {
        await validate();
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
      }

      expect(exchangeRateFindFirst).not.toHaveBeenCalled();
      expect(prisma.adjustment.update).not.toHaveBeenCalled();
    });
  });

  describe('LIQUIDATION REGRESSION', () => {
    it('create keeps DRAFT (never consumed by liquidations) and validate produces VALIDATED (the consumed state)', async () => {
      (prisma.adjustment.create as jest.Mock).mockResolvedValue(makeAdjustment());
      const draft = await create();
      expect(draft.status).toBe('DRAFT');

      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockResolvedValue(
        rate({ rate: '36.5', effectiveAt: new Date('2026-08-08T00:00:00.000Z') }),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(
        validatedAdjustment({
          functionalAmountMinor: 36500,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: new Prisma.Decimal('36.5'),
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
          conversionDate: new Date('2026-08-09T00:00:00.000Z'),
        }),
      );

      const validated = await validate();
      expect(validated.status).toBe('VALIDATED');
      expect(validated.functionalAmountMinor).toBe(36500);
    });

    it('does not bypass the mixed-currency guard: snapshot fields never alter liquidation inputs', async () => {
      (prisma.adjustment.findFirst as jest.Mock).mockResolvedValue(makeAdjustment());
      exchangeRateFindFirst.mockResolvedValue(
        rate({ rate: '36.5', effectiveAt: new Date('2026-08-08T00:00:00.000Z') }),
      );
      (prisma.adjustment.update as jest.Mock).mockResolvedValue(validatedAdjustment({}));

      await validate();

      const data = lastUpdateData();
      expect(data.status).toBe('VALIDATED');
      expect(data).not.toHaveProperty('liquidationId');
      expect(data).not.toHaveProperty('totalsByCurrency');

      expectTenantScopedLookups('tenant-1');
    });
  });
});

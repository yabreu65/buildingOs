import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  isCanonicalCurrency,
  type CanonicalCurrency,
} from "@buildingos/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { acquireExchangeRateLock, type ExchangeRateLockClient } from './exchange-rate-locks';

const INT_MIN = new Prisma.Decimal("-2147483648");
const INT_MAX = new Prisma.Decimal("2147483647");

export type CurrencyConversionDirection = "IDENTITY" | "DIRECT" | "INVERSE";

export interface MulticurrencyConversionInput {
  readonly tenantId: string;
  readonly originalAmountMinor: number;
  readonly originalCurrency: CanonicalCurrency;
  readonly functionalCurrency: CanonicalCurrency;
  /** Strict UTC date-only YYYY-MM-DD accounting date for exchange-rate lookup. */
  readonly operationDate: string;
}

export interface MulticurrencyConversionResult {
  readonly originalAmountMinor: number;
  readonly originalCurrency: CanonicalCurrency;
  readonly functionalAmountMinor: number;
  readonly functionalCurrency: CanonicalCurrency;
  readonly exchangeRateId: string | null;
  readonly exchangeRateValue: string;
  readonly exchangeRateDirection: CurrencyConversionDirection;
  readonly exchangeRateEffectiveAt: Date | null;
  readonly conversionDate: Date;
}

export interface CurrencyConversionInput {
  readonly tenantId: string;
  readonly amount: number;
  readonly originalCurrency: CanonicalCurrency;
  readonly functionalCurrency: CanonicalCurrency;
  readonly conversionDate: string;
}

export interface CurrencyConversionResult {
  readonly originalAmount: number;
  readonly originalCurrency: CanonicalCurrency;
  readonly functionalAmount: number;
  readonly functionalCurrency: CanonicalCurrency;
  readonly sourceExchangeRateId: string | null;
  readonly appliedRate: string;
  readonly direction: CurrencyConversionDirection;
  readonly sourceEffectiveAt: Date | null;
  readonly conversionDate: Date;
}

interface RateSnapshot {
  readonly id: string;
  readonly rate: Prisma.Decimal;
  readonly effectiveAt: Date;
}

export interface CurrencyConversionDb {
  readonly $executeRaw?: ExchangeRateLockClient['$executeRaw'];
  readonly exchangeRate: {
    findFirst: (args: {
      where: {
        tenantId: string;
        baseCurrency: CanonicalCurrency;
        quoteCurrency: CanonicalCurrency;
        effectiveAt: { lte: Date };
      };
      orderBy: [{ effectiveAt: "desc" }, { id: "asc" }];
      select: { id: true; rate: true; effectiveAt: true };
    }) => Promise<{
      id: string;
      rate: Prisma.Decimal;
      effectiveAt: Date;
    } | null>;
  };
}

@Injectable()
export class CurrencyConversionService {
  constructor(private readonly prisma: PrismaService) {}

  async convertToFunctionalCurrency(
    input: MulticurrencyConversionInput,
    db: CurrencyConversionDb = this.prisma,
  ): Promise<MulticurrencyConversionResult> {
    this.assertCanonicalInput(input);
    const conversionDate = this.normalizeDate(input.operationDate, "operationDate");

    if (input.originalCurrency === input.functionalCurrency) {
      return this.canonicalResult(
        input,
        input.originalAmountMinor,
        new Prisma.Decimal(1),
        "IDENTITY",
        null,
        conversionDate,
      );
    }

    const direct = await this.findLockedRate(
      db,
      input.tenantId,
      input.originalCurrency,
      input.functionalCurrency,
      conversionDate,
    );
    if (direct) {
      this.assertPositiveRate(
        direct,
        input.originalCurrency,
        input.functionalCurrency,
      );
      return this.convertWithRate(
        input,
        direct,
        direct.rate,
        "DIRECT",
        conversionDate,
      );
    }

    const inverse = await this.findLockedRate(
      db,
      input.tenantId,
      input.functionalCurrency,
      input.originalCurrency,
      conversionDate,
    );
    if (inverse) {
      this.assertPositiveRate(
        inverse,
        input.functionalCurrency,
        input.originalCurrency,
      );
      return this.convertWithRate(
        input,
        inverse,
        new Prisma.Decimal(1).div(inverse.rate),
        "INVERSE",
        conversionDate,
      );
    }

    throw new UnprocessableEntityException({
      code: "EXCHANGE_RATE_NOT_FOUND",
      originalCurrency: input.originalCurrency,
      functionalCurrency: input.functionalCurrency,
      conversionDate: input.operationDate,
    });
  }

  async convert(
    input: CurrencyConversionInput,
    db: CurrencyConversionDb = this.prisma,
  ): Promise<CurrencyConversionResult> {
    const result = await this.convertToFunctionalCurrency({
      tenantId: input.tenantId,
      originalAmountMinor: input.amount,
      originalCurrency: input.originalCurrency,
      functionalCurrency: input.functionalCurrency,
      operationDate: input.conversionDate,
    }, db);

    return {
      originalAmount: result.originalAmountMinor,
      originalCurrency: result.originalCurrency,
      functionalAmount: result.functionalAmountMinor,
      functionalCurrency: result.functionalCurrency,
      sourceExchangeRateId: result.exchangeRateId,
      appliedRate: result.exchangeRateValue,
      direction: result.exchangeRateDirection,
      sourceEffectiveAt: result.exchangeRateEffectiveAt,
      conversionDate: result.conversionDate,
    };
  }

  private async findLockedRate(
    db: CurrencyConversionDb,
    tenantId: string,
    baseCurrency: CanonicalCurrency,
    quoteCurrency: CanonicalCurrency,
    conversionDate: Date,
  ): Promise<RateSnapshot | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const selected = await this.findRate(db, tenantId, baseCurrency, quoteCurrency, conversionDate);
      if (!selected) return null;

      if (!db.$executeRaw) return selected;
      await acquireExchangeRateLock(db as ExchangeRateLockClient, tenantId, selected.id);

      const revalidated = await this.findRate(db, tenantId, baseCurrency, quoteCurrency, conversionDate);
      if (!revalidated) return null;
      if (revalidated.id === selected.id) return revalidated;
    }

    throw new UnprocessableEntityException({
      code: 'EXCHANGE_RATE_SELECTION_UNSTABLE',
      baseCurrency,
      quoteCurrency,
      conversionDate: conversionDate.toISOString(),
    });
  }

  private async findRate(
    db: CurrencyConversionDb,
    tenantId: string,
    baseCurrency: CanonicalCurrency,
    quoteCurrency: CanonicalCurrency,
    conversionDate: Date,
  ): Promise<RateSnapshot | null> {
    return db.exchangeRate.findFirst({
      where: {
        tenantId,
        baseCurrency,
        quoteCurrency,
        effectiveAt: { lte: conversionDate },
      },
      orderBy: [{ effectiveAt: "desc" }, { id: "asc" }],
      select: { id: true, rate: true, effectiveAt: true },
    });
  }

  private assertPositiveRate(
    source: RateSnapshot,
    baseCurrency: CanonicalCurrency,
    quoteCurrency: CanonicalCurrency,
  ): void {
    if (!source.rate.greaterThan(0)) {
      throw new UnprocessableEntityException({
        code: "INVALID_EXCHANGE_RATE",
        baseCurrency,
        quoteCurrency,
        effectiveAt: source.effectiveAt.toISOString(),
      });
    }
  }

  private convertWithRate(
    input: MulticurrencyConversionInput,
    source: RateSnapshot,
    appliedRate: Prisma.Decimal,
    direction: Exclude<CurrencyConversionDirection, "IDENTITY">,
    conversionDate: Date,
  ): MulticurrencyConversionResult {
    const converted = new Prisma.Decimal(input.originalAmountMinor)
      .mul(appliedRate)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_EVEN);
    this.assertStorageRange(converted);
    return this.canonicalResult(
      input,
      converted.toNumber(),
      appliedRate,
      direction,
      source,
      conversionDate,
    );
  }

  private canonicalResult(
    input: MulticurrencyConversionInput,
    functionalAmountMinor: number,
    appliedRate: Prisma.Decimal,
    direction: CurrencyConversionDirection,
    source: RateSnapshot | null,
    conversionDate: Date,
  ): MulticurrencyConversionResult {
    return {
      originalAmountMinor: input.originalAmountMinor,
      originalCurrency: input.originalCurrency,
      functionalAmountMinor,
      functionalCurrency: input.functionalCurrency,
      exchangeRateId: source?.id ?? null,
      exchangeRateValue: appliedRate.toFixed(),
      exchangeRateDirection: direction,
      exchangeRateEffectiveAt: source?.effectiveAt ?? null,
      conversionDate,
    };
  }

  private assertCanonicalInput(input: MulticurrencyConversionInput): void {
    if (
      !isCanonicalCurrency(input.originalCurrency) ||
      !isCanonicalCurrency(input.functionalCurrency)
    ) {
      throw new BadRequestException(
        "Currency must be one of USD, VES, ARS, or COP",
      );
    }
    if (
      !Number.isInteger(input.originalAmountMinor) ||
      !Number.isSafeInteger(input.originalAmountMinor)
    ) {
      throw new BadRequestException("Amount must be an integer in minor units");
    }
    this.assertStorageRange(new Prisma.Decimal(input.originalAmountMinor));
    this.normalizeDate(input.operationDate, "operationDate");
  }

  private assertStorageRange(amount: Prisma.Decimal): void {
    if (
      !amount.isInteger() ||
      amount.lessThan(INT_MIN) ||
      amount.greaterThan(INT_MAX)
    ) {
      throw new UnprocessableEntityException({
        code: "CONVERTED_AMOUNT_OUT_OF_RANGE",
      });
    }
  }

  private normalizeDate(value: string, fieldName = "conversionDate"): Date {
    if (
      typeof value !== "string" ||
      value.trim() !== value ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      throw new BadRequestException(
        `${fieldName} must be a valid YYYY-MM-DD date`,
      );
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(
        `${fieldName} must be a valid YYYY-MM-DD date`,
      );
    }
    return date;
  }
}

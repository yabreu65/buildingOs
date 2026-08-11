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

const INT_MIN = new Prisma.Decimal("-2147483648");
const INT_MAX = new Prisma.Decimal("2147483647");

export type CurrencyConversionDirection = "IDENTITY" | "DIRECT" | "INVERSE";

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
  readonly exchangeRate: {
    findFirst: (args: {
      where: {
        tenantId: string;
        baseCurrency: CanonicalCurrency;
        quoteCurrency: CanonicalCurrency;
        effectiveAt: { lte: Date };
      };
      orderBy: { effectiveAt: 'desc' };
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

  async convert(
    input: CurrencyConversionInput,
    db: CurrencyConversionDb = this.prisma,
  ): Promise<CurrencyConversionResult> {
    this.assertInput(input);
    const conversionDate = this.normalizeDate(input.conversionDate);

    if (input.originalCurrency === input.functionalCurrency) {
      return this.result(
        input,
        input.amount,
        new Prisma.Decimal(1),
        "IDENTITY",
        null,
        conversionDate,
      );
    }

    const direct = await this.findRate(
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

    const inverse = await this.findRate(
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
      conversionDate: input.conversionDate,
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
      orderBy: { effectiveAt: "desc" },
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
    input: CurrencyConversionInput,
    source: RateSnapshot,
    appliedRate: Prisma.Decimal,
    direction: Exclude<CurrencyConversionDirection, "IDENTITY">,
    conversionDate: Date,
  ): CurrencyConversionResult {
    const converted = new Prisma.Decimal(input.amount)
      .mul(appliedRate)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_EVEN);
    this.assertStorageRange(converted);
    return this.result(
      input,
      converted.toNumber(),
      appliedRate,
      direction,
      source,
      conversionDate,
    );
  }

  private result(
    input: CurrencyConversionInput,
    functionalAmount: number,
    appliedRate: Prisma.Decimal,
    direction: CurrencyConversionDirection,
    source: RateSnapshot | null,
    conversionDate: Date,
  ): CurrencyConversionResult {
    return {
      originalAmount: input.amount,
      originalCurrency: input.originalCurrency,
      functionalAmount,
      functionalCurrency: input.functionalCurrency,
      sourceExchangeRateId: source?.id ?? null,
      appliedRate: appliedRate.toFixed(),
      direction,
      sourceEffectiveAt: source?.effectiveAt ?? null,
      conversionDate,
    };
  }

  private assertInput(input: CurrencyConversionInput): void {
    if (
      !isCanonicalCurrency(input.originalCurrency) ||
      !isCanonicalCurrency(input.functionalCurrency)
    ) {
      throw new BadRequestException(
        "Currency must be one of USD, VES, ARS, or COP",
      );
    }
    if (
      !Number.isInteger(input.amount) ||
      !Number.isSafeInteger(input.amount)
    ) {
      throw new BadRequestException("Amount must be an integer in minor units");
    }
    this.assertStorageRange(new Prisma.Decimal(input.amount));
    this.normalizeDate(input.conversionDate);
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

  private normalizeDate(value: string): Date {
    if (
      typeof value !== "string" ||
      value.trim() !== value ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      throw new BadRequestException(
        "conversionDate must be a valid YYYY-MM-DD date",
      );
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(
        "conversionDate must be a valid YYYY-MM-DD date",
      );
    }
    return date;
  }
}

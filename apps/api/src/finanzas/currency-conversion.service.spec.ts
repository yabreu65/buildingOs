import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CanonicalCurrency } from "@buildingos/contracts";
import type { PrismaService } from "../prisma/prisma.service";
import { CurrencyConversionService } from "./currency-conversion.service";

describe("CurrencyConversionService", () => {
  const exchangeRate = { findFirst: jest.fn() };
  const prisma = { exchangeRate } as unknown as PrismaService;
  const service = new CurrencyConversionService(prisma);
  const conversionDate = "2026-08-09";

  const rate = (
    overrides: Partial<{
      id: string;
      baseCurrency: string;
      quoteCurrency: string;
      rate: string;
      effectiveAt: Date;
    }> = {},
  ) => ({
    id: overrides.id ?? "rate-1",
    rate: new Prisma.Decimal(overrides.rate ?? "36.500000000001"),
    effectiveAt: overrides.effectiveAt ?? new Date("2026-08-08T00:00:00.000Z"),
  });

  beforeEach(() => jest.clearAllMocks());

  it.each(["USD", "VES", "ARS", "COP"] as const)(
    "returns IDENTITY for %s without querying rates",
    async (currency) => {
      await expect(
        service.convert({
          tenantId: "tenant-1",
          amount: 125,
          originalCurrency: currency,
          functionalCurrency: currency,
          conversionDate,
        }),
      ).resolves.toEqual({
        originalAmount: 125,
        originalCurrency: currency,
        functionalAmount: 125,
        functionalCurrency: currency,
        sourceExchangeRateId: null,
        appliedRate: "1",
        direction: "IDENTITY",
        sourceEffectiveAt: null,
        conversionDate: new Date("2026-08-09T00:00:00.000Z"),
      });
      expect(exchangeRate.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["same day", "2026-08-09T00:00:00.000Z"],
    ["prior day", "2026-08-08T00:00:00.000Z"],
  ])(
    "uses a DIRECT %s rate and returns snapshot metadata",
    async (_label, effectiveAt) => {
      exchangeRate.findFirst.mockResolvedValue(
        rate({ effectiveAt: new Date(effectiveAt) }),
      );

      await expect(
        service.convert(input({ amount: 100 })),
      ).resolves.toMatchObject({
        functionalAmount: 3650,
        sourceExchangeRateId: "rate-1",
        appliedRate: "36.500000000001",
        direction: "DIRECT",
        sourceEffectiveAt: new Date(effectiveAt),
        conversionDate: new Date("2026-08-09T00:00:00.000Z"),
      });
      expect(exchangeRate.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: "tenant-1",
          baseCurrency: "USD",
          quoteCurrency: "VES",
          effectiveAt: { lte: new Date("2026-08-09T00:00:00.000Z") },
        },
        orderBy: { effectiveAt: "desc" },
        select: { id: true, rate: true, effectiveAt: true },
      });
    },
  );

  it("requests the latest eligible rate and excludes future rates in the database filter", async () => {
    exchangeRate.findFirst.mockResolvedValue(rate());
    await service.convert(input());
    expect(exchangeRate.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        tenantId: "tenant-1",
        effectiveAt: { lte: new Date("2026-08-09T00:00:00.000Z") },
      },
      orderBy: { effectiveAt: "desc" },
    });
  });

  it("uses the exact Decimal reciprocal only when no direct rate exists", async () => {
    exchangeRate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        rate({ rate: "4", baseCurrency: "VES", quoteCurrency: "USD" }),
      );

    await expect(
      service.convert(input({ amount: 100 })),
    ).resolves.toMatchObject({
      functionalAmount: 25,
      sourceExchangeRateId: "rate-1",
      appliedRate: "0.25",
      direction: "INVERSE",
    });
    expect(exchangeRate.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        tenantId: "tenant-1",
        baseCurrency: "VES",
        quoteCurrency: "USD",
        effectiveAt: { lte: new Date("2026-08-09T00:00:00.000Z") },
      },
      orderBy: { effectiveAt: "desc" },
      select: { id: true, rate: true, effectiveAt: true },
    });
  });

  it("does not query inverse when a direct rate exists", async () => {
    exchangeRate.findFirst.mockResolvedValue(rate({ rate: "2" }));
    await expect(
      service.convert(input({ amount: 100 })),
    ).resolves.toMatchObject({ functionalAmount: 200, direction: "DIRECT" });
    expect(exchangeRate.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each(["0", "0.0", "0.000000000000"])(
    "rejects an INVERSE zero source rate %s before dividing",
    async (zeroRate) => {
      exchangeRate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(rate({ rate: zeroRate }));
      const error = await service
        .convert(input())
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        code: "INVALID_EXCHANGE_RATE",
        baseCurrency: "VES",
        quoteCurrency: "USD",
        effectiveAt: "2026-08-08T00:00:00.000Z",
      });
      expect(exchangeRate.findFirst).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["-1", "-36.5"])(
    "rejects a negative INVERSE source rate %s before dividing",
    async (negativeRate) => {
      exchangeRate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(rate({ rate: negativeRate }));
      const error = await service
        .convert(input())
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        code: "INVALID_EXCHANGE_RATE",
        baseCurrency: "VES",
        quoteCurrency: "USD",
        effectiveAt: "2026-08-08T00:00:00.000Z",
      });
    },
  );

  it.each(["0", "0.0", "0.000000000000"])(
    "rejects a DIRECT zero source rate %s before multiplying",
    async (zeroRate) => {
      exchangeRate.findFirst.mockResolvedValue(rate({ rate: zeroRate }));
      const error = await service
        .convert(input())
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        code: "INVALID_EXCHANGE_RATE",
        baseCurrency: "USD",
        quoteCurrency: "VES",
        effectiveAt: "2026-08-08T00:00:00.000Z",
      });
      expect(exchangeRate.findFirst).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["-1", "-36.5"])(
    "rejects a negative DIRECT source rate %s before multiplying",
    async (negativeRate) => {
      exchangeRate.findFirst.mockResolvedValue(rate({ rate: negativeRate }));
      const error = await service
        .convert(input())
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        code: "INVALID_EXCHANGE_RATE",
        baseCurrency: "USD",
        quoteCurrency: "VES",
        effectiveAt: "2026-08-08T00:00:00.000Z",
      });
      expect(exchangeRate.findFirst).toHaveBeenCalledTimes(1);
    },
  );

  it("returns a stable sanitized missing-rate error", async () => {
    exchangeRate.findFirst.mockResolvedValue(null);
    const error = await service
      .convert(input())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toEqual({
      code: "EXCHANGE_RATE_NOT_FOUND",
      originalCurrency: "USD",
      functionalCurrency: "VES",
      conversionDate,
    });
  });

  it("never uses another tenant rate because both lookups include tenantId", async () => {
    exchangeRate.findFirst.mockResolvedValue(null);
    await expect(
      service.convert(input({ tenantId: "tenant-b" })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(exchangeRate.findFirst.mock.calls).toHaveLength(2);
    expect(
      exchangeRate.findFirst.mock.calls.every(
        ([query]) => query.where.tenantId === "tenant-b",
      ),
    ).toBe(true);
  });

  it("uses the supplied date only and supports the day before an effective rate as missing", async () => {
    exchangeRate.findFirst.mockResolvedValue(null);
    await expect(
      service.convert(input({ conversionDate: "2026-08-07" })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(exchangeRate.findFirst.mock.calls[0][0].where.effectiveAt).toEqual({
      lte: new Date("2026-08-07T00:00:00.000Z"),
    });
  });

  it.each(["USD", "VES", "ARS", "COP"] as const)(
    "accepts canonical original currency %s",
    async (currency) => {
      await expect(
        service.convert(
          input({ originalCurrency: currency, functionalCurrency: currency }),
        ),
      ).resolves.toMatchObject({ direction: "IDENTITY" });
    },
  );

  it.each([{ originalCurrency: "EUR" }, { functionalCurrency: "EUR" }])(
    "rejects invalid currencies before querying",
    async (override) => {
      await expect(service.convert(input(override))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(exchangeRate.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each(["2026-8-09", "2026-02-30", " 2026-08-09", "2026-08-09T00:00:00Z"])(
    "rejects non-strict conversion date %s",
    async (date) => {
      await expect(
        service.convert(input({ conversionDate: date })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(exchangeRate.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["12-decimal rate", "1.123456789012", 100, 112],
    ["small rate", "0.000000000001", 2_000_000_000, 0],
    ["large admitted result", "1", 2_147_483_647, 2_147_483_647],
  ])(
    "converts %s with fixed-point applied rate",
    async (_label, sourceRate, amount, expected) => {
      exchangeRate.findFirst.mockResolvedValue(rate({ rate: sourceRate }));
      const result = await service.convert(input({ amount }));
      expect(result.functionalAmount).toBe(expected);
      expect(result.appliedRate).toBe(new Prisma.Decimal(sourceRate).toFixed());
      expect(result.appliedRate).not.toMatch(/[eE]/);
    },
  );

  it.each([
    ["even-down", 1, "2.5", 2],
    ["odd-up", 1, "3.5", 4],
  ])(
    "uses ROUND_HALF_EVEN for a positive %s tie",
    async (_label, amount, sourceRate, expected) => {
      exchangeRate.findFirst.mockResolvedValue(rate({ rate: sourceRate }));
      await expect(service.convert(input({ amount }))).resolves.toMatchObject({
        functionalAmount: expected,
      });
    },
  );

  it.each([
    [2_147_483_647, "1", 2_147_483_647],
    [-2_147_483_648, "1", -2_147_483_648],
  ])(
    "accepts current Int storage boundary %s",
    async (amount, sourceRate, expected) => {
      exchangeRate.findFirst.mockResolvedValue(rate({ rate: sourceRate }));
      await expect(service.convert(input({ amount }))).resolves.toMatchObject({
        functionalAmount: expected,
      });
    },
  );

  it.each([
    [2_147_483_647, "1.000000001"],
    [-2_147_483_648, "1.000000001"],
  ])(
    "rejects converted current Int overflow for %s",
    async (amount, sourceRate) => {
      exchangeRate.findFirst.mockResolvedValue(rate({ rate: sourceRate }));
      await expect(service.convert(input({ amount }))).rejects.toMatchObject({
        response: { code: "CONVERTED_AMOUNT_OUT_OF_RANGE" },
      });
    },
  );

  function input(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: "tenant-1",
      amount: 100,
      originalCurrency: "USD",
      functionalCurrency: "VES",
      conversionDate,
      ...overrides,
    } as Parameters<CurrencyConversionService["convert"]>[0];
  }

describe("CurrencyConversionService transaction propagation", () => {
  const rootExchangeRate = { findFirst: jest.fn() };
  const rootPrisma = { exchangeRate: rootExchangeRate } as unknown as PrismaService;
  const rootService = new CurrencyConversionService(rootPrisma);

  const txExchangeRate = { findFirst: jest.fn() };
  const tx = { exchangeRate: txExchangeRate } as unknown as Parameters<
    CurrencyConversionService["convert"]
  >[1];

  beforeEach(() => {
    jest.clearAllMocks();
    rootExchangeRate.findFirst.mockResolvedValue(null);
    txExchangeRate.findFirst.mockResolvedValue(null);
  });

  const input = {
    tenantId: "tenant-1",
    amount: 1000,
    originalCurrency: "USD" as CanonicalCurrency,
    functionalCurrency: "VES" as CanonicalCurrency,
    conversionDate: "2026-08-09",
  };

  it("uses the root PrismaService when no client is provided", async () => {
    rootExchangeRate.findFirst.mockResolvedValue(
      new Prisma.Decimal("36.5").toNumber() ? {
        id: "rate-1",
        rate: new Prisma.Decimal("36.5"),
        effectiveAt: new Date("2026-08-08T00:00:00.000Z"),
      } : null,
    );

    await rootService.convert(input);

    expect(rootExchangeRate.findFirst).toHaveBeenCalledTimes(1);
    expect(txExchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it("uses the provided tx client and NEVER the root client", async () => {
    txExchangeRate.findFirst.mockResolvedValue({
      id: "rate-1",
      rate: new Prisma.Decimal("36.5"),
      effectiveAt: new Date("2026-08-08T00:00:00.000Z"),
    });

    const result = await rootService.convert(input, tx);

    expect(txExchangeRate.findFirst).toHaveBeenCalledTimes(1);
    expect(rootExchangeRate.findFirst).not.toHaveBeenCalled();
    expect(result.direction).toBe("DIRECT");
    expect(result.functionalAmount).toBe(36500);
  });

  it("DIRECT with tx resolves through the tx client", async () => {
    txExchangeRate.findFirst.mockResolvedValue({
      id: "rate-direct",
      rate: new Prisma.Decimal("36.5"),
      effectiveAt: new Date("2026-08-08T00:00:00.000Z"),
    });

    const result = await rootService.convert(input, tx);

    expect(result.direction).toBe("DIRECT");
    expect(txExchangeRate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-1" }) }),
    );
  });

  it("INVERSE with tx resolves through the tx client", async () => {
    txExchangeRate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "rate-inv",
        rate: new Prisma.Decimal("0.04"),
        effectiveAt: new Date("2026-08-08T00:00:00.000Z"),
      });

    const result = await rootService.convert(
      { ...input, originalCurrency: "ARS", functionalCurrency: "VES" },
      tx,
    );

    expect(result.direction).toBe("INVERSE");
    expect(txExchangeRate.findFirst).toHaveBeenCalledTimes(2);
    expect(rootExchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it("IDENTITY with tx performs zero queries on root AND tx", async () => {
    const result = await rootService.convert(
      { ...input, originalCurrency: "VES", functionalCurrency: "VES" },
      tx,
    );

    expect(result.direction).toBe("IDENTITY");
    expect(txExchangeRate.findFirst).not.toHaveBeenCalled();
    expect(rootExchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it("missing rate with tx rejects with EXCHANGE_RATE_NOT_FOUND", async () => {
    txExchangeRate.findFirst.mockResolvedValue(null);

    await expect(rootService.convert(input, tx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "EXCHANGE_RATE_NOT_FOUND" }),
    });
    expect(rootExchangeRate.findFirst).not.toHaveBeenCalled();
  });
});
});
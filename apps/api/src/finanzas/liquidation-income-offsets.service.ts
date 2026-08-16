import { Injectable } from '@nestjs/common';
import { IncomeApplicationDestination, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  deriveApplicationFunctionalValues,
  distributeMinorByWeights,
  resolveIncomeOffsetBuildingShare,
  valueIncomeOffsetForLiquidation,
  type BuildingAllocationWeight,
} from './income-offset-allocation';
import { acquireIncomeLock } from './fund-locks';

/**
 * FIN-06: selección y valuación de IncomeApplications OFFSET_EXPENSES
 * para una Liquidation (draft-time snapshot + referencias relacionales).
 *
 * El draft congela las fuentes: nunca se recalculan contra estado live al
 * publicar. La referencia relacional LiquidationIncomeOffset protege el void.
 *
 * Movimiento ↔ aplicación:
 * - MovementAllocation decide A QUÉ building pertenece el movimiento.
 * - IncomeApplication decide QUÉ se hace con el dinero (OFFSET/FUND/CARRY).
 */

export interface IncomeOffsetSnapshotItem extends Prisma.InputJsonObject {
  incomeId: string;
  incomeApplicationId: string;
  categoryId: string;
  categoryName: string | null;
  policyVersionId: string | null;
  scopeType: string;
  currencyCode: string;
  applicationAmountMinor: number;
  buildingAmountMinor: number;
  valuedAmountMinor: number;
  functionalCurrencyCode: string | null;
  exchangeRateId: string | null;
  exchangeRateValue: string | null;
  exchangeRateDirection: string | null;
  exchangeRateEffectiveAt: string | null;
  conversionDate: string | null;
  receivedDate: string;
  period: string;
}

export interface LiquidationIncomeOffsetsResult {
  readonly items: IncomeOffsetSnapshotItem[];
  readonly references: Array<{
    incomeApplicationId: string;
    buildingId: string;
    originalAmountMinor: number;
    currencyCode: string;
    valuedAmountMinor: number;
    baseCurrency: string;
  }>;
  readonly incomeOffsetAmountMinor: number;
  readonly incomeOffsetsByCurrency: Record<string, number>;
}

interface IncomeWithApplications {
  id: string;
  buildingId: string | null;
  period: string;
  scopeType: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
  status: 'DRAFT' | 'RECORDED' | 'VOID';
  functionalAmountMinor: number | null;
  functionalCurrencyCode: string | null;
  exchangeRateId: string | null;
  exchangeRateValue: Prisma.Decimal | string | null;
  exchangeRateDirection: string | null;
  exchangeRateEffectiveAt: Date | null;
  conversionDate: Date | null;
  receivedDate: Date;
  categoryId: string;
  category: { name: string } | null;
  allocations: Array<{
    buildingId: string;
    amountMinor: number | null;
  }>;
  applications: Array<{
    id: string;
    destinationType: IncomeApplicationDestination;
    amountMinor: number;
    currencyCode: string;
    policyVersionId: string | null;
  }>;
}

export interface ComputeIncomeOffsetsInput {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly period: string;
  readonly valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL';
  readonly baseCurrency: string;
}

export function computeIncomeOffsetsForLiquidation(
  incomes: readonly IncomeWithApplications[],
  params: ComputeIncomeOffsetsInput,
): LiquidationIncomeOffsetsResult {
  const items: IncomeOffsetSnapshotItem[] = [];
  const references: LiquidationIncomeOffsetsResult['references'] = [];
  let incomeOffsetAmountMinor = 0;

  for (const income of incomes) {
    // Defensivo: solo incomes RECORDED del período de la liquidación.
    if (income.status !== 'RECORDED' || income.period !== params.period) {
      continue;
    }

    const offsetApplications = income.applications.filter(
      (application) =>
        application.destinationType === IncomeApplicationDestination.OFFSET_EXPENSES,
    );

    if (offsetApplications.length === 0) {
      continue;
    }

    // Valuación funcional por aplicación (todas las apps del income, incl.
    // FUND/CARRY) para reconciliar exactamente a income.functionalAmountMinor.
    let functionalByApplicationId = new Map<string, number>();
    if (
      params.valuationMode === 'FUNCTIONAL' &&
      income.functionalAmountMinor !== null &&
      income.functionalAmountMinor > 0
    ) {
      const derived = deriveApplicationFunctionalValues({
        incomeFunctionalAmountMinor: income.functionalAmountMinor,
        applications: income.applications,
      });
      functionalByApplicationId = new Map(
        derived.map((item) => [item.applicationId, item.functionalAmountMinor]),
      );
    }

    const allocationWeights: BuildingAllocationWeight[] = income.allocations
      .filter((allocation) => allocation.amountMinor !== null && allocation.amountMinor > 0)
      .map((allocation) => ({
        buildingId: allocation.buildingId,
        amountMinor: allocation.amountMinor as number,
      }));

    for (const application of offsetApplications) {
      const buildingAmountMinor = resolveIncomeOffsetBuildingShare({
        applicationAmountMinor: application.amountMinor,
        applicationScopeType: income.scopeType,
        incomeBuildingId: income.buildingId,
        liquidationBuildingId: params.buildingId,
        allocationWeights,
      });

      if (buildingAmountMinor <= 0) {
        continue; // la aplicación no pertenece a este building
      }

      let valuedAmountMinor: number;

      if (params.valuationMode === 'FUNCTIONAL') {
        const applicationFunctionalValue = functionalByApplicationId.get(application.id);

        if (applicationFunctionalValue === undefined || applicationFunctionalValue <= 0) {
          continue; // sin snapshot funcional convergente → no valora
        }

        // Distribuir el valor funcional de la aplicación entre buildings con
        // los mismos weights (largest remainder determinístico).
        const functionalShares =
          allocationWeights.length > 0
            ? distributeMinorByWeights(applicationFunctionalValue, allocationWeights)
            : [{ buildingId: params.buildingId, amountMinor: applicationFunctionalValue }];

        valuedAmountMinor =
          functionalShares.find((share) => share.buildingId === params.buildingId)?.amountMinor ??
          0;

        if (valuedAmountMinor <= 0) {
          continue;
        }
      } else {
        // LEGACY_NOMINAL: moneda debe coincidir con baseCurrency.
        valueIncomeOffsetForLiquidation({
          application: {
            id: application.id,
            amountMinor: application.amountMinor,
            currencyCode: application.currencyCode,
            functionalAmountMinor: null,
            functionalCurrencyCode: null,
          },
          valuationMode: params.valuationMode,
          baseCurrency: params.baseCurrency,
        });
        valuedAmountMinor = buildingAmountMinor;
      }

      items.push({
        incomeId: income.id,
        incomeApplicationId: application.id,
        categoryId: income.categoryId,
        categoryName: income.category?.name ?? null,
        policyVersionId: application.policyVersionId,
        scopeType: income.scopeType,
        currencyCode: application.currencyCode,
        applicationAmountMinor: application.amountMinor,
        buildingAmountMinor,
        valuedAmountMinor,
        functionalCurrencyCode: income.functionalCurrencyCode,
        exchangeRateId: income.exchangeRateId,
        exchangeRateValue:
          income.exchangeRateValue === null || income.exchangeRateValue === undefined
            ? null
            : income.exchangeRateValue.toString(),
        exchangeRateDirection: income.exchangeRateDirection,
        exchangeRateEffectiveAt: income.exchangeRateEffectiveAt?.toISOString() ?? null,
        conversionDate: income.conversionDate?.toISOString() ?? null,
        receivedDate: income.receivedDate.toISOString(),
        period: income.period,
      });

      references.push({
        incomeApplicationId: application.id,
        buildingId: params.buildingId,
        originalAmountMinor: buildingAmountMinor,
        currencyCode: application.currencyCode,
        valuedAmountMinor,
        baseCurrency: params.baseCurrency,
      });

      incomeOffsetAmountMinor += valuedAmountMinor;
    }
  }

  return {
    items,
    references,
    incomeOffsetAmountMinor,
    incomeOffsetsByCurrency:
      incomeOffsetAmountMinor > 0 ? { [params.baseCurrency]: incomeOffsetAmountMinor } : {},
  };
}

@Injectable()
export class LiquidationIncomeOffsetsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Selecciona los Incomes con OFFSET elegibles para el draft, toma los income
   * locks en orden determinístico y revalida después del lock
   * (race void vs draft → serializable; void que gana excluye el income).
   */
  async collectEligibleOffsets(
    tx: Prisma.TransactionClient,
    params: ComputeIncomeOffsetsInput,
  ): Promise<LiquidationIncomeOffsetsResult> {
    // 1. Incomes RECORDED del período con al menos una aplicación OFFSET.
    const incomes = await tx.income.findMany({
      where: {
        tenantId: params.tenantId,
        period: params.period,
        status: 'RECORDED',
        applications: {
          some: {
            tenantId: params.tenantId,
            destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
          },
        },
      },
      include: {
        category: { select: { name: true } },
        allocations: {
          where: { tenantId: params.tenantId },
          select: { buildingId: true, amountMinor: true },
        },
        applications: {
          where: { tenantId: params.tenantId },
          select: {
            id: true,
            destinationType: true,
            amountMinor: true,
            currencyCode: true,
            policyVersionId: true,
          },
        },
      },
    });

    if (incomes.length === 0) {
      return {
        items: [],
        references: [],
        incomeOffsetAmountMinor: 0,
        incomeOffsetsByCurrency: {},
      };
    }

    // 2. Income locks en orden determinístico por incomeId (void vs draft).
    const incomeIds = incomes.map((income) => income.id).sort();
    for (const incomeId of incomeIds) {
      await acquireIncomeLock(tx, params.tenantId, incomeId);
    }

    // 3. Revalidación post-lock: income debe seguir RECORDED con el mismo período.
    const lockedIncomes = await tx.income.findMany({
      where: { tenantId: params.tenantId, id: { in: incomeIds } },
      select: { id: true, status: true, period: true },
    });
    const incomeById = new Map(lockedIncomes.map((income) => [income.id, income]));

    const revalidated = incomes.filter((income) => {
      const locked = incomeById.get(income.id);
      return locked !== undefined && locked.status === 'RECORDED' && locked.period === params.period;
    });

    return computeIncomeOffsetsForLiquidation(
      revalidated as unknown as IncomeWithApplications[],
      params,
    );
  }
}

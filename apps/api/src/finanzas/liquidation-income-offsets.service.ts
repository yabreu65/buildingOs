import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { IncomeApplicationDestination, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertFunctionalSnapshotForLiquidation,
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

    const allocationWeights: BuildingAllocationWeight[] = income.allocations
      .filter((allocation) => allocation.amountMinor !== null && allocation.amountMinor > 0)
      .map((allocation) => ({
        buildingId: allocation.buildingId,
        amountMinor: allocation.amountMinor as number,
      }));

    // FIN-06R2: la elegibilidad del building se determina ANTES de la
    // validación funcional. Un Income cuyos OFFSET no participan en este
    // building (share 0 en todos) se ignora para esta liquidación, aunque su
    // snapshot funcional esté dañado: el dinero de otro building no puede
    // bloquear esta liquidación.
    const buildingShares = offsetApplications.map((application) => ({
      application,
      buildingAmountMinor: resolveIncomeOffsetBuildingShare({
        applicationAmountMinor: application.amountMinor,
        applicationScopeType: income.scopeType,
        incomeBuildingId: income.buildingId,
        liquidationBuildingId: params.buildingId,
        allocationWeights,
      }),
    }));

    const relevantApplications = buildingShares.filter(
      (entry) => entry.buildingAmountMinor > 0,
    );

    if (relevantApplications.length === 0) {
      continue; // este income no participa en el building de la liquidación
    }

    // Fail-closed (FIN-06R): SOLO cuando el income realmente participa en este
    // building, en modo FUNCTIONAL, el snapshot funcional debe converger;
    // si no → 422. El dinero elegible NUNCA desaparece silenciosamente.
    if (params.valuationMode === 'FUNCTIONAL') {
      assertFunctionalSnapshotForLiquidation({
        incomeId: income.id,
        functionalAmountMinor: income.functionalAmountMinor,
        functionalCurrencyCode: income.functionalCurrencyCode,
        baseCurrency: params.baseCurrency,
      });
    }

    // Valuación funcional por aplicación (todas las apps del income, incl.
    // FUND/CARRY) para reconciliar exactamente a income.functionalAmountMinor.
    let functionalByApplicationId = new Map<string, number>();
    if (params.valuationMode === 'FUNCTIONAL') {
      const derived = deriveApplicationFunctionalValues({
        incomeFunctionalAmountMinor: income.functionalAmountMinor as number,
        applications: income.applications,
      });
      functionalByApplicationId = new Map(
        derived.map((item) => [item.applicationId, item.functionalAmountMinor]),
      );
    }

    for (const { application, buildingAmountMinor } of relevantApplications) {
      let valuedAmountMinor: number;

      if (params.valuationMode === 'FUNCTIONAL') {
        const applicationFunctionalValue = functionalByApplicationId.get(application.id);

        if (applicationFunctionalValue === undefined || applicationFunctionalValue <= 0) {
          // Fail-closed: nunca omitir silenciosamente una aplicación elegible.
          throw new UnprocessableEntityException({
            statusCode: 422,
            error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
            message: `La aplicación OFFSET ${application.id} no posee valor funcional válido`,
          });
        }

        // Distribuir el valor funcional de la aplicación entre buildings con
        // los mismos weights (largest remainder determinístico exacto).
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
   * locks en orden determinístico y RE-CARGA el estado completo DESPUÉS del
   * lock (race void vs draft → serializable; void que gana excluye el income;
   * sin estado stale pre-lock).
   */
  async collectEligibleOffsets(
    tx: Prisma.TransactionClient,
    params: ComputeIncomeOffsetsInput,
  ): Promise<LiquidationIncomeOffsetsResult> {
    // 1. Query inicial SOLO para descubrir incomeIds candidatos.
    const candidateIds = await tx.income.findMany({
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
      select: { id: true },
    });

    const incomeIds = candidateIds.map((income) => income.id).sort();

    if (incomeIds.length === 0) {
      return {
        items: [],
        references: [],
        incomeOffsetAmountMinor: 0,
        incomeOffsetsByCurrency: {},
      };
    }

    // 2. Income locks en orden determinístico por incomeId (void vs draft).
    for (const incomeId of incomeIds) {
      await acquireIncomeLock(tx, params.tenantId, incomeId);
    }

    // 3. POST-LOCK: cargar el estado COMPLETO necesario (income + status +
    //    period + scope + building + snapshot funcional + category +
    //    allocations + applications). Nunca calcular sobre lectura pre-lock.
    const reloaded = await tx.income.findMany({
      where: {
        tenantId: params.tenantId,
        id: { in: incomeIds },
        status: 'RECORDED',
        period: params.period,
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

    return computeIncomeOffsetsForLiquidation(
      reloaded as unknown as IncomeWithApplications[],
      params,
    );
  }
}

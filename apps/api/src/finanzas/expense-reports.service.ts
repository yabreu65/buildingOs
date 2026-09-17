import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  aggregateReportBuckets,
  compareReportCurrencies,
  type ReportCurrencyAmountBucket,
  type ReportCurrencyInput,
} from './currency-buckets';
import {
  allocateByLargestRemainder,
  toBasisPoints,
} from './movement-allocation.service';

const TOTAL_PERCENTAGE_BASIS_POINTS = 100 * 10_000;

interface SharedExpenseAllocation {
  readonly buildingId: string;
  readonly amountMinor: number | null;
  readonly percentage: number | null;
}

/**
 * Reconstructs legacy percentage allocations without altering persisted amounts.
 * It mirrors the canonical allocation service's integer basis-point, floor, and
 * largest-remainder semantics; ties are resolved by original allocation order.
 */
function reconstructSharedAllocationAmounts(
  totalAmountMinor: number,
  allocations: readonly SharedExpenseAllocation[],
): Array<number | null> {
  const amounts = allocations.map((allocation) => allocation.amountMinor);
  const missing = allocations
    .map((allocation, index) => ({ allocation, index }))
    .filter(({ allocation }) => allocation.amountMinor === null);

  if (missing.length === 0) return amounts;

  let persistedTotal = 0;
  for (const amountMinor of amounts) {
    persistedTotal += amountMinor ?? 0;
  }
  const hasPersistedAmounts = allocations.some((allocation) => allocation.amountMinor !== null);
  const weightedMissing = missing.map(({ allocation, index }) => ({
    index,
    basisPoints: allocation.percentage === null ? 0 : toBasisPoints(allocation.percentage),
  }));
  const totalBasisPoints = weightedMissing.reduce(
    (sum, allocation) => sum + allocation.basisPoints,
    0,
  );
  const hasCompletePercentageSet =
    weightedMissing.every(
      (allocation) => Number.isSafeInteger(allocation.basisPoints) && allocation.basisPoints > 0,
    ) && totalBasisPoints > 0;
  const remainingAmountMinor = totalAmountMinor - persistedTotal;
  if (
    !hasPersistedAmounts &&
    hasCompletePercentageSet &&
    totalBasisPoints === TOTAL_PERCENTAGE_BASIS_POINTS
  ) {
    const reconstructed = allocateByLargestRemainder(
      totalAmountMinor,
      missing.map(({ allocation }) => ({
        buildingId: allocation.buildingId,
        percentage: allocation.percentage ?? 0,
      })),
    );
    for (const [index, allocation] of missing.entries()) {
      amounts[allocation.index] = reconstructed[index] ?? null;
    }
    return amounts;
  }

  const canReconstructMixedSet =
    hasPersistedAmounts &&
    hasCompletePercentageSet &&
    remainingAmountMinor >= 0;

  if (canReconstructMixedSet) {
    const reconstructed = weightedMissing.map((allocation) => {
      const numerator = remainingAmountMinor * allocation.basisPoints;
      return {
        ...allocation,
        amountMinor: Math.floor(numerator / totalBasisPoints),
        remainder: numerator % totalBasisPoints,
      };
    });
    const allocatedAmountMinor = reconstructed.reduce(
      (sum, allocation) => sum + allocation.amountMinor,
      0,
    );
    const missingCents = remainingAmountMinor - allocatedAmountMinor;

    reconstructed
      .slice()
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
      .slice(0, missingCents)
      .forEach((allocation) => {
        const targetAllocation = reconstructed.find(
          (candidate) => candidate.index === allocation.index,
        );
        if (targetAllocation) {
          targetAllocation.amountMinor += 1;
        }
      });

    for (const allocation of reconstructed) {
      amounts[allocation.index] = allocation.amountMinor;
    }
    return amounts;
  }

  // An all-null, incomplete percentage set cannot account for the full expense.
  // Preserve its known partial shares without creating an artificial remainder.
  if (
    !hasPersistedAmounts &&
    hasCompletePercentageSet &&
    totalBasisPoints < TOTAL_PERCENTAGE_BASIS_POINTS
  ) {
    for (const allocation of weightedMissing) {
      amounts[allocation.index] = Math.floor(
        (totalAmountMinor * allocation.basisPoints) / TOTAL_PERCENTAGE_BASIS_POINTS,
      );
    }
  }

  return amounts;
}

// ── Types for Notas Revelatorias ──────────────────────────────────────────

export interface IncomeEntry {
  description: string;
  currencyCode: string;
  amountMinor: number;
}

export interface BuildingIncomeSection {
  buildingId: string;
  buildingName: string;
  entries: IncomeEntry[];
  totalByCurrency: ReportCurrencyAmountBucket[];
}

export interface ExpenseLineItem {
  itemNumber: number;
  date: string;       // "2-Feb"
  description: string;
  amountByCurrency: ReportCurrencyAmountBucket[]; // minor units, per currency
}

export interface BuildingExpenseSection {
  buildingId: string;
  buildingName: string;
  items: ExpenseLineItem[];
  totalByCurrency: ReportCurrencyAmountBucket[];
}

export interface AlicuotaRow {
  categoryName: string;
  coefficient: number;
  gastosComunesPerUnit: number;  // USD minor
  gastosPropiosPerUnit: number;  // USD minor
  reservaPerUnit: number;        // USD minor
  totalPerUnit: number;          // USD minor
  unitCount: number;
  totalToRecaudar: number;       // USD minor
}

export interface BuildingAlicuota {
  buildingId: string;
  buildingName: string;
  rows: AlicuotaRow[];
  grandTotal: number;  // USD minor — sum of all totalToRecaudar
  // The Notas Revelatorias alícuota section is deliberately expressed in
  // USD (document header: EXPRESADA DE DÓLARES AMERICANOS); non-USD
  // expenses are reported separately (per-currency buckets) and liquidated
  // per baseCurrency in their own liquidations.
  baseCurrency: 'USD';
}

export interface NotasRevelatoriasReport {
  tenantId: string;
  tenantName: string;
  period: string;       // YYYY-MM
  periodLabel: string;  // "FEBRERO 2026"
  buildingIncomes: BuildingIncomeSection[];
  commonExpenses: ExpenseLineItem[];
  commonTotals: { byCurrency: ReportCurrencyAmountBucket[] };
  buildingExpenses: BuildingExpenseSection[];
  reservaLegal: { buildingName: string; byCurrency: ReportCurrencyAmountBucket[] }[];
  alicuotas: BuildingAlicuota[];
  // NEW: Ajustes retroactivos
  adjustments: AdjustmentLineItem[];
  adjustmentTotals: { byCurrency: ReportCurrencyAmountBucket[] };
}

export interface AdjustmentLineItem {
  itemNumber: number;
  buildingName: string;
  sourcePeriod: string;
  date: string;
  description: string;
  reason: string;
  amountByCurrency: ReportCurrencyAmountBucket[];
}

export interface BuildingPeriodSummary {
  buildingId: string;
  buildingName: string;
  buildingExpensesByCurrency: ReportCurrencyAmountBucket[]; // BUILDING-scope only
  sharedPortionByCurrency: ReportCurrencyAmountBucket[];    // allocated share of TENANT_SHARED
  totalByCurrency: ReportCurrencyAmountBucket[];
}

export interface ExpensePeriodReport {
  period: string;            // YYYY-MM
  totalTenantByCurrency: ReportCurrencyAmountBucket[];   // per-currency totals
  sharedTotalByCurrency: ReportCurrencyAmountBucket[];   // raw TENANT_SHARED per currency
  byBuilding: BuildingPeriodSummary[];
}

@Injectable()
export class ExpenseReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: FinanzasValidators,
  ) {}

  async getExpenseHistory(
    tenantId: string,
    userRoles: string[],
  ): Promise<ExpensePeriodReport[]> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden ver reportes');
    }

    // 1. BUILDING expenses grouped by period + building + CURRENCY
    const buildingRows = await this.prisma.expense.groupBy({
      by: ['period', 'buildingId', 'currencyCode'],
      where: { tenantId, status: 'VALIDATED', scopeType: 'BUILDING' },
      _sum: { amountMinor: true },
    });

    // 2. TENANT_SHARED expenses with their allocations (per currency)
    const sharedExpenses = await this.prisma.expense.findMany({
      where: { tenantId, status: 'VALIDATED', scopeType: 'TENANT_SHARED' },
      select: {
        period: true,
        amountMinor: true,
        currencyCode: true,
        allocations: {
          select: { buildingId: true, amountMinor: true, percentage: true },
        },
      },
    });

    // 3. Building name lookup
    const buildings = await this.prisma.building.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    });
    const buildingNames = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

    // 4. Collect all distinct periods
    const periods = [
      ...new Set([
        ...buildingRows.map((r) => r.period),
        ...sharedExpenses.map((e) => e.period),
      ]),
    ].sort().reverse(); // newest first

    return periods.map((period): ExpensePeriodReport => {
      // Building-scope rows for this period (per building + currency)
      const bRows = buildingRows.filter((r) => r.period === period);

      // Shared expenses for this period and their per-building allocations
      const sharedPeriod = sharedExpenses.filter((e) => e.period === period);
      const sharedTotalByCurrency = aggregateReportBuckets(
        sharedPeriod.map((e) => ({ currency: e.currencyCode, amountMinor: e.amountMinor })),
      );

      const sharedByBuilding = new Map<
        string,
        Array<{ currency: string; amountMinor: number }>
      >();
      for (const exp of sharedPeriod) {
        for (const alloc of exp.allocations) {
          if (!alloc.buildingId) continue;
          const amount =
            alloc.amountMinor ??
            Math.floor(exp.amountMinor * ((alloc.percentage ?? 0) / 100));
          const entries = sharedByBuilding.get(alloc.buildingId) ?? [];
          entries.push({ currency: exp.currencyCode, amountMinor: amount });
          sharedByBuilding.set(alloc.buildingId, entries);
        }
      }

      // All building IDs involved in this period
      const buildingIds = [
        ...new Set([
          ...bRows.map((r) => r.buildingId).filter(Boolean) as string[],
          ...Array.from(sharedByBuilding.keys()),
        ]),
      ];

      const byBuilding = buildingIds.map((buildingId): BuildingPeriodSummary => {
        const buildingExpensesByCurrency = aggregateReportBuckets(
          bRows
            .filter((r) => r.buildingId === buildingId)
            .map((r) => ({
              currency: r.currencyCode,
              amountMinor: r._sum.amountMinor ?? 0,
            })),
        );
        const sharedPortionByCurrency = aggregateReportBuckets(
          sharedByBuilding.get(buildingId) ?? [],
        );
        const totalByCurrency = aggregateReportBuckets([
          ...buildingExpensesByCurrency.map((b) => ({
            currency: b.currency,
            amountMinor: b.amountMinor,
          })),
          ...sharedPortionByCurrency.map((b) => ({
            currency: b.currency,
            amountMinor: b.amountMinor,
          })),
        ]);
        return {
          buildingId,
          buildingName: buildingNames[buildingId] ?? buildingId,
          buildingExpensesByCurrency,
          sharedPortionByCurrency,
          totalByCurrency,
        };
      });

      const totalTenantByCurrency = aggregateReportBuckets(
        byBuilding.flatMap((b) => b.totalByCurrency.map((x) => ({ currency: x.currency, amountMinor: x.amountMinor }))),
      );

      return { period, totalTenantByCurrency, sharedTotalByCurrency, byBuilding };
    });
  }

  // ── Notas Revelatorias ───────────────────────────────────────────────────

  async getNotasRevelatorias(
    tenantId: string,
    period: string,
    userRoles: string[],
  ): Promise<NotasRevelatoriasReport> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden ver reportes');
    }

    const [tenant, buildings, incomes, commonExps, buildingExps, unitCategories, liquidations, adjustments] =
      await Promise.all([
        this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),

        this.prisma.building.findMany({
          where: { tenantId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),

        this.prisma.income.findMany({
          where: { tenantId, period, status: 'RECORDED' },
          orderBy: [{ buildingId: 'asc' }, { receivedDate: 'asc' }],
        }),

        this.prisma.expense.findMany({
          where: { tenantId, period, scopeType: 'TENANT_SHARED', status: 'VALIDATED' },
          include: {
            allocations: {
              where: { tenantId },
              orderBy: { buildingId: 'asc' },
              select: { buildingId: true, amountMinor: true, percentage: true },
            },
          },
          orderBy: { invoiceDate: 'asc' },
        }),

        this.prisma.expense.findMany({
          where: { tenantId, period, scopeType: 'BUILDING', status: 'VALIDATED' },
          orderBy: [{ buildingId: 'asc' }, { invoiceDate: 'asc' }],
        }),

        this.prisma.unitCategory.findMany({
          where: { tenantId, active: true },
          include: {
            units: {
              where: { isBillable: true },
              select: { id: true, buildingId: true },
            },
          },
          orderBy: { name: 'asc' },
        }),

        this.prisma.liquidation.findMany({
          where: { tenantId, period, status: 'PUBLISHED' },
          select: { buildingId: true, totalAmountMinor: true, baseCurrency: true },
        }),

        this.prisma.adjustment.findMany({
          where: { tenantId, status: 'VALIDATED', targetPeriod: period },
          include: { building: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    const periodLabel = this.formatPeriodLabel(period);

    // ── Incomes grouped by building ────────────────────────────────────────
    const buildingIncomes: BuildingIncomeSection[] = buildings.map((b) => {
      const bIncomes = incomes.filter((i) => i.buildingId === b.id);
      const entries: IncomeEntry[] = bIncomes.map((i) => ({
        description: i.description ?? 'Ingreso por alícuota',
        currencyCode: i.currencyCode,
        amountMinor: i.amountMinor,
      }));
      return {
        buildingId: b.id,
        buildingName: b.name,
        entries,
        totalByCurrency: aggregateReportBuckets(
          bIncomes.map((i) => ({ currency: i.currencyCode, amountMinor: i.amountMinor })),
        ),
      };
    });

    // Also include tenant-level incomes (no buildingId) in a generic section
    const tenantLevelIncomes = incomes.filter((i) => !i.buildingId);
    if (tenantLevelIncomes.length > 0) {
      buildingIncomes.push({
        buildingId: '__tenant__',
        buildingName: 'Estacionamiento / Áreas comunes',
        entries: tenantLevelIncomes.map((i) => ({
          description: i.description ?? 'Ingreso',
          currencyCode: i.currencyCode,
          amountMinor: i.amountMinor,
        })),
        totalByCurrency: aggregateReportBuckets(
          tenantLevelIncomes.map((i) => ({ currency: i.currencyCode, amountMinor: i.amountMinor })),
        ),
      });
    }

    // ── Common expenses ────────────────────────────────────────────────────
    let itemCounter = 1;
    const commonExpenses: ExpenseLineItem[] = commonExps.map((e) => ({
      itemNumber: itemCounter++,
      date: this.formatDate(e.invoiceDate),
      description: e.description ?? '',
      amountByCurrency: [{ currency: e.currencyCode, amountMinor: e.amountMinor }],
    }));
    const commonTotals = {
      byCurrency: aggregateReportBuckets(
        commonExps.map((e) => ({ currency: e.currencyCode, amountMinor: e.amountMinor })),
      ),
    };

    const sharedAmountsByBuilding = new Map<string, ReportCurrencyInput[]>();
    for (const expense of commonExps) {
      const allocationAmounts = reconstructSharedAllocationAmounts(
        expense.amountMinor,
        expense.allocations,
      );
      for (const [index, allocation] of expense.allocations.entries()) {
        const amountMinor = allocationAmounts[index];
        if (!allocation.buildingId || amountMinor === null || amountMinor === undefined) continue;

        const amounts = sharedAmountsByBuilding.get(allocation.buildingId) ?? [];
        amounts.push({ currency: expense.currencyCode, amountMinor });
        sharedAmountsByBuilding.set(allocation.buildingId, amounts);
      }
    }
    const getSharedAmountForBuilding = (buildingId: string, currency: string): number =>
      (sharedAmountsByBuilding.get(buildingId) ?? [])
        .filter((amount) => amount.currency === currency)
        .reduce((sum, amount) => sum + amount.amountMinor, 0);

    // ── Building-specific expenses ─────────────────────────────────────────
    const buildingExpenses: BuildingExpenseSection[] = buildings.map((b) => {
      const bExps = buildingExps.filter((e) => e.buildingId === b.id);
      const items: ExpenseLineItem[] = bExps.map((e) => ({
        itemNumber: itemCounter++,
        date: this.formatDate(e.invoiceDate),
        description: e.description ?? '',
        amountByCurrency: [{ currency: e.currencyCode, amountMinor: e.amountMinor }],
      }));
      return {
        buildingId: b.id,
        buildingName: b.name,
        items,
        totalByCurrency: aggregateReportBuckets(
          bExps.map((e) => ({ currency: e.currencyCode, amountMinor: e.amountMinor })),
        ),
      };
    });

    // ── Reserva Legal (10% of published liquidation per building) ──────────
    const reservaLegal = buildings.map((b) => {
      const liq = liquidations.find((l) => l.buildingId === b.id);
      const totalMinor = liq?.totalAmountMinor ?? 0;
      // Reserva = 10% of the liquidation total, expressed in the liquidation
      // base currency (never relabelled to a different currency).
      const reservaByCurrency: ReportCurrencyInput[] = [];
      if (liq && totalMinor > 0) {
        reservaByCurrency.push({
          currency: liq.baseCurrency,
          amountMinor: Math.floor(totalMinor * 0.1),
        });
      }
      // VES reserve: 10% of total VES building expenses (+ shared share)
      const bVesTotal = buildingExps
        .filter((e) => e.buildingId === b.id && e.currencyCode === 'VES')
        .reduce((s, e) => s + e.amountMinor, 0);
      const sharedVes = getSharedAmountForBuilding(b.id, 'VES');
      const reservaVES = Math.floor((bVesTotal + sharedVes) * 0.1);
      if (reservaVES > 0) {
        reservaByCurrency.push({ currency: 'VES', amountMinor: reservaVES });
      }
      return {
        buildingName: b.name,
        byCurrency: aggregateReportBuckets(reservaByCurrency),
      };
    });

    // ── Alícuotas per building ─────────────────────────────────────────────
    const alicuotas: BuildingAlicuota[] = buildings.map((b) => {
      const bCategories = unitCategories.filter((uc) => uc.buildingId === b.id);
      const bComunesUSD = getSharedAmountForBuilding(b.id, 'USD');
      const bPropiosUSD = buildingExps
        .filter((e) => e.buildingId === b.id && e.currencyCode === 'USD')
        .reduce((s, e) => s + e.amountMinor, 0);

      const rows: AlicuotaRow[] = bCategories.map((cat) => {
        const unitCount = cat.units.filter((u) => u.buildingId === b.id).length;
        const coefFactor = cat.coefficient / 100;
        const gastosComunesPerUnit = Math.round(bComunesUSD * coefFactor);
        const gastosPropiosPerUnit = Math.round(bPropiosUSD * coefFactor);
        const reservaPerUnit = Math.round((gastosComunesPerUnit + gastosPropiosPerUnit) * 0.1);
        const totalPerUnit = gastosComunesPerUnit + gastosPropiosPerUnit + reservaPerUnit;
        return {
          categoryName: cat.name,
          coefficient: cat.coefficient,
          gastosComunesPerUnit,
          gastosPropiosPerUnit,
          reservaPerUnit,
          totalPerUnit,
          unitCount,
          totalToRecaudar: totalPerUnit * unitCount,
        };
      });

      const grandTotal = rows.reduce((s, r) => s + r.totalToRecaudar, 0);
      return { buildingId: b.id, buildingName: b.name, rows, grandTotal, baseCurrency: 'USD' as const };
    });

    // ── Ajustes / Retroactivos ───────────────────────────────────────────────
    let adjCounter = 1;
    const adjustmentItems: AdjustmentLineItem[] = adjustments.map((adj) => ({
      itemNumber: adjCounter++,
      buildingName: adj.building.name,
      sourcePeriod: adj.sourcePeriod,
      date: this.formatDate(adj.sourceInvoiceDate),
      description: `${adj.categoryId} - Ajuste por ${adj.sourcePeriod}`,
      reason: adj.reason,
      amountByCurrency: adj.currencyCode
        ? [{ currency: adj.currencyCode, amountMinor: adj.amountMinor }]
        : [],
    }));
    const adjustmentTotals = {
      byCurrency: aggregateReportBuckets(
        adjustments
          .filter((a) => a.currencyCode)
          .map((a) => ({ currency: a.currencyCode as string, amountMinor: a.amountMinor })),
      ),
    };

    return {
      tenantId,
      tenantName: tenant?.name ?? tenantId,
      period,
      periodLabel,
      buildingIncomes: buildingIncomes.filter((b) => b.entries.length > 0),
      commonExpenses,
      commonTotals,
      buildingExpenses: buildingExpenses.filter((b) => b.items.length > 0),
      reservaLegal,
      alicuotas,
      adjustments: adjustmentItems,
      adjustmentTotals,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private formatDate(date: Date | string): string {
    const d = new Date(date);
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${d.getDate()}-${months[d.getMonth()]}`;
  }

  private formatPeriodLabel(period: string): string {
    const [year, month] = period.split('-');
    const months = [
      'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
      'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
    ];
    return `${months[parseInt(month ?? '1', 10) - 1]} ${year ?? ''}`;
  }
}

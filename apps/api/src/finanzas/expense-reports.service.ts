import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  aggregateReportBuckets,
  compareReportCurrencies,
  type ReportCurrencyAmountBucket,
  type ReportCurrencyInput,
} from './currency-buckets';

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
      const sharedVes = commonExps.filter((e) => e.currencyCode === 'VES').reduce((s, e) => s + e.amountMinor, 0);
      const reservaVES = Math.floor((bVesTotal + sharedVes / Math.max(buildings.length, 1)) * 0.1);
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
      const bComunesUSD = commonExps
        .filter((e) => e.currencyCode === 'USD')
        .reduce((s, e) => s + e.amountMinor, 0);
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

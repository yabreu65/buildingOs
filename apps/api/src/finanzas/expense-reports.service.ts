import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanzasValidators } from './finanzas.validators';

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
  totalUSD: number;
  totalVES: number;
  totalPesos: number;
}

export interface ExpenseLineItem {
  itemNumber: number;
  date: string;       // "2-Feb"
  description: string;
  usdAmount: number;  // in minor units
  vesAmount: number;
  pesosAmount: number;
}

export interface BuildingExpenseSection {
  buildingId: string;
  buildingName: string;
  items: ExpenseLineItem[];
  totalUSD: number;
  totalVES: number;
  totalPesos: number;
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
}

export interface NotasRevelatoriasReport {
  tenantId: string;
  tenantName: string;
  period: string;       // YYYY-MM
  periodLabel: string;  // "FEBRERO 2026"
  buildingIncomes: BuildingIncomeSection[];
  commonExpenses: ExpenseLineItem[];
  commonTotals: { usd: number; ves: number; pesos: number };
  buildingExpenses: BuildingExpenseSection[];
  reservaLegal: { buildingName: string; usd: number; ves: number }[];
  alicuotas: BuildingAlicuota[];
  // NEW: Ajustes retroactivos
  adjustments: AdjustmentLineItem[];
  adjustmentTotals: { usd: number; ves: number; pesos: number };
}

export interface AdjustmentLineItem {
  itemNumber: number;
  buildingName: string;
  sourcePeriod: string;
  date: string;
  description: string;
  reason: string;
  usdAmount: number;
  vesAmount: number;
  pesosAmount: number;
}

export interface BuildingPeriodSummary {
  buildingId: string;
  buildingName: string;
  buildingExpenses: number;  // BUILDING-scope only
  sharedPortion: number;     // allocated share of TENANT_SHARED
  total: number;
}

export interface ExpensePeriodReport {
  period: string;            // YYYY-MM
  totalTenant: number;       // sum of all building totals
  sharedTotal: number;       // raw TENANT_SHARED expenses total
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

    // 1. BUILDING expenses grouped by period + building
    const buildingRows = await this.prisma.expense.groupBy({
      by: ['period', 'buildingId'],
      where: { tenantId, status: 'VALIDATED', scopeType: 'BUILDING' },
      _sum: { amountMinor: true },
    });

    // 2. TENANT_SHARED expenses with their allocations
    const sharedExpenses = await this.prisma.expense.findMany({
      where: { tenantId, status: 'VALIDATED', scopeType: 'TENANT_SHARED' },
      select: {
        period: true,
        amountMinor: true,
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
      // Building-scope rows for this period
      const bRows = buildingRows.filter((r) => r.period === period);

      // Shared expenses for this period and their per-building allocations
      const sharedPeriod = sharedExpenses.filter((e) => e.period === period);
      const sharedTotal = sharedPeriod.reduce((s, e) => s + e.amountMinor, 0);

      const sharedByBuilding: Record<string, number> = {};
      for (const exp of sharedPeriod) {
        for (const alloc of exp.allocations) {
          if (!alloc.buildingId) continue;
          const amount =
            alloc.amountMinor ??
            Math.floor(exp.amountMinor * ((alloc.percentage ?? 0) / 100));
          sharedByBuilding[alloc.buildingId] =
            (sharedByBuilding[alloc.buildingId] ?? 0) + amount;
        }
      }

      // All building IDs involved in this period
      const buildingIds = [
        ...new Set([
          ...bRows.map((r) => r.buildingId).filter(Boolean) as string[],
          ...Object.keys(sharedByBuilding),
        ]),
      ];

      const byBuilding = buildingIds.map((buildingId): BuildingPeriodSummary => {
        const buildingExpenses =
          bRows.find((r) => r.buildingId === buildingId)?._sum.amountMinor ?? 0;
        const sharedPortion = sharedByBuilding[buildingId] ?? 0;
        return {
          buildingId,
          buildingName: buildingNames[buildingId] ?? buildingId,
          buildingExpenses,
          sharedPortion,
          total: buildingExpenses + sharedPortion,
        };
      });

      const totalTenant = byBuilding.reduce((s, b) => s + b.total, 0);

      return { period, totalTenant, sharedTotal, byBuilding };
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
        totalUSD: this.sumByCurrency(bIncomes, 'USD'),
        totalVES: this.sumByCurrency(bIncomes, 'VES'),
        totalPesos: this.sumByCurrency(bIncomes, 'ARS'),
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
        totalUSD: this.sumByCurrency(tenantLevelIncomes, 'USD'),
        totalVES: this.sumByCurrency(tenantLevelIncomes, 'VES'),
        totalPesos: this.sumByCurrency(tenantLevelIncomes, 'ARS'),
      });
    }

    // ── Common expenses ────────────────────────────────────────────────────
    let itemCounter = 1;
    const commonExpenses: ExpenseLineItem[] = commonExps.map((e) => ({
      itemNumber: itemCounter++,
      date: this.formatDate(e.invoiceDate),
      description: e.description ?? '',
      usdAmount: e.currencyCode === 'USD' ? e.amountMinor : 0,
      vesAmount: e.currencyCode === 'VES' ? e.amountMinor : 0,
      pesosAmount: !['USD', 'VES'].includes(e.currencyCode) ? e.amountMinor : 0,
    }));
    const commonTotals = {
      usd: commonExps.filter((e) => e.currencyCode === 'USD').reduce((s, e) => s + e.amountMinor, 0),
      ves: commonExps.filter((e) => e.currencyCode === 'VES').reduce((s, e) => s + e.amountMinor, 0),
      pesos: commonExps.filter((e) => !['USD', 'VES'].includes(e.currencyCode)).reduce((s, e) => s + e.amountMinor, 0),
    };

    // ── Building-specific expenses ─────────────────────────────────────────
    const buildingExpenses: BuildingExpenseSection[] = buildings.map((b) => {
      const bExps = buildingExps.filter((e) => e.buildingId === b.id);
      const items: ExpenseLineItem[] = bExps.map((e) => ({
        itemNumber: itemCounter++,
        date: this.formatDate(e.invoiceDate),
        description: e.description ?? '',
        usdAmount: e.currencyCode === 'USD' ? e.amountMinor : 0,
        vesAmount: e.currencyCode === 'VES' ? e.amountMinor : 0,
        pesosAmount: !['USD', 'VES'].includes(e.currencyCode) ? e.amountMinor : 0,
      }));
      return {
        buildingId: b.id,
        buildingName: b.name,
        items,
        totalUSD: this.sumByCurrency(bExps, 'USD'),
        totalVES: this.sumByCurrency(bExps, 'VES'),
        totalPesos: this.sumByCurrency(bExps.filter((e) => !['USD', 'VES'].includes(e.currencyCode)), undefined),
      };
    });

    // ── Reserva Legal (10% of published liquidation per building) ──────────
    const reservaLegal = buildings.map((b) => {
      const liq = liquidations.find((l) => l.buildingId === b.id);
      const totalMinor = liq?.totalAmountMinor ?? 0;
      // Reserva = 10% of total alícuota
      const reservaUSD = Math.floor(totalMinor * 0.1);
      // For VES we take 10% of total VES building expenses
      const bVesTotal = buildingExps
        .filter((e) => e.buildingId === b.id && e.currencyCode === 'VES')
        .reduce((s, e) => s + e.amountMinor, 0);
      const sharedVes = commonExps.filter((e) => e.currencyCode === 'VES').reduce((s, e) => s + e.amountMinor, 0);
      const reservaVES = Math.floor((bVesTotal + sharedVes / Math.max(buildings.length, 1)) * 0.1);
      return { buildingName: b.name, usd: reservaUSD, ves: reservaVES };
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
      return { buildingId: b.id, buildingName: b.name, rows, grandTotal };
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
      usdAmount: adj.currencyCode === 'USD' ? adj.amountMinor : 0,
      vesAmount: adj.currencyCode === 'VES' ? adj.amountMinor : 0,
      pesosAmount: !['USD', 'VES'].includes(adj.currencyCode) ? adj.amountMinor : 0,
    }));
    const adjustmentTotals = {
      usd: adjustments.filter((a) => a.currencyCode === 'USD').reduce((s, a) => s + a.amountMinor, 0),
      ves: adjustments.filter((a) => a.currencyCode === 'VES').reduce((s, a) => s + a.amountMinor, 0),
      pesos: adjustments.filter((a) => !['USD', 'VES'].includes(a.currencyCode)).reduce((s, a) => s + a.amountMinor, 0),
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

  private sumByCurrency(
    records: { amountMinor: number; currencyCode?: string }[],
    currency: string | undefined,
  ): number {
    return records
      .filter((r) => (currency ? r.currencyCode === currency : true))
      .reduce((s, r) => s + r.amountMinor, 0);
  }

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

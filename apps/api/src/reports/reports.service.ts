import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus, UnitOccupantRole } from '@prisma/client';
import { CsvUtility, CsvExportResult } from './csv.utility';
import { getLastCompletePeriods, getPeriodDateRange } from '../shared/finance/period.utils';
import {
  DebtAgingBuckets,
  DebtByPeriodPeriodRow,
  DebtByPeriodResponseDto,
  DebtByPeriodUnitRow,
  DebtAgingResponseDto,
  DebtAgingRow,
  DebtAgingWorstCase,
} from './reports.dto';

export interface ReportFilters {
  buildingId?: string;
  buildingIds?: string[];
  from?: Date;
  to?: Date;
  period?: string;
}

export interface TicketsReportData {
  byStatus: Array<{ status: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
  avgTimeToFirstResponseHours: number;
  avgTimeToResolveHours: number;
}

export interface DelinquentUnit {
  unitId: string;
  outstanding: number;
}

export interface FinanceReportData {
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  delinquentUnitsCount: number;
  delinquentUnits: DelinquentUnit[];
  collectionRate: number;
  currency: string;
}

export interface ChannelBreakdown {
  channel: string;
  sent: number;
  read: number;
  readRate: number;
}

export interface CommunicationsReportData {
  totalRecipients: number;
  totalRead: number;
  readRate: number;
  byChannel: ChannelBreakdown[];
}

export interface ActivityReportData {
  ticketsCreated: number;
  paymentsSubmitted: number;
  documentsUploaded: number;
  communicationsSent: number;
}

export interface DebtSummaryReportData {
  periods: string[];
  debtByPeriod: Record<string, number>;
  totalDebt: number;
}

export interface DebtSummaryFilters {
  buildingId?: string;
  buildingIds?: string[];
  lastMonths?: number;
  excludeCurrent?: boolean;
}

export interface DebtAgingFilters {
  buildingId?: string;
  buildingIds?: string[];
  asOf: string;
  timezone?: string;
}

export interface DebtByPeriodFilters {
  buildingId?: string;
  buildingIds?: string[];
  asOf: string;
  timezone?: string;
}

interface OverdueChargeProjection {
  id: string;
  buildingId: string;
  period: string;
  amount: number;
  dueDate: Date;
  unitId: string;
  building: { id: string; name: string };
  unit: { id: string; label: string | null; code: string };
  paymentAllocations: Array<{
    amount: number;
    payment: {
      status: PaymentStatus;
    } | null;
  }>;
}

interface OverdueChargeSnapshot {
  charge: OverdueChargeProjection;
  allocatedPaid: number;
  outstanding: number;
  dueLocalDate: string;
  bucket: keyof DebtAgingBuckets;
}

interface UnitDebtAccumulator {
  unitId: string;
  buildingId: string;
  unitLabel: string;
  overdueTotal: number;
  oldestUnpaidDueDate: string;
  oldestUnpaidPeriod: string;
  oldestUnpaidDateObj: Date;
  oldestBucket: keyof DebtAgingBuckets;
  bucketAmounts: DebtAgingBuckets;
}

interface OccupantProjection {
  unitId: string;
  memberId: string;
  role: UnitOccupantRole;
  name: string;
}

/**
 * ReportsService: Aggregation and reporting logic
 *
 * Provides 4 main report types:
 * - Tickets: Status, priority, categories, response times
 * - Finance: Charges, payments, delinquent units
 * - Communications: Channel breakdown, read rates
 * - Activity: Counts of key events
 */
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Debt summary by recent business periods.
   *
   * MVP semantics:
   * - Charges by Charge.period
   * - Paid by Payment.paidAt (cash basis, no allocation split by period)
   */
  async getDebtSummary(
    tenantId: string,
    filters: DebtSummaryFilters,
  ): Promise<DebtSummaryReportData> {
    if (filters.buildingIds && filters.buildingIds.length === 0) {
      return {
        periods: [],
        debtByPeriod: {},
        totalDebt: 0,
      };
    }

    const lastMonths = Math.min(Math.max(filters.lastMonths ?? 3, 1), 12);
    const excludeCurrent = filters.excludeCurrent ?? true;
    const periods = getLastCompletePeriods(new Date(), lastMonths, excludeCurrent);
    const scopedBuildingIds = this.resolveScopedBuildingIds(filters);

    const debtByPeriod: Record<string, number> = {};
    let totalDebt = 0;

    for (const period of periods) {
      const { startDate, endDate } = getPeriodDateRange(period);
      const [charges, paid] = await Promise.all([
        this.prisma.charge.aggregate({
          where: {
            tenantId,
            canceledAt: null,
            period,
            ...(scopedBuildingIds ? { buildingId: { in: scopedBuildingIds } } : {}),
          },
          _sum: { amount: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            tenantId,
            status: { in: [PaymentStatus.APPROVED, PaymentStatus.RECONCILED] },
            paidAt: { gte: startDate, lte: endDate },
            ...(scopedBuildingIds ? { buildingId: { in: scopedBuildingIds } } : {}),
          },
          _sum: { amount: true },
        }),
      ]);

      const chargesAmount = charges._sum.amount || 0;
      const paidAmount = paid._sum.amount || 0;
      const debt = chargesAmount - paidAmount;
      debtByPeriod[period] = debt;
      totalDebt += debt;
    }

    return {
      periods,
      debtByPeriod,
      totalDebt,
    };
  }

  /**
   * Get debt aging (real overdue snapshot) using payment allocations.
   */
  async getDebtAgingReport(
    tenantId: string,
    filters: DebtAgingFilters,
  ): Promise<DebtAgingResponseDto> {
    if (filters.buildingIds && filters.buildingIds.length === 0) {
      return this.buildEmptyDebtAging(filters.asOf);
    }

    const scopedBuildingIds = this.resolveScopedBuildingIds(filters);
    const asOf = filters.asOf;
    const timezone = filters.timezone ?? 'America/Argentina/Buenos_Aires';
    const overdueCharges = await this.getOverdueChargeSnapshots(
      tenantId,
      asOf,
      timezone,
      scopedBuildingIds,
    );

    if (overdueCharges.length === 0) {
      return this.buildEmptyDebtAging(asOf);
    }

    const unitIds = [...new Set(overdueCharges.map((item) => item.charge.unitId))];
    const { occupantsByUnit, lastPaymentByUnit } = await this.resolveDebtUnitContext(
      tenantId,
      unitIds,
      scopedBuildingIds,
    );

    const buckets: DebtAgingBuckets = {
      '0_30': 0,
      '31_60': 0,
      '61_90': 0,
      '90_plus': 0,
    };
    const units = new Map<string, UnitDebtAccumulator>();
    let totalOverdue = 0;
    let worstCase: DebtAgingWorstCase | null = null;
    let worstCaseDueLocalDate: string | null = null;

    for (const item of overdueCharges) {
      totalOverdue += item.outstanding;
      buckets[item.bucket] += item.outstanding;

      const unitKey = item.charge.unitId;
      const existing = units.get(unitKey);
      if (!existing) {
        units.set(unitKey, {
          unitId: item.charge.unitId,
          buildingId: item.charge.buildingId,
          unitLabel: this.buildUnitLabel(item.charge.building.name, item.charge.unit),
          overdueTotal: item.outstanding,
          oldestUnpaidDueDate: item.dueLocalDate,
          oldestUnpaidPeriod: item.charge.period,
          oldestUnpaidDateObj: item.charge.dueDate,
          oldestBucket: item.bucket,
          bucketAmounts: {
            '0_30': item.bucket === '0_30' ? item.outstanding : 0,
            '31_60': item.bucket === '31_60' ? item.outstanding : 0,
            '61_90': item.bucket === '61_90' ? item.outstanding : 0,
            '90_plus': item.bucket === '90_plus' ? item.outstanding : 0,
          },
        });
      } else {
        existing.overdueTotal += item.outstanding;
        existing.bucketAmounts[item.bucket] += item.outstanding;
        if (item.charge.dueDate < existing.oldestUnpaidDateObj) {
          existing.oldestUnpaidDateObj = item.charge.dueDate;
          existing.oldestUnpaidDueDate = item.dueLocalDate;
          existing.oldestUnpaidPeriod = item.charge.period;
          existing.oldestBucket = item.bucket;
        }
      }

      if (
        !worstCase ||
        (worstCaseDueLocalDate !== null && item.dueLocalDate < worstCaseDueLocalDate) ||
        (worstCaseDueLocalDate !== null &&
          item.dueLocalDate === worstCaseDueLocalDate &&
          item.outstanding > worstCase.outstanding)
      ) {
        worstCase = {
          unitId: item.charge.unitId,
          unitLabel: this.buildUnitLabel(item.charge.building.name, item.charge.unit),
          period: item.charge.period,
          dueDate: item.dueLocalDate,
          outstanding: item.outstanding,
        };
        worstCaseDueLocalDate = item.dueLocalDate;
      }
    }

    const rowsByUnit: DebtAgingRow[] = Array.from(units.values())
      .map((unit) => ({
        unitId: unit.unitId,
        buildingId: unit.buildingId,
        unitLabel: unit.unitLabel,
        responsable: occupantsByUnit.get(unit.unitId) || null,
        overdueTotal: unit.overdueTotal,
        bucket: this.resolveDominantBucket(unit),
        oldestUnpaidDueDate: unit.oldestUnpaidDueDate,
        oldestUnpaidPeriod: unit.oldestUnpaidPeriod,
        lastPaymentDate: lastPaymentByUnit.get(unit.unitId) || null,
      }))
      .sort((a, b) => b.overdueTotal - a.overdueTotal);

    return {
      asOf,
      totalOverdue,
      unitsMorosas: rowsByUnit.length,
      buckets,
      worstCase,
      rowsByUnit,
    };
  }

  /**
   * Get overdue debt grouped by unit and business period.
   */
  async getDebtByPeriodReport(
    tenantId: string,
    filters: DebtByPeriodFilters,
  ): Promise<DebtByPeriodResponseDto> {
    if (filters.buildingIds && filters.buildingIds.length === 0) {
      return {
        asOf: filters.asOf,
        rowsByUnit: [],
      };
    }

    const scopedBuildingIds = this.resolveScopedBuildingIds(filters);
    const asOf = filters.asOf;
    const timezone = filters.timezone ?? 'America/Argentina/Buenos_Aires';

    const overdueCharges = await this.getOverdueChargeSnapshots(
      tenantId,
      asOf,
      timezone,
      scopedBuildingIds,
    );

    if (overdueCharges.length === 0) {
      return {
        asOf,
        rowsByUnit: [],
      };
    }

    const unitIds = [...new Set(overdueCharges.map((item) => item.charge.unitId))];
    const { occupantsByUnit, lastPaymentByUnit } = await this.resolveDebtUnitContext(
      tenantId,
      unitIds,
      scopedBuildingIds,
    );

    const unitAccumulators = new Map<
      string,
      {
        unitId: string;
        buildingId: string;
        unitLabel: string;
        totalOverdue: number;
        oldestUnpaidPeriod: string;
        oldestUnpaidDueDate: string;
        oldestUnpaidDateObj: Date;
        periods: Map<
          string,
          {
            period: string;
            dueDate: string;
            dueDateObj: Date;
            charged: number;
            allocatedPaid: number;
            outstanding: number;
          }
        >;
      }
    >();

    for (const item of overdueCharges) {
      const unitKey = item.charge.unitId;
      const existingUnit = unitAccumulators.get(unitKey);

      if (!existingUnit) {
        unitAccumulators.set(unitKey, {
          unitId: item.charge.unitId,
          buildingId: item.charge.buildingId,
          unitLabel: this.buildUnitLabel(item.charge.building.name, item.charge.unit),
          totalOverdue: item.outstanding,
          oldestUnpaidPeriod: item.charge.period,
          oldestUnpaidDueDate: item.dueLocalDate,
          oldestUnpaidDateObj: item.charge.dueDate,
          periods: new Map([
            [
              item.charge.period,
              {
                period: item.charge.period,
                dueDate: item.dueLocalDate,
                dueDateObj: item.charge.dueDate,
                charged: item.charge.amount,
                allocatedPaid: item.allocatedPaid,
                outstanding: item.outstanding,
              },
            ],
          ]),
        });
      } else {
        existingUnit.totalOverdue += item.outstanding;
        if (item.charge.dueDate < existingUnit.oldestUnpaidDateObj) {
          existingUnit.oldestUnpaidDateObj = item.charge.dueDate;
          existingUnit.oldestUnpaidPeriod = item.charge.period;
          existingUnit.oldestUnpaidDueDate = item.dueLocalDate;
        }

        const existingPeriod = existingUnit.periods.get(item.charge.period);
        if (!existingPeriod) {
          existingUnit.periods.set(item.charge.period, {
            period: item.charge.period,
            dueDate: item.dueLocalDate,
            dueDateObj: item.charge.dueDate,
            charged: item.charge.amount,
            allocatedPaid: item.allocatedPaid,
            outstanding: item.outstanding,
          });
        } else {
          existingPeriod.charged += item.charge.amount;
          existingPeriod.allocatedPaid += item.allocatedPaid;
          existingPeriod.outstanding += item.outstanding;
          if (item.charge.dueDate < existingPeriod.dueDateObj) {
            existingPeriod.dueDateObj = item.charge.dueDate;
            existingPeriod.dueDate = item.dueLocalDate;
          }
        }
      }
    }

    const rowsByUnit: DebtByPeriodUnitRow[] = Array.from(unitAccumulators.values())
      .map((unit) => {
        const periods: DebtByPeriodPeriodRow[] = Array.from(unit.periods.values())
          .sort((a, b) => a.period.localeCompare(b.period))
          .map((periodItem) => ({
            period: periodItem.period,
            dueDate: periodItem.dueDate,
            charged: periodItem.charged,
            allocatedPaid: periodItem.allocatedPaid,
            outstanding: periodItem.outstanding,
          }));

        return {
          unitId: unit.unitId,
          buildingId: unit.buildingId,
          unitLabel: unit.unitLabel,
          responsable: occupantsByUnit.get(unit.unitId) || null,
          totalOverdue: unit.totalOverdue,
          periods,
          oldestUnpaidPeriod: unit.oldestUnpaidPeriod,
          oldestUnpaidDueDate: unit.oldestUnpaidDueDate,
          lastPaymentDate: lastPaymentByUnit.get(unit.unitId) || null,
        };
      })
      .sort((a, b) => b.totalOverdue - a.totalOverdue);

    return {
      asOf,
      rowsByUnit,
    };
  }

  /**
   * Get tickets report with aggregations by status, priority, category
   * Calculates average response and resolution times
   */
  async getTicketsReport(
    tenantId: string,
    filters: ReportFilters
  ): Promise<TicketsReportData> {
    if (filters.buildingIds && filters.buildingIds.length === 0) {
      return {
        byStatus: [],
        byPriority: [],
        topCategories: [],
        avgTimeToFirstResponseHours: 0,
        avgTimeToResolveHours: 0,
      };
    }

    const scopedBuildingIds = this.resolveScopedBuildingIds(filters);
    const whereBase: any = {
      tenantId,
    };

    if (scopedBuildingIds) {
      whereBase.buildingId = { in: scopedBuildingIds };
    }

    if (filters.from || filters.to) {
      whereBase.createdAt = {};
      if (filters.from) whereBase.createdAt.gte = filters.from;
      if (filters.to) whereBase.createdAt.lte = filters.to;
    }

    const tickets = await this.prisma.ticket.findMany({
      where: whereBase,
      include: {
        comments: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    // Group by status
    const statusMap = new Map<string, number>();
    tickets.forEach((t) => {
      statusMap.set(t.status, (statusMap.get(t.status) || 0) + 1);
    });
    const byStatus = Array.from(statusMap.entries()).map(([status, count]) => ({
      status,
      count,
    }));

    // Group by priority
    const priorityMap = new Map<string, number>();
    tickets.forEach((t) => {
      priorityMap.set(t.priority, (priorityMap.get(t.priority) || 0) + 1);
    });
    const byPriority = Array.from(priorityMap.entries()).map(
      ([priority, count]) => ({
        priority,
        count,
      })
    );

    // Group by category
    const categoryMap = new Map<string, number>();
    tickets.forEach((t) => {
      categoryMap.set(t.category, (categoryMap.get(t.category) || 0) + 1);
    });
    const topCategories = Array.from(categoryMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Calculate average times
    let totalResponseTime = 0;
    let ticketsWithResponse = 0;
    let totalResolveTime = 0;
    let ticketsWithResolution = 0;

    tickets.forEach((t) => {
      // Time to first response
      if (t.comments.length > 0) {
        const responseTime =
          t.comments[0]!.createdAt.getTime() - t.createdAt.getTime();
        totalResponseTime += responseTime;
        ticketsWithResponse++;
      }

      // Time to resolve (only if closed and has closedAt)
      if (t.closedAt) {
        const resolveTime = t.closedAt.getTime() - t.createdAt.getTime();
        totalResolveTime += resolveTime;
        ticketsWithResolution++;
      }
    });

    const avgTimeToFirstResponseHours =
      ticketsWithResponse > 0
        ? Math.round(totalResponseTime / ticketsWithResponse / 3600000)
        : 0;

    const avgTimeToResolveHours =
      ticketsWithResolution > 0
        ? Math.round(totalResolveTime / ticketsWithResolution / 3600000)
        : 0;

    return {
      byStatus,
      byPriority,
      topCategories,
      avgTimeToFirstResponseHours,
      avgTimeToResolveHours,
    };
  }

  /**
   * Get finance report with charge/payment totals and delinquent units
   * Uses same logic as finanzas.service.ts getBuildingFinancialSummary
   */
  async getFinanceReport(
    tenantId: string,
    filters: ReportFilters
  ): Promise<FinanceReportData> {
    if (filters.buildingIds && filters.buildingIds.length === 0) {
      return {
        totalCharges: 0,
        totalPaid: 0,
        totalOutstanding: 0,
        delinquentUnitsCount: 0,
        delinquentUnits: [],
        collectionRate: 0,
        currency: 'ARS',
      };
    }

    const scopedBuildingIds = this.resolveScopedBuildingIds(filters);
    const whereBase: any = {
      tenantId,
      canceledAt: null,
    };

    if (scopedBuildingIds) {
      whereBase.buildingId = { in: scopedBuildingIds };
    }

    if (filters.period) {
      whereBase.period = filters.period;
    }

    const charges = await this.prisma.charge.findMany({
      where: whereBase,
      include: {
        paymentAllocations: {
          include: {
            payment: {
              select: { status: true },
            },
          },
        },
      },
    });

    // Calculate totals using REAL allocations from APPROVED payments
    const totalCharges = charges.reduce((sum, c) => sum + c.amount, 0);

    const totalPaid = charges.reduce((sum, c) => {
      const allocated = c.paymentAllocations.reduce((asum, a) => {
        // Only count allocations from APPROVED payments
        return asum + (a.payment && a.payment.status === PaymentStatus.APPROVED ? a.amount : 0);
      }, 0);
      return sum + allocated;
    }, 0);

    const totalOutstanding = totalCharges - totalPaid;

    // Find delinquent units (filter by dueDate, not Charge.status)
    const now = new Date();
    const overdueCharges = charges.filter((c) => c.dueDate < now);

    const delinquentByUnit = new Map<string, number>();
    for (const charge of overdueCharges) {
      // Calculate real outstanding from APPROVED payments only
      const allocatedApproved = charge.paymentAllocations.reduce((sum, a) => {
        return sum + (a.payment && a.payment.status === PaymentStatus.APPROVED ? a.amount : 0);
      }, 0);
      const outstanding = charge.amount - allocatedApproved;

      // Only count if there's actual outstanding
      if (outstanding > 0) {
        delinquentByUnit.set(
          charge.unitId,
          (delinquentByUnit.get(charge.unitId) || 0) + outstanding
        );
      }
    }

    const delinquentUnitsCount = delinquentByUnit.size;
    const delinquentUnits = Array.from(delinquentByUnit.entries())
      .map(([unitId, outstanding]) => ({ unitId, outstanding }))
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10);

    const collectionRate =
      totalCharges > 0 ? Math.round((totalPaid / totalCharges) * 100) : 0;

    return {
      totalCharges,
      totalPaid,
      totalOutstanding,
      delinquentUnitsCount,
      delinquentUnits,
      collectionRate,
      currency: 'ARS',
    };
  }

  /**
   * Get communications report with read rates by channel
   */
  async getCommunicationsReport(
    tenantId: string,
    filters: ReportFilters
  ): Promise<CommunicationsReportData> {
    if (filters.buildingIds && filters.buildingIds.length === 0) {
      return {
        totalRecipients: 0,
        totalRead: 0,
        readRate: 0,
        byChannel: [],
      };
    }

    const scopedBuildingIds = this.resolveScopedBuildingIds(filters);
    const whereBase: any = {
      tenantId,
      status: 'SENT',
    };

    if (scopedBuildingIds) {
      whereBase.buildingId = { in: scopedBuildingIds };
    }

    if (filters.from || filters.to) {
      whereBase.sentAt = {};
      if (filters.from) whereBase.sentAt.gte = filters.from;
      if (filters.to) whereBase.sentAt.lte = filters.to;
    }

    const communications = await this.prisma.communication.findMany({
      where: whereBase,
      include: {
        receipts: {
          select: { readAt: true },
        },
      },
    });

    // Calculate totals
    const totalRecipients = communications.reduce(
      (sum, c) => sum + c.receipts.length,
      0
    );

    const totalRead = communications.reduce(
      (sum, c) =>
        sum + c.receipts.filter((r) => r.readAt !== null).length,
      0
    );

    const readRate =
      totalRecipients > 0 ? Math.round((totalRead / totalRecipients) * 100) : 0;

    // Group by channel
    const channelMap = new Map<string, { sent: number; read: number }>();
    communications.forEach((c) => {
      const readCount = c.receipts.filter((r) => r.readAt !== null).length;
      const existing = channelMap.get(c.channel) || { sent: 0, read: 0 };
      channelMap.set(c.channel, {
        sent: existing.sent + 1,
        read: existing.read + readCount,
      });
    });

    const byChannel: ChannelBreakdown[] = Array.from(channelMap.entries()).map(
      ([channel, { sent, read }]) => ({
        channel,
        sent,
        read,
        readRate: sent > 0 ? Math.round((read / sent) * 100) : 0,
      })
    );

    return {
      totalRecipients,
      totalRead,
      readRate,
      byChannel,
    };
  }

  /**
   * Get activity report with count of recent actions
   */
  async getActivityReport(
    tenantId: string,
    filters: ReportFilters
  ): Promise<ActivityReportData> {
    if (filters.buildingIds && filters.buildingIds.length === 0) {
      return {
        ticketsCreated: 0,
        paymentsSubmitted: 0,
        documentsUploaded: 0,
        communicationsSent: 0,
      };
    }

    const scopedBuildingIds = this.resolveScopedBuildingIds(filters);
    // Build date filter
    const dateFilter: any = {};
    if (filters.from) dateFilter.gte = filters.from;
    if (filters.to) dateFilter.lte = filters.to;
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    // Parallel queries
    const [ticketCount, paymentCount, documentCount, commCount] =
      await Promise.all([
        this.prisma.ticket.count({
          where: {
            tenantId,
            ...(scopedBuildingIds && { buildingId: { in: scopedBuildingIds } }),
            ...(hasDateFilter && { createdAt: dateFilter }),
          },
        }),
        this.prisma.payment.count({
          where: {
            tenantId,
            ...(scopedBuildingIds && { buildingId: { in: scopedBuildingIds } }),
            ...(hasDateFilter && { createdAt: dateFilter }),
          },
        }),
        this.prisma.document.count({
          where: {
            tenantId,
            ...(scopedBuildingIds && { buildingId: { in: scopedBuildingIds } }),
            ...(hasDateFilter && { createdAt: dateFilter }),
          },
        }),
        this.prisma.communication.count({
          where: {
            tenantId,
            status: 'SENT',
            ...(scopedBuildingIds && { buildingId: { in: scopedBuildingIds } }),
            ...(hasDateFilter && { sentAt: dateFilter }),
          },
        }),
      ]);

    return {
      ticketsCreated: ticketCount,
      paymentsSubmitted: paymentCount,
      documentsUploaded: documentCount,
      communicationsSent: commCount,
    };
  }

  /**
   * Export tickets to CSV format
   * Includes: id, title, status, priority, building, unit, createdAt, assignedTo
   */
  async exportTickets(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<CsvExportResult> {
    if (filters.buildingIds && filters.buildingIds.length === 0) {
      return CsvUtility.formatCsv(
        ['id', 'title', 'status', 'priority', 'building', 'unit', 'createdAt', 'category'],
        [],
        CsvUtility.generateFilename('tickets'),
      );
    }

    const scopedBuildingIds = this.resolveScopedBuildingIds(filters);
    const whereBase: any = { tenantId };
    if (scopedBuildingIds) whereBase.buildingId = { in: scopedBuildingIds };
    if (filters.from || filters.to) {
      whereBase.createdAt = {};
      if (filters.from) whereBase.createdAt.gte = filters.from;
      if (filters.to) whereBase.createdAt.lte = filters.to;
    }

    const tickets = await this.prisma.ticket.findMany({
      where: whereBase,
      include: {
        building: { select: { name: true } },
        unit: { select: { label: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = tickets.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      building: t.building.name,
      unit: t.unit?.label || 'N/A',
      createdAt: CsvUtility.formatDate(t.createdAt),
      category: t.category,
    }));

    return CsvUtility.formatCsv(
      ['id', 'title', 'status', 'priority', 'building', 'unit', 'createdAt', 'category'],
      rows,
      CsvUtility.generateFilename('tickets'),
    );
  }

  /**
   * Export finance report to CSV
   * Includes: building, totalCharges, totalPaid, outstanding, collectionRate, delinquent units list
   */
  async exportFinance(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<CsvExportResult> {
    // Get finance report data
    const report = await this.getFinanceReport(tenantId, filters);

    // Build rows with building + delinquent units
    const rows: any[] = [];

    // Row 1: Summary
    rows.push({
      type: 'SUMMARY',
      building: filters.buildingId ? 'Filtered' : 'All Buildings',
      totalCharges: CsvUtility.formatAmount(report.totalCharges),
      totalPaid: CsvUtility.formatAmount(report.totalPaid),
      outstanding: CsvUtility.formatAmount(report.totalOutstanding),
      collectionRate: `${report.collectionRate.toFixed(2)}%`,
      currency: report.currency,
    });

    // Rows 2+: Delinquent units
    for (const unit of report.delinquentUnits) {
      rows.push({
        type: 'DELINQUENT',
        building: '',
        totalCharges: '',
        totalPaid: '',
        outstanding: CsvUtility.formatAmount(unit.outstanding),
        collectionRate: '',
        currency: unit.unitId,
      });
    }

    return CsvUtility.formatCsv(
      ['type', 'building', 'totalCharges', 'totalPaid', 'outstanding', 'collectionRate', 'currency'],
      rows,
      CsvUtility.generateFilename('finance'),
    );
  }

  /**
   * Export payments to CSV
   * Includes: id, date, building, amount, status, reference
   * Note: This is for tenant payments (Phase 6), not SaaS payments
   */
  async exportPayments(
    tenantId: string,
    filters: ReportFilters & { status?: string },
  ): Promise<CsvExportResult> {
    if (filters.buildingIds && filters.buildingIds.length === 0) {
      return CsvUtility.formatCsv(
        ['id', 'date', 'building', 'amount', 'status', 'reference'],
        [],
        CsvUtility.generateFilename('payments'),
      );
    }

    const scopedBuildingIds = this.resolveScopedBuildingIds(filters);
    const whereBase: any = { tenantId };
    if (scopedBuildingIds) whereBase.buildingId = { in: scopedBuildingIds };
    if (filters.from || filters.to) {
      whereBase.createdAt = {};
      if (filters.from) whereBase.createdAt.gte = filters.from;
      if (filters.to) whereBase.createdAt.lte = filters.to;
    }
    if (filters.status) {
      whereBase.status = filters.status;
    }

    const payments = await this.prisma.payment.findMany({
      where: whereBase,
      include: {
        building: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = payments.map((p) => ({
      id: p.id,
      date: CsvUtility.formatDate(p.createdAt),
      building: p.building.name,
      amount: CsvUtility.formatAmount(p.amount),
      status: p.status,
      reference: p.reference || '',
    }));

    return CsvUtility.formatCsv(
      ['id', 'date', 'building', 'amount', 'status', 'reference'],
      rows,
      CsvUtility.generateFilename('payments'),
    );
  }

  /**
   * Load overdue charge snapshots with real outstanding and aging bucket.
   */
  private async getOverdueChargeSnapshots(
    tenantId: string,
    asOf: string,
    timezone: string,
    scopedBuildingIds?: string[],
  ): Promise<OverdueChargeSnapshot[]> {
    const asOfNextDayUtc = this.getAsOfNextDayUtc(asOf);
    const charges = (await this.prisma.charge.findMany({
      where: {
        tenantId,
        canceledAt: null,
        dueDate: { lt: asOfNextDayUtc },
        ...(scopedBuildingIds ? { buildingId: { in: scopedBuildingIds } } : {}),
      },
      select: {
        id: true,
        buildingId: true,
        period: true,
        amount: true,
        dueDate: true,
        unitId: true,
        building: {
          select: {
            id: true,
            name: true,
          },
        },
        unit: {
          select: {
            id: true,
            label: true,
            code: true,
          },
        },
        paymentAllocations: {
          select: {
            amount: true,
            payment: {
              select: {
                status: true,
              },
            },
          },
        },
      },
    })) as OverdueChargeProjection[];

    return charges
      .map((charge) => {
        const dueLocalDate = this.toLocalDate(charge.dueDate, timezone);
        if (dueLocalDate >= asOf) {
          return null;
        }

        const approvedAllocated = charge.paymentAllocations.reduce((sum, allocation) => {
          const status = allocation.payment?.status;
          if (status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) {
            return sum + allocation.amount;
          }
          return sum;
        }, 0);

        const outstanding = Math.max(0, charge.amount - approvedAllocated);
        if (outstanding <= 0) {
          return null;
        }

        const daysOverdue = this.diffCalendarDays(asOf, dueLocalDate);
        return {
          charge,
          allocatedPaid: approvedAllocated,
          outstanding,
          dueLocalDate,
          bucket: this.resolveBucket(daysOverdue),
        };
      })
      .filter((item): item is OverdueChargeSnapshot => item !== null);
  }

  /**
   * Resolve responsible and last payment maps for debt views.
   */
  private async resolveDebtUnitContext(
    tenantId: string,
    unitIds: string[],
    scopedBuildingIds?: string[],
  ): Promise<{
    occupantsByUnit: Map<string, DebtAgingRow['responsable']>;
    lastPaymentByUnit: Map<string, string | null>;
  }> {
    const [unitOccupants, directLastPayments, allocationLastPayments] = await Promise.all([
      this.prisma.unitOccupant.findMany({
        where: {
          tenantId,
          unitId: { in: unitIds },
          isPrimary: true,
          endDate: null,
        },
        select: {
          unitId: true,
          memberId: true,
          role: true,
          member: {
            select: { name: true },
          },
        },
      }),
      this.prisma.payment.groupBy({
        by: ['unitId'],
        where: {
          tenantId,
          unitId: { in: unitIds },
          status: { in: [PaymentStatus.APPROVED, PaymentStatus.RECONCILED] },
          paidAt: { not: null },
          ...(scopedBuildingIds ? { buildingId: { in: scopedBuildingIds } } : {}),
        },
        _max: {
          paidAt: true,
        },
      }),
      this.prisma.paymentAllocation.findMany({
        where: {
          tenantId,
          charge: {
            tenantId,
            unitId: { in: unitIds },
            ...(scopedBuildingIds ? { buildingId: { in: scopedBuildingIds } } : {}),
          },
          payment: {
            tenantId,
            status: { in: [PaymentStatus.APPROVED, PaymentStatus.RECONCILED] },
            paidAt: { not: null },
            ...(scopedBuildingIds ? { buildingId: { in: scopedBuildingIds } } : {}),
          },
        },
        select: {
          charge: { select: { unitId: true } },
          payment: { select: { paidAt: true } },
        },
      }),
    ]);

    const occupantsByUnit = this.groupOccupantsByUnit(
      unitOccupants.map((occupant) => ({
        unitId: occupant.unitId,
        memberId: occupant.memberId,
        role: occupant.role,
        name: occupant.member.name,
      })),
    );
    const lastPaymentByUnit = this.buildLastPaymentMap(
      unitIds,
      directLastPayments.map((row) => ({
        unitId: row.unitId,
        paidAt: row._max.paidAt,
      })),
      allocationLastPayments.map((row) => ({
        unitId: row.charge.unitId,
        paidAt: row.payment.paidAt,
      })),
    );

    return { occupantsByUnit, lastPaymentByUnit };
  }

  /**
   * Resolve effective building IDs from explicit filter or scoped list.
   */
  private resolveScopedBuildingIds(
    filters: Pick<ReportFilters, 'buildingId' | 'buildingIds'>,
  ): string[] | undefined {
    if (filters.buildingId) {
      return [filters.buildingId];
    }

    if (filters.buildingIds) {
      return filters.buildingIds;
    }

    return undefined;
  }

  /**
   * Build empty debt aging payload.
   */
  private buildEmptyDebtAging(asOf: string): DebtAgingResponseDto {
    return {
      asOf,
      totalOverdue: 0,
      unitsMorosas: 0,
      buckets: {
        '0_30': 0,
        '31_60': 0,
        '61_90': 0,
        '90_plus': 0,
      },
      worstCase: null,
      rowsByUnit: [],
    };
  }

  /**
   * Convert local date string (YYYY-MM-DD) into next day UTC boundary.
   */
  private getAsOfNextDayUtc(asOf: string): Date {
    const [yearRaw, monthRaw, dayRaw] = asOf.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);

    return new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  }

  /**
   * Format date as YYYY-MM-DD in tenant timezone.
   */
  private toLocalDate(value: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }

  /**
   * Difference in calendar days between two local dates in YYYY-MM-DD.
   */
  private diffCalendarDays(asOf: string, dueDate: string): number {
    const [asOfYear, asOfMonth, asOfDay] = this.parseLocalDate(asOf);
    const [dueYear, dueMonth, dueDay] = this.parseLocalDate(dueDate);

    const asOfUtc = Date.UTC(asOfYear, asOfMonth - 1, asOfDay);
    const dueUtc = Date.UTC(dueYear, dueMonth - 1, dueDay);
    return Math.floor((asOfUtc - dueUtc) / 86_400_000);
  }

  /**
   * Parse YYYY-MM-DD to numeric tuple.
   */
  private parseLocalDate(value: string): [number, number, number] {
    const [yearRaw = '0', monthRaw = '0', dayRaw = '0'] = value.split('-');
    return [Number(yearRaw), Number(monthRaw), Number(dayRaw)];
  }

  /**
   * Resolve aging bucket by overdue days.
   */
  private resolveBucket(daysOverdue: number): keyof DebtAgingBuckets {
    if (daysOverdue <= 30) {
      return '0_30';
    }
    if (daysOverdue <= 60) {
      return '31_60';
    }
    if (daysOverdue <= 90) {
      return '61_90';
    }
    return '90_plus';
  }

  /**
   * Build unit label with building + unit info.
   */
  private buildUnitLabel(
    buildingName: string,
    unit: OverdueChargeProjection['unit'],
  ): string {
    const unitCode = unit.label || unit.code || unit.id;
    return `${buildingName} • ${unitCode}`;
  }

  /**
   * Group primary occupants by unit, prioritizing OWNER over RESIDENT.
   */
  private groupOccupantsByUnit(
    occupants: OccupantProjection[],
  ): Map<string, DebtAgingRow['responsable']> {
    const grouped = new Map<string, OccupantProjection[]>();
    for (const occupant of occupants) {
      const current = grouped.get(occupant.unitId) || [];
      current.push(occupant);
      grouped.set(occupant.unitId, current);
    }

    const result = new Map<string, DebtAgingRow['responsable']>();
    for (const [unitId, rows] of grouped.entries()) {
      const selected = [...rows].sort((a, b) => {
        const aWeight = a.role === UnitOccupantRole.OWNER ? 0 : 1;
        const bWeight = b.role === UnitOccupantRole.OWNER ? 0 : 1;
        return aWeight - bWeight;
      })[0];

      if (selected) {
        result.set(unitId, {
          memberId: selected.memberId,
          name: selected.name,
          role: selected.role,
        });
      }
    }

    return result;
  }

  /**
   * Build a per-unit last payment map using direct unit payments + allocation fallback.
   */
  private buildLastPaymentMap(
    unitIds: string[],
    direct: Array<{ unitId: string | null; paidAt: Date | null }>,
    allocationFallback: Array<{ unitId: string; paidAt: Date | null }>,
  ): Map<string, string | null> {
    const paidAtByUnit = new Map<string, Date>();

    for (const row of direct) {
      if (!row.unitId || !row.paidAt) {
        continue;
      }
      const current = paidAtByUnit.get(row.unitId);
      if (!current || row.paidAt > current) {
        paidAtByUnit.set(row.unitId, row.paidAt);
      }
    }

    for (const row of allocationFallback) {
      if (!row.paidAt) {
        continue;
      }
      const current = paidAtByUnit.get(row.unitId);
      if (!current || row.paidAt > current) {
        paidAtByUnit.set(row.unitId, row.paidAt);
      }
    }

    const result = new Map<string, string | null>();
    for (const unitId of unitIds) {
      result.set(unitId, paidAtByUnit.get(unitId)?.toISOString() || null);
    }
    return result;
  }

  /**
   * Determine dominant bucket by amount. Ties are resolved by oldest unpaid bucket.
   */
  private resolveDominantBucket(unit: UnitDebtAccumulator): keyof DebtAgingBuckets {
    const orderedBuckets: Array<keyof DebtAgingBuckets> = [
      '0_30',
      '31_60',
      '61_90',
      '90_plus',
    ];

    let dominant: keyof DebtAgingBuckets = unit.oldestBucket;
    let maxAmount = -1;

    for (const bucket of orderedBuckets) {
      const value = unit.bucketAmounts[bucket];
      if (value > maxAmount) {
        maxAmount = value;
        dominant = bucket;
      } else if (value === maxAmount && bucket === unit.oldestBucket) {
        dominant = bucket;
      }
    }

    return dominant;
  }
}

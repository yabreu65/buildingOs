import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChargeStatus, PaymentStatus, Prisma } from '@prisma/client';
import { CsvUtility, CsvExportResult } from './csv.utility';
import { calculateChargeOutstandingMinor } from '../finanzas/charge-aggregation';
import {
  aggregateReportBuckets,
  compareReportCurrencies,
  type ReportCurrencyAmountBucket,
  type ReportCurrencyInput,
} from '../finanzas/currency-buckets';

export interface ReportFilters {
  buildingId?: string;
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
  tickets: Array<{
    id: string;
    title: string;
    description: string;
    createdAt: Date;
    status: string;
    priority: string;
    category: string;
    buildingId: string;
    building: { id: string; name: string };
    unitId: string | null;
    unit: { id: string; label: string | null; code: string } | null;
  }>;
}

export interface DelinquentUnit {
  unitId: string;
  outstandingByCurrency: ReportCurrencyAmountBucket[];
}

export interface CollectionRateBucket {
  readonly currency: string;
  readonly rate: number;
}

export interface FinanceReportData {
  totalChargesByCurrency: ReportCurrencyAmountBucket[];
  totalPaidByCurrency: ReportCurrencyAmountBucket[];
  totalOutstandingByCurrency: ReportCurrencyAmountBucket[];
  collectionRateByCurrency: CollectionRateBucket[];
  delinquentUnitsCount: number;
  delinquentUnits: DelinquentUnit[];
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
   * Get tickets report with aggregations by status, priority, category
   * Calculates average response and resolution times
   */
  async getTicketsReport(
    tenantId: string,
    filters: ReportFilters
  ): Promise<TicketsReportData> {
    const whereBase: Prisma.TicketWhereInput = {
      tenantId,
    };

    if (filters.buildingId) {
      whereBase.buildingId = filters.buildingId;
    }

    if (filters.from || filters.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.from) createdAt.gte = filters.from;
      if (filters.to) createdAt.lte = filters.to;
      whereBase.createdAt = createdAt;
    }

    const tickets = await this.prisma.ticket.findMany({
      where: whereBase,
      orderBy: { createdAt: 'desc' },
      include: {
        building: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true, code: true } },
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
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        createdAt: ticket.createdAt,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        buildingId: ticket.buildingId,
        building: ticket.building,
        unitId: ticket.unitId,
        unit: ticket.unit,
      })),
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
    const whereBase: Prisma.ChargeWhereInput = {
      tenantId,
      canceledAt: null,
    };

    if (filters.buildingId) {
      whereBase.buildingId = filters.buildingId;
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

    // Currency-safe aggregation (charge-side, integer minor units).
    // Per charge:
    // - outstanding = charge.amount - effective allocations (clamped >= 0)
    //   (effective = APPROVED | RECONCILED; SUBMITTED never reduces outstanding)
    // - paid = charge.amount - outstanding (bounded: never exceeds charge.amount)
    // Buckets are grouped by currency; currencies are never mixed or
    // converted. Canonical currencies (USD/VES/ARS/COP) come first in
    // canonical order; any historical legacy currency is reported in its
    // own explicit bucket after canonical ones, in stable lexicographic
    // order — no fallback, no loss, no write-side change.
    const totalsByCurrency = new Map<string, { charges: number; paid: number; outstanding: number }>();
    const delinquentByUnit = new Map<string, ReportCurrencyInput[]>();
    const delinquentEarliestDue = new Map<string, Date>();
    const now = new Date();

    for (const charge of charges) {
      const outstanding = calculateChargeOutstandingMinor(charge);
      const paid = charge.amount - outstanding;

      const acc = totalsByCurrency.get(charge.currency) ?? {
        charges: 0,
        paid: 0,
        outstanding: 0,
      };
      acc.charges += charge.amount;
      acc.paid += paid;
      acc.outstanding += outstanding;
      totalsByCurrency.set(charge.currency, acc);

      if (charge.dueDate < now && outstanding > 0) {
        const entries = delinquentByUnit.get(charge.unitId) ?? [];
        entries.push({ currency: charge.currency, amountMinor: outstanding });
        delinquentByUnit.set(charge.unitId, entries);

        const earliest = delinquentEarliestDue.get(charge.unitId);
        if (!earliest || charge.dueDate < earliest) {
          delinquentEarliestDue.set(charge.unitId, charge.dueDate);
        }
      }
    }

    const totalChargesByCurrency = aggregateReportBuckets(
      Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
        currency,
        amountMinor: acc.charges,
      })),
    );
    const totalPaidByCurrency = aggregateReportBuckets(
      Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
        currency,
        amountMinor: acc.paid,
      })),
    );
    const totalOutstandingByCurrency = aggregateReportBuckets(
      Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
        currency,
        amountMinor: acc.outstanding,
      })),
    );

    const collectionRateByCurrency = Array.from(totalsByCurrency.entries())
      .map(([currency, acc]) => ({
        currency,
        rate: acc.charges > 0 ? Math.round((acc.paid / acc.charges) * 100) : 0,
      }))
      .sort((a, b) => compareReportCurrencies(a.currency, b.currency));

    // Delinquent units: dueDate < now with positive outstanding in at least
    // one currency. Ordered by earliest delinquency (dueDate ASC), then by
    // unitId ASC for determinism. This is a NON-monetary ordering: amounts
    // in different currencies are never compared or summed. Top 10.
    const delinquentUnitsCount = delinquentByUnit.size;

    const delinquentUnits = Array.from(delinquentByUnit.entries())
      .map(([unitId, entries]) => ({
        unitId,
        outstandingByCurrency: aggregateReportBuckets(entries),
      }))
      .sort((a, b) => {
        const dueDiff =
          delinquentEarliestDue.get(a.unitId)!.getTime() -
          delinquentEarliestDue.get(b.unitId)!.getTime();
        if (dueDiff !== 0) return dueDiff;
        return a.unitId.localeCompare(b.unitId);
      })
      .slice(0, 10);

    return {
      totalChargesByCurrency,
      totalPaidByCurrency,
      totalOutstandingByCurrency,
      collectionRateByCurrency,
      delinquentUnitsCount,
      delinquentUnits,
    };
  }

  /**
   * Get communications report with read rates by channel
   */
  async getCommunicationsReport(
    tenantId: string,
    filters: ReportFilters
  ): Promise<CommunicationsReportData> {
    const whereBase: Prisma.CommunicationWhereInput = {
      tenantId,
      status: 'SENT',
    };

    if (filters.buildingId) {
      whereBase.buildingId = filters.buildingId;
    }

    if (filters.from || filters.to) {
      const sentAt: Prisma.DateTimeFilter = {};
      if (filters.from) sentAt.gte = filters.from;
      if (filters.to) sentAt.lte = filters.to;
      whereBase.sentAt = sentAt;
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
    // Build date filter
    const dateFilter: Prisma.DateTimeFilter = {};
    if (filters.from) dateFilter.gte = filters.from;
    if (filters.to) dateFilter.lte = filters.to;
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    // Parallel queries
    const [ticketCount, paymentCount, documentCount, commCount] =
      await Promise.all([
        this.prisma.ticket.count({
          where: {
            tenantId,
            ...(filters.buildingId && { buildingId: filters.buildingId }),
            ...(hasDateFilter && { createdAt: dateFilter }),
          },
        }),
        this.prisma.payment.count({
          where: {
            tenantId,
            ...(filters.buildingId && { buildingId: filters.buildingId }),
            ...(hasDateFilter && { createdAt: dateFilter }),
          },
        }),
        this.prisma.document.count({
          where: {
            tenantId,
            ...(filters.buildingId && { buildingId: filters.buildingId }),
            ...(hasDateFilter && { createdAt: dateFilter }),
          },
        }),
        this.prisma.communication.count({
          where: {
            tenantId,
            status: 'SENT',
            ...(filters.buildingId && { buildingId: filters.buildingId }),
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
    const whereBase: Prisma.TicketWhereInput = { tenantId };
    if (filters.buildingId) whereBase.buildingId = filters.buildingId;
    if (filters.from || filters.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.from) createdAt.gte = filters.from;
      if (filters.to) createdAt.lte = filters.to;
      whereBase.createdAt = createdAt;
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
   * Includes one SUMMARY row per currency (never mixed) and one DELINQUENT
   * row per (unit, currency) pair. Amounts use major units (cents / 100),
   * preserving the existing CSV format.
   *
   * Column order keeps the seven historical columns
   * (type,building,totalCharges,totalPaid,outstanding,collectionRate,currency)
   * EXACTLY in their original positions and appends `unit` as the eighth
   * column, minimizing positional breakage for existing consumers.
   */
  async exportFinance(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<CsvExportResult> {
    // Get finance report data
    const report = await this.getFinanceReport(tenantId, filters);

    const rows: Array<{
      type: string;
      building: string;
      totalCharges: string;
      totalPaid: string;
      outstanding: string;
      collectionRate: string;
      currency: string;
      unit: string;
    }> = [];

    // Summary rows: one per currency with that currency's own totals
    for (const bucket of report.totalChargesByCurrency) {
      const paid = report.totalPaidByCurrency.find((b) => b.currency === bucket.currency);
      const outstanding = report.totalOutstandingByCurrency.find(
        (b) => b.currency === bucket.currency,
      );
      const rate = report.collectionRateByCurrency.find((b) => b.currency === bucket.currency);
      rows.push({
        type: 'SUMMARY',
        building: filters.buildingId ? 'Filtered' : 'All Buildings',
        totalCharges: CsvUtility.formatAmount(bucket.amountMinor),
        totalPaid: CsvUtility.formatAmount(paid?.amountMinor ?? 0),
        outstanding: CsvUtility.formatAmount(outstanding?.amountMinor ?? 0),
        collectionRate: `${(rate?.rate ?? 0).toFixed(2)}%`,
        currency: bucket.currency,
        unit: '',
      });
    }

    // Delinquent unit rows: one per (unit, currency) — single-currency amounts
    for (const unit of report.delinquentUnits) {
      for (const bucket of unit.outstandingByCurrency) {
        rows.push({
          type: 'DELINQUENT',
          building: '',
          totalCharges: '',
          totalPaid: '',
          outstanding: CsvUtility.formatAmount(bucket.amountMinor),
          collectionRate: '',
          currency: bucket.currency,
          unit: unit.unitId,
        });
      }
    }

    return CsvUtility.formatCsv(
      [
        'type',
        'building',
        'totalCharges',
        'totalPaid',
        'outstanding',
        'collectionRate',
        'currency',
        'unit',
      ],
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
    const whereBase: Prisma.PaymentWhereInput = { tenantId };
    if (filters.buildingId) whereBase.buildingId = filters.buildingId;
    if (filters.from || filters.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.from) createdAt.gte = filters.from;
      if (filters.to) createdAt.lte = filters.to;
      whereBase.createdAt = createdAt;
    }
    if (filters.status) {
      whereBase.status = filters.status as PaymentStatus;
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
}

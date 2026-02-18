import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChargeStatus, PaymentStatus } from '@prisma/client';
import { CsvUtility, CsvExportResult } from './csv.utility';

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
    const whereBase: any = {
      tenantId,
    };

    if (filters.buildingId) {
      whereBase.buildingId = filters.buildingId;
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
          t.comments[0].createdAt.getTime() - t.createdAt.getTime();
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
    const whereBase: any = {
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

    // Calculate totals
    const totalCharges = charges.reduce((sum, c) => sum + c.amount, 0);

    const totalPaid = charges.reduce((sum, c) => {
      const allocated = c.paymentAllocations.reduce((asum, a) => {
        // Only count allocations from APPROVED payments
        return asum + (a.payment && a.payment.status === PaymentStatus.APPROVED ? a.amount : 0);
      }, 0);
      return sum + allocated;
    }, 0);

    const totalOutstanding = totalCharges - totalPaid;

    // Find delinquent units
    const now = new Date();
    const delinquentCharges = charges.filter(
      (c) =>
        (c.status === ChargeStatus.PENDING || c.status === ChargeStatus.PARTIAL) &&
        c.dueDate < now
    );

    const delinquentByUnit = new Map<string, number>();
    for (const charge of delinquentCharges) {
      const allocated = charge.paymentAllocations.reduce((sum, a) => {
        return sum + (a.payment ? a.amount : 0);
      }, 0);
      const outstanding = charge.amount - allocated;
      delinquentByUnit.set(
        charge.unitId,
        (delinquentByUnit.get(charge.unitId) || 0) + outstanding
      );
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
    const whereBase: any = {
      tenantId,
      status: 'SENT',
    };

    if (filters.buildingId) {
      whereBase.buildingId = filters.buildingId;
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
    const whereBase: any = { tenantId };
    if (filters.buildingId) whereBase.buildingId = filters.buildingId;
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
    const whereBase: any = { tenantId };
    if (filters.buildingId) whereBase.buildingId = filters.buildingId;
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
}

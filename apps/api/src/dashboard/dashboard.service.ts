import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DashboardSummaryDto,
  DashboardQueryDto,
  DashboardPeriod,
  DashboardKpis,
  DashboardQueues,
  TicketSummary,
  PaymentToValidateSummary,
  UnitWithoutResponsibleSummary,
  BuildingAlert,
} from './dashboard.dto';
import { PaymentStatus, TicketStatus, Prisma } from '@prisma/client';
import { getPeriodsBetweenDates } from '../shared/finance/period.utils';

interface UnitWithOccupants extends Prisma.UnitGetPayload<{
  include: { unitOccupants: true; building: { select: { name: true } } };
}> {}

interface UnitOccupant {
  readonly isPrimary: boolean;
  readonly endDate: Date | null;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get admin dashboard summary for the given tenant and period.
   *
   * @param tenantId - Tenant identifier
   * @param query - Period and optional building filter
   */
  async getSummary(
    tenantId: string,
    query: DashboardQueryDto,
  ): Promise<DashboardSummaryDto> {
    const startTime = Date.now();
    const { period, periodMonth, buildingId } = query;
    const now = new Date();
    const resolvedPeriod = this.resolvePeriodWindow(period, periodMonth, now);

    try {
      // Build building filter
      const buildingWhere = buildingId
        ? { id: buildingId, tenantId }
        : { tenantId };

      // Get buildings for this tenant
      const buildings = await this.prisma.building.findMany({
        where: buildingWhere,
        select: { id: true, name: true },
      });
      const buildingIds = buildings.map((b) => b.id);
      const buildingMap = new Map(buildings.map((b) => [b.id, b.name]));

      // Calculate KPIs
      const kpis = await this.calculateKpis(
        tenantId,
        buildingIds,
        resolvedPeriod.businessPeriods,
        resolvedPeriod.startDate,
        resolvedPeriod.endDate,
      );

      // Calculate queues
      const queues = await this.calculateQueues(
        tenantId,
        buildingIds,
        resolvedPeriod.startDate,
        resolvedPeriod.endDate,
      );

      // Calculate building alerts
      const buildingAlerts = await this.calculateBuildingAlerts(
        tenantId,
        buildingIds,
        buildingMap,
      );

      // Quick actions based on permissions
      const quickActions = this.getQuickActions();

      const duration = Date.now() - startTime;
      this.logger.log(`Dashboard summary generated for tenant ${tenantId} in ${duration}ms`);

      return {
        kpis,
        queues,
        buildingAlerts,
        quickActions,
        metadata: {
          period: resolvedPeriod.metadataPeriod,
          periodMonth: resolvedPeriod.periodMonth,
          buildingId: buildingId || null,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate dashboard summary for tenant ${tenantId}: ${message}`);
      // Rethrow Prisma errors as-is; wrap generic errors
      if (error instanceof Error && error.name.startsWith('Prisma')) {
        throw error;
      }
      throw new InternalServerErrorException(`Dashboard generation failed: ${message}`);
    }
  }

  private getPeriodDates(
    period: DashboardPeriod | undefined,
    now: Date,
  ): { startDate: Date; endDate: Date } {
    const year = now.getFullYear();
    const month = now.getMonth();

    switch (period) {
      case DashboardPeriod.CURRENT_MONTH:
        return {
          startDate: new Date(year, month, 1),
          endDate: new Date(year, month + 1, 0, 23, 59, 59),
        };
      case DashboardPeriod.PREVIOUS_MONTH:
        return {
          startDate: new Date(year, month - 1, 1),
          endDate: new Date(year, month, 0, 23, 59, 59),
        };
      case DashboardPeriod.LAST_30_DAYS:
        return {
          startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          endDate: now,
        };
      default:
        return {
          startDate: new Date(year, month, 1),
          endDate: new Date(year, month + 1, 0, 23, 59, 59),
        };
    }
  }

  /**
   * Resolve period window from legacy enum or explicit periodMonth.
   */
  private resolvePeriodWindow(
    period: DashboardPeriod | undefined,
    periodMonth: string | undefined,
    now: Date,
  ): {
    startDate: Date;
    endDate: Date;
    businessPeriods: string[];
    metadataPeriod: string;
    periodMonth: string | null;
  } {
    if (periodMonth) {
      const [yearRaw, monthRaw] = periodMonth.split('-');
      const year = Number(yearRaw);
      const month = Number(monthRaw);

      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      return {
        startDate,
        endDate,
        businessPeriods: [periodMonth],
        metadataPeriod: periodMonth,
        periodMonth,
      };
    }

    const selectedPeriod = period || DashboardPeriod.CURRENT_MONTH;
    const { startDate, endDate } = this.getPeriodDates(selectedPeriod, now);

    return {
      startDate,
      endDate,
      businessPeriods: getPeriodsBetweenDates(startDate, endDate),
      metadataPeriod: selectedPeriod,
      periodMonth: null,
    };
  }

  private async calculateKpis(
    tenantId: string,
    buildingIds: string[],
    periods: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<DashboardKpis> {
    if (buildingIds.length === 0) {
      return {
        outstandingAmount: 0,
        collectedAmount: 0,
        collectionRate: 0,
        delinquentUnits: 0,
      };
    }

    // Get charges for the period
    const charges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        period: periods.length === 1 ? periods[0] : { in: periods },
        canceledAt: null,
      },
      include: {
        paymentAllocations: {
          include: { payment: true },
        },
      },
    });

    // Calculate outstanding amount using REAL allocations from APPROVED/RECONCILED payments
    // Debt is determined by actual paid allocations, NOT by Charge.status
    const chargesWithOutstanding = charges.map((charge) => {
      const approvedAllocated = charge.paymentAllocations.reduce((aSum, a) => {
        const status = a.payment?.status;
        if (status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) {
          return aSum + a.amount;
        }
        return aSum;
      }, 0);
      return {
        charge,
        allocated: approvedAllocated,
        outstanding: Math.max(0, charge.amount - approvedAllocated),
      };
    }).filter((item) => item.outstanding > 0);

    const outstandingAmount = chargesWithOutstanding.reduce((sum, item) => sum + item.outstanding, 0);

    // Calculate collected amount (from APPROVED payments in period)
    const collectedAmount = await this.prisma.payment.aggregate({
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        status: {
          in: [PaymentStatus.APPROVED, PaymentStatus.RECONCILED],
        },
        paidAt: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    });

    // Total charges emitted in period
    const totalChargesEmitted = charges.reduce((sum, c) => sum + c.amount, 0);

    // Collection rate
    const collected = collectedAmount._sum.amount || 0;
    const collectionRate = totalChargesEmitted > 0 ? collected / totalChargesEmitted : 0;

    // Delinquent units (units with outstanding > 0) - use precalculated chargesWithOutstanding
    const delinquentUnitsMap = new Map<string, number>();
    for (const item of chargesWithOutstanding) {
      delinquentUnitsMap.set(
        item.charge.unitId,
        (delinquentUnitsMap.get(item.charge.unitId) || 0) + item.outstanding,
      );
    }

    return {
      outstandingAmount,
      collectedAmount: collected,
      collectionRate: Math.round(collectionRate * 1000) / 1000,
      delinquentUnits: delinquentUnitsMap.size,
    };
  }

  private async calculateQueues(
    tenantId: string,
    buildingIds: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<DashboardQueues> {
    // Tickets queue - count by status
    const openTickets = await this.prisma.ticket.count({
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        status: TicketStatus.OPEN,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    const inProgressTickets = await this.prisma.ticket.count({
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        status: TicketStatus.IN_PROGRESS,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    const closedTickets = await this.prisma.ticket.count({
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        closedAt: { gte: startDate, lte: endDate },
      },
    });

    // Get top 5 tickets (oldest open/in-progress)
    const topTickets = await this.prisma.ticket.findMany({
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });

    // Fill building names for tickets
    const ticketBuildingIds = [...new Set(topTickets.map((t) => t.buildingId))];
    const ticketBuildings = await this.prisma.building.findMany({
      where: { tenantId, id: { in: ticketBuildingIds } },
      select: { id: true, name: true },
    });
    const ticketBuildingMap = new Map(ticketBuildings.map((b) => [b.id, b.name]));

    const ticketSummaries: TicketSummary[] = topTickets.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      buildingId: t.buildingId,
      buildingName: ticketBuildingMap.get(t.buildingId) || '',
      createdAt: t.createdAt.toISOString(),
    }));

    // Payments to validate queue (SUBMITTED status = pending validation)
    const pendingPaymentsWhere = {
      tenantId,
      status: PaymentStatus.SUBMITTED,
      buildingId: { in: buildingIds },
    };
    const [pendingPaymentsCount, pendingPayments] = await Promise.all([
      this.prisma.payment.count({ where: pendingPaymentsWhere }),
      this.prisma.payment.findMany({
        where: pendingPaymentsWhere,
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          unit: {
            select: { label: true, building: { select: { name: true } } },
          },
        },
      }),
    ]);

    const paymentSummaries: PaymentToValidateSummary[] = pendingPayments.map((p) => ({
      id: p.id,
      unitLabel: p.unit?.label || '-',
      buildingName: p.unit?.building?.name || '-',
      amount: p.amount,
      submittedAt: p.createdAt.toISOString(),
    }));

    // Units without primary occupant
    const units: UnitWithOccupants[] = await this.prisma.unit.findMany({
      where: { building: { tenantId }, buildingId: { in: buildingIds } },
      include: {
        building: { select: { name: true } },
        unitOccupants: true,
      },
    });

    const unitsWithoutResponsible: UnitWithoutResponsibleSummary[] = [];

    for (const unit of units) {
      const hasPrimaryOccupant =
        unit.unitOccupants &&
        unit.unitOccupants.some((o) => o.isPrimary === true && o.endDate === null);
      if (!hasPrimaryOccupant) {
        unitsWithoutResponsible.push({
          unitId: unit.id,
          unitLabel: unit.label || unit.id,
          buildingId: unit.buildingId,
          buildingName: unit.building?.name || '',
        });
      }
    }

    return {
      tickets: {
        open: openTickets,
        inProgress: inProgressTickets,
        closed: closedTickets,
        overdue: 0,
        top: ticketSummaries,
      },
      paymentsToValidate: {
        count: pendingPaymentsCount,
        top: paymentSummaries,
      },
      unitsWithoutResponsible: {
        count: unitsWithoutResponsible.length,
        top: unitsWithoutResponsible.slice(0, 5),
      },
    };
  }

  private async calculateBuildingAlerts(
    tenantId: string,
    buildingIds: string[],
    buildingMap: Map<string, string>,
  ): Promise<BuildingAlert[]> {
    const [allCharges, allTickets, allUnits] = await Promise.all([
      this.prisma.charge.findMany({
        where: {
          tenantId,
          buildingId: { in: buildingIds },
          canceledAt: null,
          // Don't filter by status - calculate real outstanding from allocations
        },
        include: { paymentAllocations: { include: { payment: true } } },
      }),
      this.prisma.ticket.groupBy({
        by: ['buildingId'],
        where: {
          tenantId,
          buildingId: { in: buildingIds },
          status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        },
        _count: { id: true },
      }),
      this.prisma.unit.findMany({
        where: { building: { tenantId }, buildingId: { in: buildingIds } },
        include: { unitOccupants: true },
      }),
    ]);

    const chargesByBuilding = new Map<string, typeof allCharges>();
    for (const charge of allCharges) {
      const existing = chargesByBuilding.get(charge.buildingId) || [];
      existing.push(charge);
      chargesByBuilding.set(charge.buildingId, existing);
    }

    const ticketsByBuilding = new Map<string, number>();
    for (const ticket of allTickets) {
      ticketsByBuilding.set(ticket.buildingId, ticket._count.id);
    }

    const unitsByBuilding = new Map<string, Array<Prisma.UnitGetPayload<{ include: { unitOccupants: true } }>>>();
    for (const unit of allUnits) {
      const existing = unitsByBuilding.get(unit.buildingId) || [];
      existing.push(unit);
      unitsByBuilding.set(unit.buildingId, existing);
    }

    const alerts: BuildingAlert[] = [];

    for (const buildingId of buildingIds) {
      const charges = chargesByBuilding.get(buildingId) || [];
      const outstandingAmount = charges.reduce((sum, charge) => {
        const allocated = charge.paymentAllocations.reduce((aSum, a) => {
          const status = a.payment?.status;
          return aSum + ((status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) ? a.amount : 0);
        }, 0);
        return sum + (charge.amount - allocated);
      }, 0);

      const openTickets = ticketsByBuilding.get(buildingId) || 0;

      const units = unitsByBuilding.get(buildingId) || [];
      const unitsWithoutResponsible = units.filter(
        (u) => !u.unitOccupants || !u.unitOccupants.some((o: UnitOccupant) => o.isPrimary === true && o.endDate === null),
      ).length;

      let riskScore: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (outstandingAmount > 1000000 || openTickets > 3 || unitsWithoutResponsible > 5) {
        riskScore = 'HIGH';
      } else if (outstandingAmount > 500000 || openTickets > 1 || unitsWithoutResponsible > 2) {
        riskScore = 'MEDIUM';
      }

      if (outstandingAmount > 0 || openTickets > 0 || unitsWithoutResponsible > 0) {
        alerts.push({
          buildingId,
          buildingName: buildingMap.get(buildingId) || '',
          outstandingAmount,
          overdueTickets: openTickets,
          unitsWithoutResponsible,
          riskScore,
        });
      }
    }

    const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return alerts.sort((a, b) => riskOrder[a.riskScore] - riskOrder[b.riskScore]);
  }

  /**
   * Get available quick actions for the admin dashboard.
   * Actual permission checks occur at the endpoint level.
   * @returns Array of available quick action identifiers
   */
  private getQuickActions(): string[] {
    return [
      'CREATE_CHARGE',
      'RECORD_PAYMENT',
      'INVITE_RESIDENT',
      'CREATE_TICKET',
      'SEND_ANNOUNCEMENT',
    ];
  }
}

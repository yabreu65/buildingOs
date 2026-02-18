import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  InboxSummaryResponse,
  TicketSummary,
  PaymentSummary,
  CommunicationSummary,
  AlertSummary,
  DelinquentUnit,
} from './inbox.types';

@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get unified inbox summary for user in tenant
   *
   * Aggregates:
   * - Pending tickets (OPEN + IN_PROGRESS)
   * - Pending payments (SUBMITTED)
   * - Draft/Scheduled communications
   * - Alerts (urgent unassigned tickets, delinquent units)
   *
   * All filtered by user's accessible buildings (via scoped roles)
   */
  async getInboxSummary(
    userId: string,
    tenantId: string,
    buildingIdFilter?: string | null,
    limit: number = 20,
  ): Promise<InboxSummaryResponse> {
    // Step 1: Get accessible building IDs for user
    const accessibleBuildingIds = await this.getAccessibleBuildingIds(userId, tenantId);

    // Filter by selected building if provided
    const buildingIds = buildingIdFilter
      ? accessibleBuildingIds.filter((id) => id === buildingIdFilter)
      : accessibleBuildingIds;

    if (buildingIds.length === 0) {
      return {
        tickets: [],
        payments: [],
        communications: [],
        alerts: { urgentUnassignedTicketsCount: 0, delinquentUnitsTop: [] },
      };
    }

    // Fetch all data in parallel
    const [tickets, payments, communications, alerts] = await Promise.all([
      this.getTicketSummary(tenantId, buildingIds, limit),
      this.getPaymentSummary(tenantId, buildingIds, limit),
      this.getCommunicationSummary(tenantId, buildingIds, limit),
      this.getAlertSummary(tenantId, buildingIds),
    ]);

    return {
      tickets,
      payments,
      communications,
      alerts,
    };
  }

  /**
   * Get building IDs accessible by user based on roles
   *
   * Logic:
   * - If TENANT-scoped role: all buildings in tenant
   * - If BUILDING-scoped role: only those buildings
   * - Combine both sets (user can have both types)
   */
  private async getAccessibleBuildingIds(
    userId: string,
    tenantId: string,
  ): Promise<string[]> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { roles: true },
    });

    if (!membership) {
      return [];
    }

    const roles = membership.roles || [];

    // Check TENANT-scoped roles
    const hasTenantScope = roles.some((r) => r.scopeType === 'TENANT');
    if (hasTenantScope) {
      // User has tenant-wide access: return all buildings
      const buildings = await this.prisma.building.findMany({
        where: { tenantId },
        select: { id: true },
      });
      return buildings.map((b) => b.id);
    }

    // Get BUILDING-scoped building IDs
    const buildingScopedRoles = roles.filter((r) => r.scopeType === 'BUILDING');
    const buildingIds = buildingScopedRoles
      .map((r) => r.scopeBuildingId)
      .filter((id): id is string => id !== null);

    return buildingIds;
  }

  /**
   * Get pending tickets (OPEN + IN_PROGRESS)
   * Sorted by priority (HIGH/URGENT first) then by createdAt (newest first)
   */
  private async getTicketSummary(
    tenantId: string,
    buildingIds: string[],
    limit: number,
  ): Promise<TicketSummary[]> {
    const tickets = await this.prisma.ticket.findMany({
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
      include: {
        building: true,
        unit: true,
      },
      orderBy: [
        { priority: 'desc' }, // HIGH/URGENT first (alphabetically)
        { createdAt: 'desc' }, // Newest first
      ],
      take: limit,
    });

    return tickets.map((t) => ({
      id: t.id,
      buildingId: t.buildingId,
      buildingName: t.building.name,
      unitCode: t.unit?.code,
      title: t.title,
      priority: t.priority,
      status: t.status,
      assignedTo: t.assignedToMembershipId,
      createdAt: t.createdAt,
    }));
  }

  /**
   * Get pending payments (SUBMITTED)
   * Sorted by createdAt (oldest first - waiting longest)
   */
  private async getPaymentSummary(
    tenantId: string,
    buildingIds: string[],
    limit: number,
  ): Promise<PaymentSummary[]> {
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        status: 'SUBMITTED',
      },
      include: {
        building: true,
        unit: true,
      },
      orderBy: [
        { createdAt: 'asc' }, // Oldest first (waiting longest)
      ],
      take: limit,
    });

    return payments.map((p) => ({
      id: p.id,
      buildingId: p.buildingId,
      buildingName: p.building.name,
      unitCode: p.unit?.code,
      amount: p.amount,
      method: p.method,
      status: p.status,
      createdAt: p.createdAt,
      proofFileId: p.proofFileId,
    }));
  }

  /**
   * Get draft and scheduled communications
   * Sorted by updatedAt (newest first)
   */
  private async getCommunicationSummary(
    tenantId: string,
    buildingIds: string[],
    limit: number,
  ): Promise<CommunicationSummary[]> {
    const communications = await this.prisma.communication.findMany({
      where: {
        tenantId,
        buildingId: buildingIds.length > 0 ? { in: buildingIds } : undefined,
        status: { in: ['DRAFT', 'SCHEDULED'] },
      },
      include: {
        building: true,
      },
      orderBy: [
        { updatedAt: 'desc' }, // Newest first
      ],
      take: limit,
    });

    return communications.map((c) => ({
      id: c.id,
      buildingId: c.buildingId,
      buildingName: c.building?.name,
      title: c.title,
      status: c.status,
      channel: c.channel,
      scheduledAt: c.scheduledAt,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Get alerts: urgent unassigned tickets + delinquent units
   */
  private async getAlertSummary(
    tenantId: string,
    buildingIds: string[],
  ): Promise<AlertSummary> {
    // Count urgent unassigned tickets
    const urgentUnassignedCount = await this.prisma.ticket.count({
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        priority: { in: ['HIGH', 'URGENT'] },
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        assignedToMembershipId: null,
      },
    });

    // Get delinquent units (past due charges not fully paid)
    const delinquentUnits = await this.getDelinquentUnits(tenantId, buildingIds);

    return {
      urgentUnassignedTicketsCount: urgentUnassignedCount,
      delinquentUnitsTop: delinquentUnits,
    };
  }

  /**
   * Get delinquent units (units with past-due, unpaid charges)
   * Sorted by outstanding amount descending
   */
  private async getDelinquentUnits(
    tenantId: string,
    buildingIds: string[],
  ): Promise<DelinquentUnit[]> {
    // Find charges that are past due and not fully paid
    const now = new Date();

    const delinquentCharges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        building: { id: { in: buildingIds } },
        dueDate: { lt: now },
        status: { in: ['PENDING', 'PARTIAL'] },
      },
      include: {
        unit: true,
        building: true,
        paymentAllocations: true,
      },
    });

    // Calculate outstanding per unit
    const unitOutstanding: Record<string, { unit: any; building: any; amount: number }> = {};

    for (const charge of delinquentCharges) {
      const key = charge.unitId;
      const allocatedAmount = charge.paymentAllocations.reduce((sum, pa) => sum + pa.amount, 0);
      const outstanding = charge.amount - allocatedAmount;

      if (!unitOutstanding[key]) {
        unitOutstanding[key] = {
          unit: charge.unit,
          building: charge.building,
          amount: 0,
        };
      }

      unitOutstanding[key].amount += outstanding;
    }

    // Sort by amount descending and return top 5
    const sorted = Object.values(unitOutstanding)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    return sorted.map((item) => ({
      buildingId: item.building.id,
      buildingName: item.building.name,
      unitId: item.unit.id,
      unitCode: item.unit.code,
      outstanding: item.amount,
    }));
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { aggregateReportBuckets } from '../finanzas/currency-buckets';
import {
  InboxSummaryResponse,
  TicketSummary,
  PaymentSummary,
  CommunicationSummary,
  AlertSummary,
  DelinquentUnit,
} from './inbox.types';

interface DelinquentUnitRow {
  readonly buildingId: string;
  readonly buildingName: string;
  readonly unitId: string;
  readonly unitCode: string;
  readonly currency: string;
  readonly amountMinor: bigint | number;
}

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
      currency: p.currency,
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
   * NON-monetary ordering: earliest overdue dueDate ASC, then unitId ASC.
   * Amounts in different currencies are never compared or summed.
   */
  private async getDelinquentUnits(
    tenantId: string,
    buildingIds: string[],
  ): Promise<DelinquentUnit[]> {
    if (buildingIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.$queryRaw<DelinquentUnitRow[]>(Prisma.sql`
      WITH eligible_charges AS (
        SELECT
          charge."id",
          charge."tenantId",
          charge."buildingId",
          charge."unitId",
          charge."currency",
          charge."amount",
          charge."dueDate"
        FROM "Charge" AS charge
        INNER JOIN "Unit" AS unit
          ON unit."id" = charge."unitId"
          AND unit."tenantId" = charge."tenantId"
          AND unit."buildingId" = charge."buildingId"
        INNER JOIN "Building" AS building
          ON building."id" = charge."buildingId"
          AND building."tenantId" = charge."tenantId"
        WHERE charge."tenantId" = ${tenantId}
          AND building."id" IN (${Prisma.join(buildingIds)})
          AND charge."dueDate" < NOW()
          AND charge."canceledAt" IS NULL
      ),
      outstanding_charges AS (
        SELECT
          charge."tenantId",
          charge."buildingId",
          charge."unitId",
          charge."currency",
          charge."dueDate",
          GREATEST(
            charge."amount" - COALESCE(SUM(
              CASE
                WHEN payment."status" IN ('APPROVED', 'RECONCILED')
                  AND payment."canceledAt" IS NULL
                THEN allocation."amount"
                ELSE 0
              END
            ), 0),
            0
          ) AS "amountMinor"
        FROM eligible_charges AS charge
        LEFT JOIN "PaymentAllocation" AS allocation
          ON allocation."chargeId" = charge."id"
          AND allocation."tenantId" = charge."tenantId"
        LEFT JOIN "Payment" AS payment
          ON payment."id" = allocation."paymentId"
          AND payment."tenantId" = charge."tenantId"
          AND payment."buildingId" = charge."buildingId"
        GROUP BY
          charge."id",
          charge."tenantId",
          charge."buildingId",
          charge."unitId",
          charge."currency",
          charge."dueDate",
          charge."amount"
      ),
      top_units AS (
        SELECT
          "tenantId",
          "buildingId",
          "unitId",
          MIN("dueDate") AS "earliestDue"
        FROM outstanding_charges
        WHERE "amountMinor" > 0
        GROUP BY "tenantId", "buildingId", "unitId"
        ORDER BY "earliestDue" ASC, "unitId" ASC
        LIMIT 5
      )
      SELECT
        top_units."buildingId" AS "buildingId",
        building."name" AS "buildingName",
        top_units."unitId" AS "unitId",
        unit."code" AS "unitCode",
        charge."currency" AS "currency",
        SUM(charge."amountMinor") AS "amountMinor"
      FROM top_units
      INNER JOIN outstanding_charges AS charge
        ON charge."tenantId" = top_units."tenantId"
        AND charge."buildingId" = top_units."buildingId"
        AND charge."unitId" = top_units."unitId"
        AND charge."amountMinor" > 0
      INNER JOIN "Unit" AS unit
        ON unit."id" = top_units."unitId"
        AND unit."tenantId" = top_units."tenantId"
        AND unit."buildingId" = top_units."buildingId"
      INNER JOIN "Building" AS building
        ON building."id" = top_units."buildingId"
        AND building."tenantId" = top_units."tenantId"
      GROUP BY
        top_units."tenantId",
        top_units."buildingId",
        building."name",
        top_units."unitId",
        unit."code",
        charge."currency",
        top_units."earliestDue"
      ORDER BY top_units."earliestDue" ASC, top_units."unitId" ASC
    `);

    const units = new Map<
      string,
      Omit<DelinquentUnit, 'outstandingByCurrency'> & {
        entries: Array<{ currency: string; amountMinor: number }>;
      }
    >();

    for (const row of rows) {
      const amountMinor = Number(row.amountMinor);
      if (!Number.isSafeInteger(amountMinor)) {
        throw new Error('Delinquent charge aggregate exceeds the supported integer range');
      }

      const existing = units.get(row.unitId);
      if (existing) {
        existing.entries.push({ currency: row.currency, amountMinor });
        continue;
      }

      units.set(row.unitId, {
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        unitId: row.unitId,
        unitCode: row.unitCode,
        entries: [{ currency: row.currency, amountMinor }],
      });
    }

    return Array.from(units.values()).map(({ entries, ...unit }) => ({
      ...unit,
      outstandingByCurrency: aggregateReportBuckets(entries),
    }));
  }
}

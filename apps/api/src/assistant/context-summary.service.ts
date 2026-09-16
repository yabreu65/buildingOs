/**
 * AI Context Summary Service
 *
 * Generates minimal, real-world context snapshots for AI Assistant.
 * Injects actual data to improve response accuracy without bloating tokens.
 *
 * Limits:
 * - Top 5 tickets
 * - Top 5 payments
 * - Top 5 delinquent units
 * - Last 3 documents
 *
 * Respects:
 * - Scope: Only data in tenant/building/unit scope
 * - Permissions: Only modules user can read
 * - Privacy: Read-only summary, no PII
 */

import { Injectable, BadRequestException, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma, TicketStatus, PaymentStatus, ChargeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  aggregateReportBuckets,
  type ReportCurrencyAmountBucket,
} from '../finanzas/currency-buckets';

export interface ContextSnapshot {
  now: string; // ISO timestamp
  scope: {
    tenantId: string;
    buildingId?: string;
    unitId?: string;
  };
  kpis: {
    openTickets: number;
    submittedPayments: number;
    outstandingByCurrency: ReportCurrencyAmountBucket[];
  };
  topTickets: Array<{
    id: string;
    building: string;
    priority: string;
    status: string;
    title: string;
  }>;
  pendingPayments: Array<{
    id: string;
    building: string;
    unit: string;
    amount: number; // In cents
    currency: string;
    status: string;
  }>;
  topDelinquentUnits: Array<{
    building: string;
    unit: string;
    outstandingByCurrency: ReportCurrencyAmountBucket[];
  }>;
  recentDocs: Array<{
    id: string;
    building: string;
    title: string;
    category: string;
  }>;
}

export interface ContextSummary {
  summaryVersion: string; // For audit trail
  snapshot: ContextSnapshot;
}

export interface SummaryRequest {
  tenantId: string;
  membershipId: string;
  buildingId?: string;
  unitId?: string;
  page: string;
  userRoles: string[]; // For permission checking
}

@Injectable()
export class AiContextSummaryService implements OnModuleDestroy {
  // Cache for summaries (in-memory LRU, separate from response cache)
  private summaryCache: Map<string, { data: ContextSummary; expiresAt: number }> = new Map();
  private readonly cacheTtlSeconds: number = 45; // 45s default

  private readonly logger = new Logger(AiContextSummaryService.name);

  // Interval handle for cleanup on module destroy
  private readonly intervalId: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {
    // Cleanup expired entries every 30 seconds
    this.intervalId = setInterval(() => this.cleanupExpiredSummaries(), 30000);
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    clearInterval(this.intervalId);
  }

  /**
   * Generate context summary for AI Assistant
   *
   * Respects:
   * - Scope: Only data accessible in tenant/building/unit scope
   * - Permissions: Only modules user has read access to
   * - Privacy: Read-only, minimal PII
   *
   * @param request Summary request with user context
   * @returns Compact summary snapshot
   */
  async getSummary(request: SummaryRequest): Promise<ContextSummary> {
    // Validate request
    if (!request.tenantId || request.tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }

    // Generate cache key
    const cacheKey = this.generateCacheKey(request);

    // Check cache
    const cached = this.summaryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // Generate fresh summary
    const snapshot: ContextSnapshot = {
      now: new Date().toISOString(),
      scope: {
        tenantId: request.tenantId,
        buildingId: request.buildingId,
        unitId: request.unitId,
      },
      kpis: {
        openTickets: 0,
        submittedPayments: 0,
        outstandingByCurrency: [],
      },
      topTickets: [],
      pendingPayments: [],
      topDelinquentUnits: [],
      recentDocs: [],
    };

    // Fetch data in parallel
    await Promise.all([
      this.enrichTickets(snapshot, request),
      this.enrichPayments(snapshot, request),
      this.enrichDelinquency(snapshot, request),
      this.enrichDocuments(snapshot, request),
    ]);

    const summary: ContextSummary = {
      summaryVersion: `v1_${Date.now()}`,
      snapshot,
    };

    // Cache for TTL
    this.summaryCache.set(cacheKey, {
      data: summary,
      expiresAt: Date.now() + this.cacheTtlSeconds * 1000,
    });

    return summary;
  }

  /**
   * Enrich snapshot with tickets (if user has tickets.read permission)
   *
   * @private
   */
  private async enrichTickets(
    snapshot: ContextSnapshot,
    request: SummaryRequest,
  ): Promise<void> {
    // Check permission
    const hasTicketAccess = this.hasPermission(request.userRoles, 'tickets.read');
    if (!hasTicketAccess) {
      return;
    }

    try {
      // Build where clause based on scope
      const where: Prisma.TicketWhereInput = {
        tenantId: request.tenantId,
      };

      if (request.buildingId) {
        where.buildingId = request.buildingId;
      }

      if (request.unitId) {
        where.unitId = request.unitId;
      }

      // Get top 5 open tickets
      const topTickets = await this.prisma.ticket.findMany({
        where: {
          ...where,
          status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        },
        include: {
          building: {
            select: { name: true },
          },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      });

      snapshot.topTickets = topTickets.map(t => ({
        id: t.id,
        building: t.building.name,
        priority: t.priority,
        status: t.status,
        title: t.title.substring(0, 60), // Truncate for brevity
      }));
    } catch (error) {
      // Silently fail - context enrichment never blocks main request
      this.logger.error('Failed to enrich tickets', error);
    }
  }

  /**
   * Enrich snapshot with payments (if user has finance permissions)
   *
   * @private
   */
  private async enrichPayments(
    snapshot: ContextSnapshot,
    request: SummaryRequest,
  ): Promise<void> {
    // Check permission
    const hasPaymentAccess = this.hasPermission(
      request.userRoles,
      'finance.payment.review',
      'finance.read',
    );
    if (!hasPaymentAccess) {
      return;
    }

    try {
      // Build where clause based on scope
      const where: Prisma.PaymentWhereInput = {
        tenantId: request.tenantId,
        status: PaymentStatus.SUBMITTED,
        ...(request.buildingId ? { buildingId: request.buildingId } : {}),
        ...(request.unitId ? { unitId: request.unitId } : {}),
      };

      // Get KPI: count of submitted payments
      snapshot.kpis.submittedPayments = await this.prisma.payment.count({
        where,
      });

      // Get top 5 submitted payments
      const pendingPayments = await this.prisma.payment.findMany({
        where,
        include: {
          building: {
            select: { name: true },
          },
          unit: {
            select: { label: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      snapshot.pendingPayments = pendingPayments.map(p => ({
        id: p.id,
        building: p.building.name,
        unit: p.unit?.label || 'N/A',
        amount: p.amount,
        currency: p.currency,
        status: p.status,
      }));
    } catch (error) {
      this.logger.error('Failed to enrich payments', error);
    }
  }

  /**
   * Enrich snapshot with delinquent units (if user has finance.read permission)
   *
   * @private
   */
  private async enrichDelinquency(
    snapshot: ContextSnapshot,
    request: SummaryRequest,
  ): Promise<void> {
    // Check permission
    const hasFinanceAccess = this.hasPermission(request.userRoles, 'finance.read');
    if (!hasFinanceAccess) {
      return;
    }

    try {
      // Build base where clause
      const where: Prisma.ChargeWhereInput = {
        tenantId: request.tenantId,
        status: ChargeStatus.PENDING,
        ...(request.buildingId ? { buildingId: request.buildingId } : {}),
        ...(request.unitId ? { unitId: request.unitId } : {}),
      };

      const outstandingGroups = await this.prisma.charge.groupBy({
        by: ['currency'],
        where,
        _sum: { amount: true },
      });

      snapshot.kpis.outstandingByCurrency = aggregateReportBuckets(
        outstandingGroups.map((group) => ({
          currency: group.currency,
          amountMinor: Number(group._sum.amount ?? 0),
        })),
      );

      // Aggregate in the database per unit/currency. Unit ordering deliberately
      // uses only due date and stable identifiers; nominal amounts are never ranked.
      const delinquent = await this.prisma.$queryRaw<Array<{
        building: string;
        unit: string | null;
        currency: string;
        buildingId: string;
            unitId: string | null;
            outstanding: bigint;
      }>>`
        WITH selected_units AS (
              SELECT
                c."buildingId",
                c."unitId",
                MIN(c."dueDate") AS "earliestDueDate"
              FROM "Charge" c
              WHERE c."tenantId" = ${request.tenantId}
                AND c.status = ${ChargeStatus.PENDING}
                ${request.buildingId ? Prisma.sql`AND c."buildingId" = ${request.buildingId}` : Prisma.empty}
                ${request.unitId ? Prisma.sql`AND c."unitId" = ${request.unitId}` : Prisma.empty}
              GROUP BY c."buildingId", c."unitId"
              ORDER BY "earliestDueDate" ASC NULLS LAST, "buildingId" ASC, "unitId" ASC
              LIMIT 5
            )
            SELECT
          selected_units."buildingId" AS "buildingId",
          selected_units."unitId" AS "unitId",
              b.name AS building,
              u.label AS unit,
          c.currency AS currency,
          SUM(c.amount) AS outstanding
        FROM "Charge" c
        JOIN selected_units
              ON c."buildingId" = selected_units."buildingId"
              AND c."unitId" IS NOT DISTINCT FROM selected_units."unitId"
            JOIN "Building" b ON c."buildingId" = b.id AND b."tenantId" = c."tenantId"
        LEFT JOIN "Unit" u ON c."unitId" = u.id AND u."tenantId" = c."tenantId"
        WHERE c."tenantId" = ${request.tenantId}
          AND c.status = ${ChargeStatus.PENDING}
          ${request.buildingId ? Prisma.sql`AND c."buildingId" = ${request.buildingId}` : Prisma.empty}
          ${request.unitId ? Prisma.sql`AND c."unitId" = ${request.unitId}` : Prisma.empty}
        GROUP BY
              selected_units."buildingId",
              selected_units."unitId",
              selected_units."earliestDueDate",
              b.id,
              b.name,
              u.id,
              u.label,
              c.currency
        ORDER BY selected_units."earliestDueDate" ASC NULLS LAST,
              selected_units."buildingId" ASC,
              selected_units."unitId" ASC,
              c.currency ASC
      `;

      const delinquentByUnit = new Map<string, {
        building: string;
        unit: string;
        entries: Array<{ currency: string; amountMinor: number }>;
      }>();
      for (const row of delinquent) {
        const unit = row.unit ?? 'N/A';
        const unitKey = JSON.stringify([row.buildingId, row.unitId]);
        const current = delinquentByUnit.get(unitKey) ?? {
          building: row.building,
          unit,
          entries: [],
        };
        current.entries.push({
          currency: row.currency,
          amountMinor: Number(row.outstanding),
        });
        delinquentByUnit.set(unitKey, current);
      }

      snapshot.topDelinquentUnits = Array.from(delinquentByUnit.values())
                .map((row) => ({
          building: row.building,
          unit: row.unit,
          outstandingByCurrency: aggregateReportBuckets(row.entries),
        }));
    } catch (error) {
      this.logger.error('Failed to enrich delinquency', error);
    }
  }

  /**
   * Enrich snapshot with recent documents (if user has documents.read permission)
   *
   * @private
   */
  private async enrichDocuments(
    snapshot: ContextSnapshot,
    request: SummaryRequest,
  ): Promise<void> {
    // Check permission
    const hasDocAccess = this.hasPermission(request.userRoles, 'documents.read');
    if (!hasDocAccess) {
      return;
    }

    try {
      // Build where clause based on scope
      const where: Prisma.DocumentWhereInput = {
        tenantId: request.tenantId,
        ...(request.buildingId ? { buildingId: request.buildingId } : {}),
        ...(request.unitId ? { unitId: request.unitId } : {}),
      };

      // Get last 3 documents
      const recentDocs = await this.prisma.document.findMany({
        where,
        include: {
          building: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });

      snapshot.recentDocs = recentDocs
        .filter(d => d.building !== null)
        .map(d => ({
          id: d.id,
          building: d.building!.name,
          title: d.title.substring(0, 40), // Truncate for brevity
          category: d.category,
        }));
    } catch (error) {
      this.logger.error('Failed to enrich documents', error);
    }
  }

  /**
   * Check if user has specific permission(s)
   *
   * @private
   */
  private hasPermission(userRoles: string[], ...requiredPermissions: string[]): boolean {
    // SUPER_ADMIN has all permissions
    if (userRoles.includes('SUPER_ADMIN')) {
      return true;
    }

    // TENANT_OWNER, TENANT_ADMIN have most permissions
    if (userRoles.includes('TENANT_OWNER') || userRoles.includes('TENANT_ADMIN')) {
      return true;
    }

    // OPERATOR has limited permissions
    if (userRoles.includes('OPERATOR')) {
      return requiredPermissions.some(p =>
        ['tickets.read', 'documents.read'].includes(p),
      );
    }

    // RESIDENT has very limited permissions
    if (userRoles.includes('RESIDENT')) {
      return requiredPermissions.some(p =>
        ['tickets.read'].includes(p),
      );
    }

    return false;
  }

  /**
   * Generate cache key from request
   *
   * @private
   */
  private generateCacheKey(request: SummaryRequest): string {
    const parts = [
      request.tenantId,
      request.buildingId || 'none',
      request.unitId || 'none',
      request.membershipId,
      request.page,
      request.userRoles.sort().join(','),
    ];
    return `summary:${parts.join(':')}`;
  }

  /**
   * Cleanup expired summaries from cache
   *
   * @private
   */
  private cleanupExpiredSummaries(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, value] of this.summaryCache.entries()) {
      if (value.expiresAt <= now) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.summaryCache.delete(key));
  }

  /**
   * Get cache info (for debugging)
   */
  getCacheInfo() {
    return {
      summariesCached: this.summaryCache.size,
      ttlSeconds: this.cacheTtlSeconds,
    };
  }

  /**
   * Clear all summaries (for testing)
   */
  clearCache(): void {
    this.summaryCache.clear();
  }
}

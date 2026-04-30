import { Injectable } from '@nestjs/common';
import { OpsAlertSeverity, OpsAlertStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const OPEN_HANDOFF_STATUSES = ['OPEN', 'PENDING', 'NOTIFIED', 'FAILED', 'IN_PROGRESS'] as const;

@Injectable()
export class OpsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAlerts(params: {
    tenantId?: string;
    status?: OpsAlertStatus;
    cursor?: string;
    limit: number;
  }) {
    const where: Prisma.OpsAlertWhereInput = {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.status ? { status: params.status } : {}),
    };

    const rows = await this.prisma.opsAlert.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      take: params.limit + 1,
    });

    const hasMore = rows.length > params.limit;
    const items = hasMore ? rows.slice(0, params.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  }

  async ackAlert(id: string) {
    return this.prisma.opsAlert.update({
      where: { id },
      data: { status: 'ACK', ackAt: new Date() },
    });
  }

  async resolveAlert(id: string) {
    return this.prisma.opsAlert.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  async findAlertById(id: string) {
    return this.prisma.opsAlert.findUnique({ where: { id } });
  }

  async upsertAlert(input: {
    tenantId: string | null;
    severity: OpsAlertSeverity;
    code: string;
    message: string;
    metricsJson: Prisma.JsonObject;
    window: string;
    dedupeKey: string;
  }) {
    return this.prisma.opsAlert.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: {
        tenantId: input.tenantId,
        severity: input.severity,
        code: input.code,
        message: input.message,
        metricsJson: input.metricsJson,
        window: input.window,
        dedupeKey: input.dedupeKey,
        status: 'OPEN',
      },
      update: {
        tenantId: input.tenantId,
        severity: input.severity,
        message: input.message,
        metricsJson: input.metricsJson,
        status: 'OPEN',
        ackAt: null,
        resolvedAt: null,
      },
    });
  }

  async listTenantIdsFromHandoffs() {
    const rows = await this.prisma.assistantHandoff.findMany({
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((row) => row.tenantId);
  }

  async getOpenCount(tenantId?: string): Promise<number> {
    return this.prisma.assistantHandoff.count({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status: { in: [...OPEN_HANDOFF_STATUSES] },
      },
    });
  }

  async getAssignP95Minutes(tenantId?: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ p95: number | null }>>`
      SELECT percentile_cont(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM ("assignedAt" - "createdAt")) / 60.0
      ) AS p95
      FROM "AssistantHandoff"
      WHERE "assignedAt" IS NOT NULL
      ${tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}` : Prisma.empty}
    `;
    return rows[0]?.p95 ?? null;
  }

  async getResolveP95Hours(tenantId?: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ p95: number | null }>>`
      SELECT percentile_cont(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600.0
      ) AS p95
      FROM "AssistantHandoff"
      WHERE "resolvedAt" IS NOT NULL
      ${tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}` : Prisma.empty}
    `;
    return rows[0]?.p95 ?? null;
  }

  async getBreachedSlaCount(params: {
    tenantId?: string;
    assignMaxMinutes: number;
    resolveMaxHours: number;
  }) {
    const rows = await this.prisma.$queryRaw<Array<{ assign_breach: bigint; resolve_breach: bigint }>>`
      SELECT
        COUNT(*) FILTER (
          WHERE "assignedAt" IS NULL
            AND status IN ('OPEN', 'PENDING', 'NOTIFIED', 'FAILED')
            AND EXTRACT(EPOCH FROM (NOW() - "createdAt")) / 60.0 > ${params.assignMaxMinutes}
        ) AS assign_breach,
        COUNT(*) FILTER (
          WHERE "resolvedAt" IS NULL
            AND status = 'IN_PROGRESS'
            AND EXTRACT(EPOCH FROM (NOW() - "createdAt")) / 3600.0 > ${params.resolveMaxHours}
        ) AS resolve_breach
      FROM "AssistantHandoff"
      WHERE 1=1
      ${params.tenantId ? Prisma.sql`AND "tenantId" = ${params.tenantId}` : Prisma.empty}
    `;

    const row = rows[0] ?? { assign_breach: 0n, resolve_breach: 0n };
    return {
      assign: Number(row.assign_breach),
      resolve: Number(row.resolve_breach),
      total: Number(row.assign_breach) + Number(row.resolve_breach),
    };
  }

  async getTopFallbackPaths24h(tenantId?: string) {
    return this.prisma.assistantHandoff.groupBy({
      by: ['fallbackPath'],
      _count: { fallbackPath: true },
      where: {
        ...(tenantId ? { tenantId } : {}),
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { _count: { fallbackPath: 'desc' } },
      take: 10,
    });
  }

  async getGatewayErrorRate15m(tenantId?: string): Promise<{ rate: number | null; total: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ errors: bigint; total: bigint }>>`
      SELECT
        COUNT(*) FILTER (
          WHERE LOWER("gatewayOutcome") LIKE '%error%'
             OR LOWER("gatewayOutcome") LIKE '%timeout%'
             OR LOWER("gatewayOutcome") LIKE '%exception%'
             OR LOWER("gatewayOutcome") LIKE '%invalid%'
             OR LOWER("gatewayOutcome") LIKE '%mismatch%'
             OR LOWER("gatewayOutcome") LIKE '%not_ok%'
        ) AS errors,
        COUNT(*) AS total
      FROM "AssistantHandoff"
      WHERE "createdAt" >= NOW() - INTERVAL '15 minutes'
      ${tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}` : Prisma.empty}
    `;

    const row = rows[0] ?? { errors: 0n, total: 0n };
    const total = Number(row.total);
    return { rate: total > 0 ? Number(row.errors) / total : null, total };
  }

  async getP0NoDataRate15m(tenantId?: string): Promise<{ rate: number | null; total: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ no_data: bigint; total: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE "fallbackPath" = 'rag_no_sources') AS no_data,
        COUNT(*) AS total
      FROM "AssistantHandoff"
      WHERE "createdAt" >= NOW() - INTERVAL '15 minutes'
      ${tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}` : Prisma.empty}
    `;

    const row = rows[0] ?? { no_data: 0n, total: 0n };
    const total = Number(row.total);
    return { rate: total > 0 ? Number(row.no_data) / total : null, total };
  }

  async getCacheHitRate15m(tenantId?: string): Promise<{ rate: number | null; total: number }> {
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const [total, cacheHits] = await Promise.all([
      this.prisma.aiInteractionLog.count({
        where: { ...(tenantId ? { tenantId } : {}), createdAt: { gte: since } },
      }),
      this.prisma.aiInteractionLog.count({
        where: { ...(tenantId ? { tenantId } : {}), cacheHit: true, createdAt: { gte: since } },
      }),
    ]);

    return { rate: total > 0 ? cacheHits / total : null, total };
  }
}

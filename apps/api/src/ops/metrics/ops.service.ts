import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OpsAlertSeverity, OpsAlertStatus, Prisma } from '@prisma/client';
import { OpsRepository } from './ops.repository';
import { HitlMetricsSnapshot, OpsActorContext, OpsAlertsListQuery } from './ops.types';

const OPS_ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR']);

@Injectable()
export class OpsService {
  constructor(private readonly repository: OpsRepository) {}

  private assertOpsRole(actor: OpsActorContext): void {
    if (actor.isSuperAdmin) return;
    if (!actor.roles.some((role) => OPS_ALLOWED_ROLES.has(role))) {
      throw new ForbiddenException('Role not allowed for ops endpoints');
    }
  }

  private resolveTenantScope(actor: OpsActorContext, requestedTenantId?: string): string | undefined {
    if (actor.isSuperAdmin) return requestedTenantId;
    if (!actor.tenantId) throw new BadRequestException('Tenant context required');
    if (requestedTenantId && requestedTenantId !== actor.tenantId) {
      throw new ForbiddenException('Tenant mismatch');
    }
    return actor.tenantId;
  }

  private clampLimit(limit?: number): number {
    if (!limit || Number.isNaN(limit)) return 20;
    return Math.max(1, Math.min(100, limit));
  }

  private parseAlertStatus(status?: string): OpsAlertStatus | undefined {
    if (!status) return undefined;
    const normalized = status.trim().toUpperCase();
    if (normalized === 'OPEN' || normalized === 'ACK' || normalized === 'RESOLVED') {
      return normalized as OpsAlertStatus;
    }
    throw new BadRequestException('Invalid alert status filter');
  }

  private envNumber(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private dedupeKey(tenantId: string | null, code: string, window: string): string {
    return `${tenantId ?? 'global'}:${code}:${window}`;
  }

  async listAlerts(actor: OpsActorContext, query: OpsAlertsListQuery) {
    this.assertOpsRole(actor);
    return this.repository.listAlerts({
      tenantId: this.resolveTenantScope(actor, query.tenantId),
      status: this.parseAlertStatus(query.status),
      cursor: query.cursor,
      limit: this.clampLimit(query.limit),
    });
  }

  async ackAlert(actor: OpsActorContext, id: string) {
    this.assertOpsRole(actor);
    const alert = await this.repository.findAlertById(id);
    if (!alert) throw new NotFoundException('Alert not found');
    this.resolveTenantScope(actor, alert.tenantId ?? undefined);
    return this.repository.ackAlert(id);
  }

  async resolveAlert(actor: OpsActorContext, id: string) {
    this.assertOpsRole(actor);
    const alert = await this.repository.findAlertById(id);
    if (!alert) throw new NotFoundException('Alert not found');
    this.resolveTenantScope(actor, alert.tenantId ?? undefined);
    return this.repository.resolveAlert(id);
  }

  async getHitlMetrics(actor: OpsActorContext, tenantId?: string): Promise<HitlMetricsSnapshot> {
    this.assertOpsRole(actor);
    const scopedTenant = this.resolveTenantScope(actor, tenantId);
    return this.computeHitlSnapshot(scopedTenant ?? null);
  }

  async runMetricsCheck(): Promise<{ processed: number; alertsTriggered: number }> {
    const tenantIds = await this.repository.listTenantIdsFromHandoffs();
    const uniqueTenantIds = [...new Set(tenantIds)];

    const snapshots: HitlMetricsSnapshot[] = [await this.computeHitlSnapshot(null)];
    for (const tenantId of uniqueTenantIds) {
      snapshots.push(await this.computeHitlSnapshot(tenantId));
    }

    let alertsTriggered = 0;
    for (const snapshot of snapshots) {
      const triggered = await this.evaluateAndPersistAlerts(snapshot);
      alertsTriggered += triggered;
    }

    return { processed: snapshots.length, alertsTriggered };
  }

  private async computeHitlSnapshot(tenantId: string | null): Promise<HitlMetricsSnapshot> {
    const assignMaxMinutes = this.envNumber('SLA_ASSIGN_MAX_MINUTES', 60);
    const resolveMaxHours = this.envNumber('SLA_RESOLVE_MAX_HOURS', 24);

    const [
      handoffsOpenCount,
      timeToAssignP95Minutes,
      timeToResolveP95Hours,
      breachedSlaCount,
      topFallbackRows,
      gatewayError,
      p0NoData,
      cacheHit,
    ] = await Promise.all([
      this.repository.getOpenCount(tenantId ?? undefined),
      this.repository.getAssignP95Minutes(tenantId ?? undefined),
      this.repository.getResolveP95Hours(tenantId ?? undefined),
      this.repository.getBreachedSlaCount({
        tenantId: tenantId ?? undefined,
        assignMaxMinutes,
        resolveMaxHours,
      }),
      this.repository.getTopFallbackPaths24h(tenantId ?? undefined),
      this.repository.getGatewayErrorRate15m(tenantId ?? undefined),
      this.repository.getP0NoDataRate15m(tenantId ?? undefined),
      this.repository.getCacheHitRate15m(tenantId ?? undefined),
    ]);

    return {
      tenantId,
      window: '24h',
      handoffsOpenCount,
      timeToAssignP95Minutes,
      timeToResolveP95Hours,
      breachedSlaCount,
      topFallbackPaths24h: topFallbackRows.map((row) => ({
        fallbackPath: row.fallbackPath,
        count: row._count.fallbackPath,
      })),
      aiHealth15m: {
        gatewayErrorRate: gatewayError.rate,
        p0NoDataRate: p0NoData.rate,
        cacheHitRate: cacheHit.rate,
        totalEvents: Math.max(gatewayError.total, p0NoData.total, cacheHit.total),
      },
    };
  }

  private async triggerAlert(params: {
    tenantId: string | null;
    severity: OpsAlertSeverity;
    code: string;
    message: string;
    metricsJson: Prisma.JsonObject;
    window: string;
  }): Promise<void> {
    await this.repository.upsertAlert({
      ...params,
      dedupeKey: this.dedupeKey(params.tenantId, params.code, params.window),
    });
  }

  private async evaluateAndPersistAlerts(snapshot: HitlMetricsSnapshot): Promise<number> {
    let count = 0;
    const openThreshold = this.envNumber('HITL_OPEN_THRESHOLD', 20);
    const assignMaxMinutes = this.envNumber('SLA_ASSIGN_MAX_MINUTES', 60);
    const resolveMaxHours = this.envNumber('SLA_RESOLVE_MAX_HOURS', 24);
    const gatewayErrorMax = this.envNumber('AI_GATEWAY_ERROR_RATE_15M', 0.05);
    const p0NoDataMax = this.envNumber('AI_P0_NO_DATA_RATE_15M', 0.1);
    const cacheHitMin = this.envNumber('CACHE_HIT_RATE_MIN', 0.3);

    if (snapshot.handoffsOpenCount > openThreshold) {
      count += 1;
      await this.triggerAlert({
        tenantId: snapshot.tenantId,
        severity: 'CRITICAL',
        code: 'HITL_BACKLOG_HIGH',
        message: `HITL backlog above threshold (${snapshot.handoffsOpenCount} > ${openThreshold})`,
        metricsJson: {
          handoffsOpenCount: snapshot.handoffsOpenCount,
          threshold: openThreshold,
        },
        window: '15m',
      });
    }

    if (snapshot.timeToAssignP95Minutes !== null && snapshot.timeToAssignP95Minutes > assignMaxMinutes) {
      count += 1;
      await this.triggerAlert({
        tenantId: snapshot.tenantId,
        severity: 'WARNING',
        code: 'SLA_ASSIGN_P95_BREACH',
        message: `Assignment SLA p95 breached (${snapshot.timeToAssignP95Minutes.toFixed(1)}m > ${assignMaxMinutes}m)`,
        metricsJson: {
          p95Minutes: snapshot.timeToAssignP95Minutes,
          thresholdMinutes: assignMaxMinutes,
        },
        window: '24h',
      });
    }

    if (snapshot.timeToResolveP95Hours !== null && snapshot.timeToResolveP95Hours > resolveMaxHours) {
      count += 1;
      await this.triggerAlert({
        tenantId: snapshot.tenantId,
        severity: 'WARNING',
        code: 'SLA_RESOLVE_P95_BREACH',
        message: `Resolution SLA p95 breached (${snapshot.timeToResolveP95Hours.toFixed(1)}h > ${resolveMaxHours}h)`,
        metricsJson: {
          p95Hours: snapshot.timeToResolveP95Hours,
          thresholdHours: resolveMaxHours,
        },
        window: '24h',
      });
    }

    if (
      snapshot.aiHealth15m.gatewayErrorRate !== null
      && snapshot.aiHealth15m.gatewayErrorRate > gatewayErrorMax
    ) {
      count += 1;
      await this.triggerAlert({
        tenantId: snapshot.tenantId,
        severity: 'CRITICAL',
        code: 'AI_GATEWAY_ERROR_SPIKE',
        message: `Gateway error rate spike (${(snapshot.aiHealth15m.gatewayErrorRate * 100).toFixed(1)}% > ${(gatewayErrorMax * 100).toFixed(1)}%)`,
        metricsJson: {
          rate: snapshot.aiHealth15m.gatewayErrorRate,
          threshold: gatewayErrorMax,
          totalEvents: snapshot.aiHealth15m.totalEvents,
        },
        window: '15m',
      });
    }

    if (snapshot.aiHealth15m.p0NoDataRate !== null && snapshot.aiHealth15m.p0NoDataRate > p0NoDataMax) {
      count += 1;
      await this.triggerAlert({
        tenantId: snapshot.tenantId,
        severity: 'WARNING',
        code: 'AI_P0_NO_DATA_SPIKE',
        message: `P0 no-data rate spike (${(snapshot.aiHealth15m.p0NoDataRate * 100).toFixed(1)}% > ${(p0NoDataMax * 100).toFixed(1)}%)`,
        metricsJson: {
          rate: snapshot.aiHealth15m.p0NoDataRate,
          threshold: p0NoDataMax,
          totalEvents: snapshot.aiHealth15m.totalEvents,
        },
        window: '15m',
      });
    }

    if (snapshot.aiHealth15m.cacheHitRate !== null && snapshot.aiHealth15m.cacheHitRate < cacheHitMin) {
      count += 1;
      await this.triggerAlert({
        tenantId: snapshot.tenantId,
        severity: 'WARNING',
        code: 'CACHE_HIT_DROP',
        message: `Cache hit rate below floor (${(snapshot.aiHealth15m.cacheHitRate * 100).toFixed(1)}% < ${(cacheHitMin * 100).toFixed(1)}%)`,
        metricsJson: {
          rate: snapshot.aiHealth15m.cacheHitRate,
          threshold: cacheHitMin,
          totalEvents: snapshot.aiHealth15m.totalEvents,
        },
        window: '15m',
      });
    }

    return count;
  }
}

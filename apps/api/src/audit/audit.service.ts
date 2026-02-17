import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, AuditLog } from '@prisma/client';

export interface AuditLogInput {
  tenantId?: string;
  actorUserId?: string;
  actorMembershipId?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Record<string, any>;
}

export interface AuditLogQueryFilters {
  tenantId?: string;
  actorUserId?: string;
  action?: AuditAction;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  skip?: number;
  take?: number;
}

export interface AuditLogQueryResponse {
  data: AuditLog[];
  total: number;
}

/**
 * AuditService: Global service for audit logging
 *
 * PATTERN:
 * - createLog() is fire-and-forget: async but never throws
 * - Never fails the main operation even if audit write fails
 * - Logs errors to console for debugging
 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Write audit log entry (fire-and-forget pattern)
   *
   * RULE: This method must NEVER throw or fail the calling operation.
   * If DB write fails, log to console and continue.
   *
   * @param input Audit log input with context
   */
  async createLog(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: input.tenantId ?? null,
          actorUserId: input.actorUserId ?? null,
          actorMembershipId: input.actorMembershipId ?? null,
          action: input.action,
          entity: input.entityType,
          entityId: input.entityId,
          metadata: input.metadata ?? {},
        },
      });
    } catch (err) {
      // RULE: Never fail main operation on audit write failure
      const message = err instanceof Error ? err.message : String(err);
      console.error('[AuditService] Failed to write audit log:', {
        message,
        input,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Query audit logs with filters
   *
   * RULE: Only return logs from within the scope of the requesting actor.
   * This is enforced by the controller/guard, not here.
   *
   * @param filters Query filters (all optional)
   * @returns Paginated audit logs
   */
  async queryLogs(filters: AuditLogQueryFilters): Promise<AuditLogQueryResponse> {
    const {
      tenantId,
      actorUserId,
      action,
      entityType,
      dateFrom,
      dateTo,
      skip = 0,
      take = 50,
    } = filters;

    // Build dynamic where clause
    const where: any = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }
    if (actorUserId) {
      where.actorUserId = actorUserId;
    }
    if (action) {
      where.action = action;
    }
    if (entityType) {
      where.entity = entityType;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = dateFrom;
      }
      if (dateTo) {
        where.createdAt.lte = dateTo;
      }
    }

    // Execute parallel queries for consistency
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          tenant: { select: { id: true, name: true } },
          actor: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total };
  }
}

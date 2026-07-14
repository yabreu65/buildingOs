import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogInput {
  tenantId?: string;
  actorUserId?: string;
  actorMembershipId?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: unknown;
}

export interface AuditLogQueryFilters {
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

interface AuditWriteClient {
  auditLog: {
    create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown>;
  };
}

interface GlobalAuditLogInput {
  actorUserId?: string;
  actorMembershipId?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: unknown;
}

interface MembershipQueryClient {
  membership: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
      select: {
        id: boolean;
        tenantId: boolean;
        roles: { select: { role: boolean; scopeType: boolean } };
      };
    }) => Promise<{
      id: string;
      tenantId: string;
      roles: Array<{
        role: string;
        scopeType: 'TENANT' | 'BUILDING' | 'UNIT';
      }>;
    } | null>;
  };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes a best-effort audit record. Failures are logged and intentionally
   * do not change the caller's outcome; financial mutations must use
   * createLogRequired instead.
   */
  async createLog(input: AuditLogInput): Promise<void> {
    try {
      await this.createLogRequired(input, this.prisma);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[AuditService] Failed to write audit log', {
        message,
        input,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async createGlobalLog(input: GlobalAuditLogInput): Promise<void> {
    try {
      await this.createGlobalLogRequired(input, this.prisma);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[AuditService] Failed to write global audit log', {
        message,
        input,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async createLogRequired(input: AuditLogInput, tx: AuditWriteClient): Promise<void> {
    const tenantId = this.normalizeTenantId(input.tenantId);
    await this.writeLog(
      {
        tenantId,
        actorUserId: input.actorUserId,
        actorMembershipId: input.actorMembershipId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
      },
      tx,
    );
  }

  async createGlobalLogRequired(
    input: GlobalAuditLogInput,
    tx: AuditWriteClient,
  ): Promise<void> {
    await this.writeLog(
      {
        tenantId: null,
        actorUserId: input.actorUserId,
        actorMembershipId: input.actorMembershipId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
      },
      tx,
    );
  }

  async queryTenantLogs(
    tenantId: string,
    membershipId: string,
    filters: AuditLogQueryFilters = {},
  ): Promise<AuditLogQueryResponse> {
    await this.resolveTenantAuditMembership(tenantId, membershipId);
    return this.queryLogs(tenantId, filters);
  }

  async queryGlobalLogsForSuperAdmin(
    tenantId: string,
    filters: AuditLogQueryFilters = {},
  ): Promise<AuditLogQueryResponse> {
    return this.queryLogs(tenantId, filters);
  }

  async queryLogs(
    tenantId: string,
    filters: AuditLogQueryFilters = {},
  ): Promise<AuditLogQueryResponse> {
    const normalizedTenantId = this.normalizeTenantId(tenantId);
    const { actorUserId, action, entityType, dateFrom, dateTo, skip = 0, take = 50 } = filters;

    this.assertValidDate(dateFrom, 'dateFrom');
    this.assertValidDate(dateTo, 'dateTo');

    const where: Prisma.AuditLogWhereInput = {
      tenantId: normalizedTenantId,
    };

    if (actorUserId) {
      where.actorUserId = actorUserId;
    }
    if (action) {
      where.action = action;
    }
    if (entityType) {
      where.entity = entityType;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = dateFrom;
      }
      if (dateTo) {
        where.createdAt.lte = dateTo;
      }
    }

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

  private async resolveTenantAuditMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<void> {
    const membership = await (this.prisma as PrismaService & MembershipQueryClient).membership.findFirst({
      where: { id: membershipId, tenantId },
      select: {
        id: true,
        tenantId: true,
        roles: { select: { role: true, scopeType: true } },
      },
    });

    if (!membership) {
      throw new ForbiddenException('No tiene acceso al tenant solicitado');
    }

    const tenantRoles = membership.roles
      .filter((role) => role.scopeType === 'TENANT')
      .map((role) => role.role);

    if (tenantRoles.length === 0 || tenantRoles.every((role) => role === 'RESIDENT')) {
      throw new ForbiddenException('Residents cannot access audit logs');
    }
  }

  private normalizeTenantId(tenantId?: string): string {
    const normalized = tenantId?.trim();

    if (!normalized) {
      throw new BadRequestException('tenantId is required');
    }

    return normalized;
  }

  private async writeLog(
    input: {
      tenantId: string | null;
      actorUserId?: string;
      actorMembershipId?: string;
      action: AuditAction;
      entityType: string;
      entityId: string;
      metadata?: unknown;
    },
    tx: AuditWriteClient,
  ): Promise<void> {
    const metadata = this.normalizeMetadata(
      input.metadata === undefined ? {} : input.metadata,
    );

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId ?? null,
        actorMembershipId: input.actorMembershipId ?? null,
        action: input.action,
        entity: input.entityType,
        entityId: input.entityId,
        metadata,
      },
    });
  }

  private assertValidDate(value: Date | undefined, field: 'dateFrom' | 'dateTo'): void {
    if (!value) {
      return;
    }

    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
  }

  private normalizeMetadata(metadata: unknown): Prisma.InputJsonValue {
    if (metadata === null || metadata === undefined) {
      throw new BadRequestException('metadata must not be null');
    }

    return this.normalizeJsonValue(metadata, 'metadata');
  }

  private normalizeJsonValue(
    value: unknown,
    path: string,
    seen: WeakSet<object> = new WeakSet<object>(),
  ): Prisma.InputJsonValue {
    if (value === null || value === undefined) {
      throw new BadRequestException(`${path} must not be null or undefined`);
    }

    const valueType = typeof value;

    if (valueType === 'string' || valueType === 'boolean') {
      return value;
    }

    if (valueType === 'number') {
      if (!Number.isFinite(value)) {
        throw new BadRequestException(`${path} must be a finite number`);
      }

      return value;
    }

    if (Array.isArray(value)) {
      if (seen.has(value)) {
        throw new BadRequestException(`${path} contains a circular reference`);
      }

      seen.add(value);

      const normalizedArray: unknown[] = [];

      for (const [index, item] of value.entries()) {
        normalizedArray.push(this.normalizeJsonValue(item, `${path}[${index}]`, seen));
      }

      return normalizedArray as Prisma.InputJsonValue;
    }

    if (valueType === 'object') {
      if (!this.isPlainObject(value)) {
        throw new BadRequestException(`${path} must be a plain JSON object`);
      }

      if (seen.has(value)) {
        throw new BadRequestException(`${path} contains a circular reference`);
      }

      seen.add(value);

      const normalizedObject: Record<string, unknown> = {};

      for (const [key, nestedValue] of Object.entries(value)) {
        if (nestedValue === undefined) {
          throw new BadRequestException(`${path}.${key} must not be undefined`);
        }

        normalizedObject[key] = this.normalizeJsonValue(
          nestedValue,
          `${path}.${key}`,
          seen,
        );
      }

      return normalizedObject as Prisma.InputJsonValue;
    }

    throw new BadRequestException(`${path} must be JSON-compatible`);
  }

  private isPlainObject(value: object): boolean {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
}

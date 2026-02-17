import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantStatsResponse {
  totalBuildings: number;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  unknownUnits: number;
  totalResidents: number;
}

export interface TenantBillingResponse {
  subscription: {
    status: string;
    planId: string;
    currentPeriodEnd: string | null;
    trialEndDate: string | null;
  };
  plan: {
    name: string;
    planId: string;
    maxBuildings: number;
    maxUnits: number;
    maxUsers: number;
    maxOccupants: number;
    canExportReports: boolean;
    canBulkOperations: boolean;
    supportLevel: string;
    monthlyPrice: number;
  };
  usage: {
    buildings: number;
    units: number;
    users: number;
    residents: number;
  };
}

import { AuditAction } from '@prisma/client';

export interface AuditLogFilter {
  skip?: number;
  take?: number;
  action?: AuditAction;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface AuditLogResponse {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  actorUserId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditLogsResultResponse {
  data: AuditLogResponse[];
  total: number;
}

/**
 * TenancyStatsService: proporciona estadísticas y métricas por tenant.
 *
 * Métodos:
 * - getTenantStats(tenantId): Estadísticas de buildings/units/residents
 * - getTenantBilling(tenantId): Información de suscripción y plan
 * - getTenantAuditLogs(tenantId, filters): Logs de auditoría del tenant
 */
@Injectable()
export class TenancyStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene estadísticas de un tenant:
   * - Número de buildings
   * - Número total de units
   * - Units ocupadas (occupancyStatus = "OCCUPIED")
   * - Units vacantes (occupancyStatus = "VACANT")
   * - Units desconocidas (occupancyStatus = "UNKNOWN")
   * - Total de residents (UnitOccupant records)
   */
  async getTenantStats(tenantId: string): Promise<TenantStatsResponse> {
    // Total buildings
    const totalBuildings = await this.prisma.building.count({
      where: { tenantId },
    });

    // Total units
    const totalUnits = await this.prisma.unit.count({
      where: { building: { tenantId } },
    });

    // Occupied units
    const occupiedUnits = await this.prisma.unit.count({
      where: {
        building: { tenantId },
        occupancyStatus: 'OCCUPIED',
      },
    });

    // Vacant units
    const vacantUnits = await this.prisma.unit.count({
      where: {
        building: { tenantId },
        occupancyStatus: 'VACANT',
      },
    });

    // Unknown occupancy
    const unknownUnits = await this.prisma.unit.count({
      where: {
        building: { tenantId },
        occupancyStatus: 'UNKNOWN',
      },
    });

    // Total residents (UnitOccupant count with role RESIDENT)
    const totalResidents = await this.prisma.unitOccupant.count({
      where: {
        unit: { building: { tenantId } },
        role: 'RESIDENT',
      },
    });

    return {
      totalBuildings,
      totalUnits,
      occupiedUnits,
      vacantUnits,
      unknownUnits,
      totalResidents,
    };
  }

  /**
   * Obtiene información de facturación del tenant:
   * - Estado de suscripción y período actual
   * - Plan actual con entitlements
   * - Uso actual vs límites
   */
  async getTenantBilling(tenantId: string): Promise<TenantBillingResponse> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });

    // Si no hay suscripción, devolver valores por defecto (FREE tier)
    if (!subscription) {
      return {
        subscription: {
          status: 'TRIAL',
          planId: 'FREE',
          currentPeriodEnd: null,
          trialEndDate: null,
        },
        plan: {
          name: 'Free',
          planId: 'FREE',
          maxBuildings: 1,
          maxUnits: 10,
          maxUsers: 3,
          maxOccupants: 50,
          canExportReports: false,
          canBulkOperations: false,
          supportLevel: 'COMMUNITY',
          monthlyPrice: 0,
        },
        usage: {
          buildings: await this.prisma.building.count({ where: { tenantId } }),
          units: await this.prisma.unit.count({
            where: { building: { tenantId } },
          }),
          users: await this.prisma.membership.count({ where: { tenantId } }),
          residents: await this.prisma.unitOccupant.count({
            where: {
              unit: { building: { tenantId } },
              role: 'RESIDENT',
            },
          }),
        },
      };
    }

    // Calcular uso actual
    const buildings = await this.prisma.building.count({ where: { tenantId } });
    const units = await this.prisma.unit.count({
      where: { building: { tenantId } },
    });
    const users = await this.prisma.membership.count({ where: { tenantId } });
    const residents = await this.prisma.unitOccupant.count({
      where: {
        unit: { building: { tenantId } },
        role: 'RESIDENT',
      },
    });

    return {
      subscription: {
        status: subscription.status,
        planId: subscription.planId,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
        trialEndDate: subscription.trialEndDate?.toISOString() ?? null,
      },
      plan: {
        name: subscription.plan.name,
        planId: subscription.plan.planId,
        maxBuildings: subscription.plan.maxBuildings,
        maxUnits: subscription.plan.maxUnits,
        maxUsers: subscription.plan.maxUsers,
        maxOccupants: subscription.plan.maxOccupants,
        canExportReports: subscription.plan.canExportReports,
        canBulkOperations: subscription.plan.canBulkOperations,
        supportLevel: subscription.plan.supportLevel,
        monthlyPrice: subscription.plan.monthlyPrice,
      },
      usage: {
        buildings,
        units,
        users,
        residents,
      },
    };
  }

  /**
   * Obtiene audit logs del tenant con filtros opcionales.
   *
   * @param tenantId ID del tenant
   * @param filters Filtros: skip, take, action, dateFrom, dateTo
   */
  async getTenantAuditLogs(
    tenantId: string,
    filters: AuditLogFilter = {},
  ): Promise<AuditLogsResultResponse> {
    const { skip = 0, take = 10, action, dateFrom, dateTo } = filters;

    // Construir where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      tenantId,
    };

    if (action) {
      where.action = action;
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

    // Ejecutar queries paralelas
    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Mapear resultado
    const data = logs.map((log) => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      actorUserId: log.actorUserId,
      actorName: (log.actor as any)?.name ?? null,
      metadata: log.metadata as Record<string, unknown> | null,
      createdAt: log.createdAt,
    }));

    return { data, total };
  }
}

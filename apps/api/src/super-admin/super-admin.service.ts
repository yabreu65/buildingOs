import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { AuditAction, BillingPlanId } from '@prisma/client';

export interface TenantResponse {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export interface StatsResponse {
  totalTenants: number;
  totalUsers: number;
  tenantsByType: Record<string, number>;
  recentTenants: TenantResponse[];
}

export interface AuditLogResponse {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata: any;
  createdAt: string;
}

@Injectable()
export class SuperAdminService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private jwtService: JwtService,
  ) {}

  /**
   * Create new tenant with default subscription (TRIAL)
   * SECURITY: Only called by SuperAdminGuard-protected endpoints
   */
  async createTenant(
    dto: CreateTenantDto,
    actorUserId: string,
  ): Promise<TenantResponse> {
    // Check if name already exists
    const existing = await this.prisma.tenant.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `Tenant with name "${dto.name}" already exists`,
      );
    }

    // Transaction: create tenant + subscription
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          type: dto.type,
        },
      });

      // 2. Create default subscription (TRIAL on FREE plan)
      // First, ensure FREE plan exists
      const freePlan = await tx.billingPlan.findUnique({
        where: { planId: BillingPlanId.FREE },
      });
      if (!freePlan) {
        throw new Error('FREE plan not found. Run seed?');
      }

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: freePlan.id,
          status: 'TRIAL',
          trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        },
      });

      return tenant;
    });

    // Audit: TENANT_CREATE (fire-and-forget, after transaction)
    void this.auditService.createLog({
      tenantId: result.id,
      actorUserId,
      action: AuditAction.TENANT_CREATE,
      entityType: 'Tenant',
      entityId: result.id,
      metadata: { name: result.name, type: result.type },
    });

    return this.formatTenant(result);
  }

  /**
   * List all tenants (paginated, optional filter)
   */
  async listTenants(
    skip: number = 0,
    take: number = 20,
  ): Promise<{ data: TenantResponse[]; total: number }> {
    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count(),
    ]);

    return {
      data: tenants.map((t) => this.formatTenant(t)),
      total,
    };
  }

  /**
   * Get single tenant
   */
  async getTenant(tenantId: string): Promise<TenantResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    return this.formatTenant(tenant);
  }

  /**
   * Update tenant (name only for MVP)
   */
  async updateTenant(
    tenantId: string,
    dto: UpdateTenantDto,
    actorUserId: string,
  ): Promise<TenantResponse> {
    // Verify tenant exists
    const existing = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    // If changing name, check no other tenant has it
    if (dto.name && dto.name !== existing.name) {
      const conflict = await this.prisma.tenant.findUnique({
        where: { name: dto.name },
      });
      if (conflict) {
        throw new ConflictException(
          `Tenant with name "${dto.name}" already exists`,
        );
      }
    }

    // Update tenant
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.name && { name: dto.name }),
      },
    });

    // Audit: TENANT_UPDATE (fire-and-forget, after transaction)
    void this.auditService.createLog({
      tenantId: updated.id,
      actorUserId,
      action: AuditAction.TENANT_UPDATE,
      entityType: 'Tenant',
      entityId: updated.id,
      metadata: {
        before: { name: existing.name },
        after: { name: updated.name },
      },
    });

    return this.formatTenant(updated);
  }

  /**
   * Delete tenant (soft: mark in audit log, hard: cascade delete all data)
   * SECURITY: Irreversible. Require confirmation.
   */
  async deleteTenant(
    tenantId: string,
    actorUserId: string,
  ): Promise<void> {
    // Verify tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    // Audit: TENANT_DELETE (fire-and-forget, before deletion)
    void this.auditService.createLog({
      tenantId: tenant.id,
      actorUserId,
      action: AuditAction.TENANT_DELETE,
      entityType: 'Tenant',
      entityId: tenant.id,
      metadata: { name: tenant.name, type: tenant.type },
    });

    // Cascade delete all tenant data
    await this.prisma.tenant.delete({
      where: { id: tenantId },
    });
  }

  /**
   * Change tenant's subscription plan
   * SECURITY: Validates tenant exists, plan exists, usage vs new limits
   */
  async changePlan(
    tenantId: string,
    dto: ChangePlanDto,
    actorUserId: string,
  ) {
    // 1. Get current subscription
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new NotFoundException(`No subscription found for tenant "${tenantId}"`);
    }

    // 2. Validate new plan exists
    const newPlan = await this.prisma.billingPlan.findUnique({
      where: { planId: dto.newPlanId },
    });

    if (!newPlan) {
      throw new NotFoundException(`Plan "${dto.newPlanId}" not found`);
    }

    // 3. If downgrade: check usage vs new limits
    const oldPlanLimits = subscription.plan;
    if (
      newPlan.maxBuildings < oldPlanLimits.maxBuildings ||
      newPlan.maxUnits < oldPlanLimits.maxUnits ||
      newPlan.maxUsers < oldPlanLimits.maxUsers ||
      newPlan.maxOccupants < oldPlanLimits.maxOccupants
    ) {
      // Downgrade: validate usage doesn't exceed new limits
      const [buildingCount, unitCount, userCount, occupantCount] = await Promise.all([
        this.prisma.building.count({ where: { tenantId } }),
        this.prisma.unit.count({ where: { building: { tenantId } } }),
        this.prisma.membership.count({ where: { tenantId } }),
        this.prisma.unitOccupant.count({
          where: { unit: { building: { tenantId } } },
        }),
      ]);

      if (buildingCount > newPlan.maxBuildings) {
        throw new ConflictException(
          `Cannot downgrade: tenant has ${buildingCount} buildings, new plan allows max ${newPlan.maxBuildings}`,
        );
      }
      if (unitCount > newPlan.maxUnits) {
        throw new ConflictException(
          `Cannot downgrade: tenant has ${unitCount} units, new plan allows max ${newPlan.maxUnits}`,
        );
      }
      if (userCount > newPlan.maxUsers) {
        throw new ConflictException(
          `Cannot downgrade: tenant has ${userCount} users, new plan allows max ${newPlan.maxUsers}`,
        );
      }
      if (occupantCount > newPlan.maxOccupants) {
        throw new ConflictException(
          `Cannot downgrade: tenant has ${occupantCount} occupants, new plan allows max ${newPlan.maxOccupants}`,
        );
      }
    }

    // 4. Update subscription in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Update subscription
      const updated = await tx.subscription.update({
        where: { tenantId },
        data: {
          planId: newPlan.id,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: null,
        },
        include: { plan: true },
      });

      // Log event
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: updated.id,
          eventType:
            newPlan.id === subscription.planId
              ? 'RENEWED'
              : newPlan.id > subscription.planId
                ? 'UPGRADED'
                : 'DOWNGRADED',
          prevPlanId: subscription.planId,
          newPlanId: newPlan.id,
          metadata: {
            prevPlanName: subscription.plan.name,
            newPlanName: newPlan.name,
          },
        },
      });

      return updated;
    });

    // Audit: SUBSCRIPTION_UPDATE (fire-and-forget, after transaction)
    void this.auditService.createLog({
      tenantId,
      actorUserId,
      action: AuditAction.SUBSCRIPTION_UPDATE,
      entityType: 'Subscription',
      entityId: result.id,
      metadata: {
        prevPlanId: subscription.planId,
        newPlanId: newPlan.id,
        prevPlanName: subscription.plan.name,
        newPlanName: newPlan.name,
      },
    });

    return {
      id: result.id,
      tenantId: result.tenantId,
      planId: result.planId,
      status: result.status,
      planName: result.plan.name,
      currentPeriodStart: result.currentPeriodStart.toISOString(),
      currentPeriodEnd: result.currentPeriodEnd?.toISOString() ?? null,
    };
  }

  /**
   * Get global stats for SUPER_ADMIN dashboard
   */
  async getStats(): Promise<StatsResponse> {
    const [totalTenants, totalUsers, recentTenants] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count(),
      this.prisma.tenant.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Count tenants by type
    const tenantsByTypeRaw = await this.prisma.tenant.groupBy({
      by: ['type'],
      _count: true,
    });

    const tenantsByType = tenantsByTypeRaw.reduce(
      (acc, curr) => {
        acc[curr.type] = curr._count;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalTenants,
      totalUsers,
      tenantsByType,
      recentTenants: recentTenants.map((t) => this.formatTenant(t)),
    };
  }

  /**
   * Get audit logs with optional filters
   */
  async getAuditLogs(
    skip: number = 0,
    take: number = 50,
    filters?: {
      tenantId?: string;
      actorUserId?: string;
      action?: string;
      dateFrom?: Date;
      dateTo?: Date;
    },
  ): Promise<{ data: AuditLogResponse[]; total: number }> {
    const where: any = {};

    if (filters?.tenantId) where.tenantId = filters.tenantId;
    if (filters?.actorUserId) where.actorUserId = filters.actorUserId;
    if (filters?.action) where.action = filters.action;
    if (filters?.dateFrom || filters?.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
      if (filters.dateTo) where.createdAt.lte = filters.dateTo;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs.map((log) => this.formatAuditLog(log)),
      total,
    };
  }

  /**
   * Start impersonation: mint a short-lived token with isImpersonating flag
   * SECURITY: Only called by SuperAdminGuard-protected endpoints
   */
  async startImpersonation(
    tenantId: string,
    actorUserId: string,
  ): Promise<{
    impersonationToken: string;
    expiresAt: string;
    tenant: { id: string; name: string };
  }> {
    // 1. Validate tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant "${tenantId}" not found`);
    }

    // 2. Fetch actor's email (needed for token payload)
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { email: true },
    });
    if (!actor) {
      throw new NotFoundException('Actor user not found');
    }

    // 3. Sign impersonation token (60 min expiry)
    const expiresIn = 60 * 60; // 60 minutes in seconds
    const impersonationToken = this.jwtService.sign(
      {
        sub: actorUserId,
        email: actor.email,
        isSuperAdmin: false, // NOT super admin in tenant context
        isImpersonating: true,
        impersonatedTenantId: tenantId,
        actorSuperAdminUserId: actorUserId,
      },
      { expiresIn: `${expiresIn}s` },
    );

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 4. Audit: IMPERSONATION_START
    void this.auditService.createLog({
      actorUserId,
      action: AuditAction.IMPERSONATION_START,
      entityType: 'Tenant',
      entityId: tenantId,
      metadata: {
        targetTenantId: tenantId,
        targetTenantName: tenant.name,
        expiresAt,
      },
    });

    return {
      impersonationToken,
      expiresAt,
      tenant: { id: tenant.id, name: tenant.name },
    };
  }

  /**
   * End impersonation: audit the end event
   * Token invalidation is client-side (clear storage) + natural JWT expiry
   */
  async endImpersonation(
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: boolean }> {
    // Just audit the end event
    void this.auditService.createLog({
      actorUserId,
      action: AuditAction.IMPERSONATION_END,
      entityType: 'Tenant',
      entityId: tenantId,
      metadata: { targetTenantId: tenantId },
    });

    return { ok: true };
  }

  /**
   * Get impersonation status from JWT claims
   */
  async getImpersonationStatus(req: any): Promise<{
    isImpersonating: boolean;
    tenantId?: string;
    expiresAt?: string;
  }> {
    const user = req.user;
    if (!user?.isImpersonating) {
      return { isImpersonating: false };
    }
    return {
      isImpersonating: true,
      tenantId: user.impersonatedTenantId,
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private formatTenant(tenant: any): TenantResponse {
    return {
      id: tenant.id,
      name: tenant.name,
      type: tenant.type,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }

  private formatAuditLog(log: any): AuditLogResponse {
    return {
      id: log.id,
      tenantId: log.tenantId,
      actorUserId: log.actorUserId,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString(),
    };
  }
}

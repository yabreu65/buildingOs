import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { AuditAction, BillingPlanId, Tenant, AuditLog, Prisma } from '@prisma/client';
import { AuthenticatedRequest } from '../common/types/request.types';

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
  metadata: Record<string, unknown>;
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
      entity: 'Tenant',
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
      entity: 'Tenant',
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
      entity: 'Tenant',
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
      entity: 'Subscription',
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
    const where: Prisma.AuditLogWhereInput = {};

    if (filters?.tenantId) where.tenantId = filters.tenantId;
    if (filters?.actorUserId) where.actorUserId = filters.actorUserId;
    if (filters?.action) where.action = filters.action as AuditAction;
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
      entity: 'Tenant',
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
      entity: 'Tenant',
      entityId: tenantId,
      metadata: { targetTenantId: tenantId },
    });

    return { ok: true };
  }

  /**
   * Get impersonation status from JWT claims
   */
  async getImpersonationStatus(req: AuthenticatedRequest): Promise<{
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

  /**
   * List all platform users (SUPER_ADMIN role)
   */
  async listPlatformUsers(): Promise<
    Array<{ id: string; name: string; email: string; createdAt: string }>
  > {
    const users = await this.prisma.user.findMany({
      where: {
        memberships: {
          some: {
            roles: {
              some: {
                role: 'SUPER_ADMIN',
              },
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  /**
   * Create new platform user (SUPER_ADMIN)
   * SECURITY: Only the FOUNDER (first SUPER_ADMIN) can create other SUPER_ADMINS
   */
  async createPlatformUser(
    dto: CreatePlatformUserDto,
    creatorId: string,
  ): Promise<{ id: string; email: string; name: string }> {
    const { email, name, password } = dto;

    // Verify creator is the founder (first/oldest SUPER_ADMIN)
    const founder = await this.prisma.user.findFirst({
      where: {
        memberships: {
          some: {
            roles: {
              some: {
                role: 'SUPER_ADMIN',
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!founder || founder.id !== creatorId) {
      throw new ForbiddenException(
        'Solo el founder puede crear nuevos super admins',
      );
    }

    // Check if email exists
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user + membership + SUPER_ADMIN role in transaction
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          name,
          passwordHash: hashedPassword,
        },
      });

      // Get or create platform tenant for super admins
      let platformTenant = await tx.tenant.findFirst({
        where: { name: 'BuildingOS Platform' },
      });

      if (!platformTenant) {
        platformTenant = await tx.tenant.create({
          data: {
            name: 'BuildingOS Platform',
            type: 'ADMINISTRADORA',
            status: 'ACTIVE',
            plan: 'ENTERPRISE',
            billingCycleStartDate: new Date(),
          },
        });
      }

      // Create membership with SUPER_ADMIN role
      await tx.membership.create({
        data: {
          userId: newUser.id,
          tenantId: platformTenant.id,
          roles: {
            create: {
              role: 'SUPER_ADMIN',
            },
          },
        },
      });

      return newUser;
    });

    // Audit log
    void this.auditService.createLog({
      action: AuditAction.USER_CREATE,
      entity: 'User',
      entityId: user.id,
      actorUserId: creatorId,
      metadata: { email, name, scope: 'SUPER_ADMIN' },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }

  /**
   * Delete platform user (revoke SUPER_ADMIN access)
   */
  async deletePlatformUser(userId: string, actorId: string): Promise<void> {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Remove SUPER_ADMIN role from all memberships
    await this.prisma.membershipRole.deleteMany({
      where: {
        membership: {
          userId,
        },
        role: 'SUPER_ADMIN',
      },
    });

    // Audit log
    void this.auditService.createLog({
      action: AuditAction.USER_DELETE,
      entity: 'User',
      entityId: userId,
      actorUserId: actorId,
      metadata: { email: user.email, name: user.name, scope: 'SUPER_ADMIN' },
    });
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private formatTenant(tenant: Tenant): TenantResponse {
    return {
      id: tenant.id,
      name: tenant.name,
      type: tenant.type,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }

  private formatAuditLog(log: AuditLog): AuditLogResponse {
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

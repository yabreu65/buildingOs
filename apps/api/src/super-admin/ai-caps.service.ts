import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAiOverrideDto } from './dto/update-ai-override.dto';

export interface AiCapsResponse {
  planCaps: {
    budgetCents: number;
    callsLimit: number;
    allowBigModel: boolean;
  };
  overrides: {
    monthlyBudgetCents: number | null;
    monthlyCallsLimit: number | null;
    allowBigModelOverride: boolean | null;
  };
  effectiveLimits: {
    budgetCents: number;
    callsLimit: number;
    allowBigModel: boolean;
  };
}

@Injectable()
export class AiCapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getAiCaps(tenantId: string): Promise<AiCapsResponse> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new NotFoundException(`No subscription found for tenant "${tenantId}"`);
    }

    const plan = subscription.plan;
    const budget = await this.prisma.tenantAiBudget.findUnique({
      where: { tenantId },
    });

    const effectiveBudget = budget?.monthlyBudgetCents ?? plan.aiBudgetCents;
    const effectiveCallsLimit = budget?.monthlyCallsLimit ?? plan.aiCallsMonthlyLimit;
    const effectiveBigModel = budget?.allowBigModelOverride ?? plan.aiAllowBigModel;

    return {
      planCaps: {
        budgetCents: plan.aiBudgetCents,
        callsLimit: plan.aiCallsMonthlyLimit,
        allowBigModel: plan.aiAllowBigModel,
      },
      overrides: {
        monthlyBudgetCents: budget?.monthlyBudgetCents ?? null,
        monthlyCallsLimit: budget?.monthlyCallsLimit ?? null,
        allowBigModelOverride: budget?.allowBigModelOverride ?? null,
      },
      effectiveLimits: {
        budgetCents: effectiveBudget,
        callsLimit: effectiveCallsLimit,
        allowBigModel: effectiveBigModel,
      },
    };
  }

  async updateAiCaps(
    tenantId: string,
    dto: UpdateAiOverrideDto,
    actorUserId: string,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    const before = await this.prisma.tenantAiBudget.findUnique({
      where: { tenantId },
    });

    const updateData: {
      monthlyBudgetCents?: number;
      monthlyCallsLimit?: number;
      allowBigModelOverride?: boolean;
    } = {};

    if (dto.monthlyBudgetCents !== undefined) {
      updateData.monthlyBudgetCents = dto.monthlyBudgetCents;
    }
    if (dto.monthlyCallsLimit !== undefined) {
      updateData.monthlyCallsLimit = dto.monthlyCallsLimit;
    }
    if (dto.allowBigModelOverride !== undefined) {
      updateData.allowBigModelOverride = dto.allowBigModelOverride;
    }

    const after = await this.prisma.tenantAiBudget.upsert({
      where: { tenantId },
      update: updateData,
      create: {
        tenantId,
        ...updateData,
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorUserId,
      action: AuditAction.AI_TENANT_OVERRIDE_UPDATED,
      entityType: 'TenantAiBudget',
      entityId: after.id,
      metadata: {
        before: {
          monthlyBudgetCents: before?.monthlyBudgetCents,
          monthlyCallsLimit: before?.monthlyCallsLimit,
          allowBigModelOverride: before?.allowBigModelOverride,
        },
        after: {
          monthlyBudgetCents: after.monthlyBudgetCents,
          monthlyCallsLimit: after.monthlyCallsLimit,
          allowBigModelOverride: after.allowBigModelOverride,
        },
      },
    });
  }
}

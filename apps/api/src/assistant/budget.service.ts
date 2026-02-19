/**
 * AI Budget Service
 *
 * Manages AI budget tracking, enforcement, and warnings per tenant.
 * - Tracks monthly usage (calls, tokens, estimated cost)
 * - Enforces hard stop when budget exceeded
 * - Supports soft degrade (mock response fallback)
 * - Warns at 80% threshold
 * - Supports plan-based limits with tenant overrides (Phase 13)
 */

import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import {
  calculateTokenCost,
  getCurrentMonth,
  getPercentUsed,
  isWarningThreshold,
  isBudgetExceeded,
} from './pricing';

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  budgetCents: number;
  usedCents: number;
  remainingCents: number;
  percentUsed: number;
  warnedNow?: boolean;
  blockedNow?: boolean;
  blockedAt?: Date | null;
}

export interface CallsLimitResult {
  allowed: boolean;
  callsUsed: number;
  callsLimit: number;
  percentUsed: number;
  warnedNow?: boolean;
  blockedNow?: boolean;
}

export interface EffectiveLimits {
  budgetCents: number;
  callsLimit: number;
  allowBigModel: boolean;
}

export interface UsageUpdate {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageData {
  month: string;
  budgetCents: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostCents: number;
  warnedAt?: Date;
  blockedAt?: Date;
  callsWarnedAt?: Date;
  percentUsed: number;
  callsPercent: number;
}

export interface UsageWithLimits extends UsageData {
  limits: EffectiveLimits;
}

@Injectable()
export class AiBudgetService {
  private readonly warnThreshold: number;
  private readonly softDegradeOnExceeded: boolean;
  private readonly defaultBudgetCents: number;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {
    this.warnThreshold = parseFloat(process.env.AI_BUDGET_WARN_THRESHOLD || '0.8');
    this.softDegradeOnExceeded =
      process.env.AI_SOFT_DEGRADE_ON_EXCEEDED === 'true';
    this.defaultBudgetCents = parseInt(
      process.env.AI_DEFAULT_TENANT_BUDGET_CENTS || '500',
      10,
    );
  }

  /**
   * Phase 13: Get effective limits for tenant (plan caps + overrides)
   */
  async getEffectiveLimits(tenantId: string): Promise<EffectiveLimits> {
    try {
      // Fetch subscription with plan
      const subscription = await this.prisma.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });

      const plan = subscription?.plan;

      // Fetch tenant-specific overrides
      const budget = await this.getOrCreateBudget(tenantId);

      // Resolve: override ?? plan ?? env_default
      return {
        budgetCents: budget.monthlyBudgetCents ?? plan?.aiBudgetCents ?? this.defaultBudgetCents,
        callsLimit: budget.monthlyCallsLimit ?? plan?.aiCallsMonthlyLimit ?? 100,
        allowBigModel: budget.allowBigModelOverride ?? plan?.aiAllowBigModel ?? false,
      };
    } catch (error) {
      // Fallback on error (fire-and-forget pattern)
      console.error('Failed to get effective limits:', error);
      return {
        budgetCents: this.defaultBudgetCents,
        callsLimit: 100,
        allowBigModel: false,
      };
    }
  }

  /**
   * Check if tenant can make an AI request
   * Enforces hard stop or soft degrade based on config
   * Now uses plan-based budget caps
   */
  async checkBudget(tenantId: string): Promise<BudgetCheckResult> {
    // Get or create budget for tenant
    const budget = await this.getOrCreateBudget(tenantId);

    // Get effective budget from plan + overrides
    const limits = await this.getEffectiveLimits(tenantId);

    // Get or create usage for current month
    const month = getCurrentMonth();
    const usage = await this.getOrCreateMonthlyUsage(tenantId, budget.id, month);

    const { estimatedCostCents } = usage;
    const { budgetCents: monthlyBudgetCents } = limits;

    // Check if blocked
    if (usage.blockedAt !== null) {
      return {
        allowed: this.softDegradeOnExceeded,
        reason: 'AI_BUDGET_EXCEEDED',
        budgetCents: monthlyBudgetCents,
        usedCents: estimatedCostCents,
        remainingCents: Math.max(0, monthlyBudgetCents - estimatedCostCents),
        percentUsed: getPercentUsed(estimatedCostCents, monthlyBudgetCents),
      };
    }

    // Check if exceeded
    if (isBudgetExceeded(estimatedCostCents, monthlyBudgetCents)) {
      // Mark as blocked
      await this.prisma.tenantMonthlyAiUsage.update({
        where: { id: usage.id },
        data: { blockedAt: new Date() },
      });

      // Audit
      void this.audit.createLog({
        tenantId,
        action: AuditAction.AI_BUDGET_BLOCKED,
        entityType: 'TenantAiBudget',
        entityId: budget.id,
        metadata: {
          month,
          budgetCents: monthlyBudgetCents,
          usedCents: estimatedCostCents,
        },
      });

      return {
        allowed: this.softDegradeOnExceeded,
        reason: 'AI_BUDGET_EXCEEDED',
        budgetCents: monthlyBudgetCents,
        usedCents: estimatedCostCents,
        remainingCents: 0,
        percentUsed: 100,
        blockedNow: true,
      };
    }

    // Check warning threshold
    let warnedNow = false;
    if (
      isWarningThreshold(estimatedCostCents, monthlyBudgetCents, this.warnThreshold) &&
      usage.warnedAt === null
    ) {
      // Mark as warned
      await this.prisma.tenantMonthlyAiUsage.update({
        where: { id: usage.id },
        data: { warnedAt: new Date() },
      });

      // Audit
      void this.audit.createLog({
        tenantId,
        action: AuditAction.AI_BUDGET_WARNED,
        entityType: 'TenantAiBudget',
        entityId: budget.id,
        metadata: {
          month,
          budgetCents: monthlyBudgetCents,
          usedCents: estimatedCostCents,
          threshold: this.warnThreshold,
        },
      });

      warnedNow = true;
    }

    return {
      allowed: true,
      budgetCents: monthlyBudgetCents,
      usedCents: estimatedCostCents,
      remainingCents: monthlyBudgetCents - estimatedCostCents,
      percentUsed: getPercentUsed(estimatedCostCents, monthlyBudgetCents),
      warnedNow,
    };
  }

  /**
   * Phase 13: Check if tenant has reached calls limit
   */
  async checkCallsLimit(tenantId: string): Promise<CallsLimitResult> {
    const limits = await this.getEffectiveLimits(tenantId);

    // If callsLimit is 0 or >= 9999, treat as unlimited
    if (limits.callsLimit === 0 || limits.callsLimit >= 9999) {
      return {
        allowed: true,
        callsUsed: 0,
        callsLimit: limits.callsLimit,
        percentUsed: 0,
      };
    }

    // Get budget and current month usage
    const budget = await this.getOrCreateBudget(tenantId);
    const month = getCurrentMonth();
    const usage = await this.getOrCreateMonthlyUsage(tenantId, budget.id, month);

    const { calls } = usage;
    const callsLimit = limits.callsLimit;
    const percentUsed = (calls / callsLimit) * 100;

    // If already blocked, return immediately
    if (usage.blockedAt !== null) {
      return {
        allowed: this.softDegradeOnExceeded,
        callsUsed: calls,
        callsLimit,
        percentUsed: 100,
        blockedNow: false,
      };
    }

    // If exceeded now, block
    if (calls >= callsLimit) {
      await this.prisma.tenantMonthlyAiUsage.update({
        where: { id: usage.id },
        data: { blockedAt: new Date() },
      });

      // Audit
      void this.audit.createLog({
        tenantId,
        action: AuditAction.AI_LIMIT_BLOCKED,
        entityType: 'TenantAiBudget',
        entityId: budget.id,
        metadata: {
          month,
          callsUsed: calls,
          callsLimit,
          limitType: 'CALLS',
        },
      });

      return {
        allowed: this.softDegradeOnExceeded,
        callsUsed: calls,
        callsLimit,
        percentUsed: 100,
        blockedNow: true,
      };
    }

    // Check warning threshold (80%)
    let warnedNow = false;
    if (percentUsed >= 80 && usage.callsWarnedAt === null) {
      await this.prisma.tenantMonthlyAiUsage.update({
        where: { id: usage.id },
        data: { callsWarnedAt: new Date() },
      });

      // Audit
      void this.audit.createLog({
        tenantId,
        action: AuditAction.AI_LIMIT_WARNED,
        entityType: 'TenantAiBudget',
        entityId: budget.id,
        metadata: {
          month,
          callsUsed: calls,
          callsLimit,
          threshold: this.warnThreshold,
          limitType: 'CALLS',
        },
      });

      warnedNow = true;
    }

    return {
      allowed: true,
      callsUsed: calls,
      callsLimit,
      percentUsed,
      warnedNow,
    };
  }

  /**
   * Track usage after AI response is received
   * Increments calls counter and cost
   */
  async trackUsage(tenantId: string, update: UsageUpdate): Promise<void> {
    const budget = await this.getOrCreateBudget(tenantId);
    const month = getCurrentMonth();
    const usage = await this.getOrCreateMonthlyUsage(tenantId, budget.id, month);

    // Calculate cost
    const { costCents } = calculateTokenCost(
      update.model,
      update.inputTokens,
      update.outputTokens,
    );

    // Update usage (always increment calls counter)
    await this.prisma.tenantMonthlyAiUsage.update({
      where: { id: usage.id },
      data: {
        calls: {
          increment: 1, // Increment calls counter for Phase 13
        },
        inputTokens: {
          increment: update.inputTokens,
        },
        outputTokens: {
          increment: update.outputTokens,
        },
        estimatedCostCents: {
          increment: costCents,
        },
      },
    });
  }

  /**
   * Get usage data for display/UI
   * Now includes calls counter with percentage
   */
  async getUsageData(tenantId: string, month?: string): Promise<UsageData> {
    const budget = await this.getOrCreateBudget(tenantId);
    const limits = await this.getEffectiveLimits(tenantId);
    const targetMonth = month || getCurrentMonth();
    const usage = await this.getOrCreateMonthlyUsage(tenantId, budget.id, targetMonth);

    const callsPercent =
      limits.callsLimit === 0 || limits.callsLimit >= 9999
        ? 0
        : (usage.calls / limits.callsLimit) * 100;

    return {
      month: targetMonth,
      budgetCents: limits.budgetCents,
      calls: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostCents: usage.estimatedCostCents,
      warnedAt: usage.warnedAt || undefined,
      blockedAt: usage.blockedAt || undefined,
      callsWarnedAt: usage.callsWarnedAt || undefined,
      percentUsed: getPercentUsed(usage.estimatedCostCents, limits.budgetCents),
      callsPercent,
    };
  }

  /**
   * Get usage data with effective limits (for frontend dashboard)
   */
  async getUsageWithLimits(tenantId: string, month?: string): Promise<UsageWithLimits> {
    const usageData = await this.getUsageData(tenantId, month);
    const limits = await this.getEffectiveLimits(tenantId);

    return {
      ...usageData,
      limits,
    };
  }

  /**
   * Update budget for tenant (SUPER_ADMIN only)
   */
  async updateBudget(
    tenantId: string,
    newBudgetCents: number,
    actorUserId?: string,
  ): Promise<void> {
    // Validate reasonable limits
    if (newBudgetCents < 0 || newBudgetCents > 500000) {
      throw new BadRequestException('Budget must be between 0 and 5000 dollars');
    }

    const budget = await this.getOrCreateBudget(tenantId);

    // Update
    await this.prisma.tenantAiBudget.update({
      where: { id: budget.id },
      data: { monthlyBudgetCents: newBudgetCents },
    });

    // Audit
    void this.audit.createLog({
      tenantId,
      actorUserId,
      action: AuditAction.AI_BUDGET_UPDATED,
      entityType: 'TenantAiBudget',
      entityId: budget.id,
      metadata: {
        previousBudgetCents: budget.monthlyBudgetCents,
        newBudgetCents,
      },
    });
  }

  /**
   * Degrade response (fire-and-forget audit)
   */
  async logDegradedResponse(tenantId: string, reason: string): Promise<void> {
    try {
      await this.audit.createLog({
        tenantId,
        action: AuditAction.AI_DEGRADED_BUDGET,
        entityType: 'AiInteraction',
        entityId: tenantId,
        metadata: { reason },
      });
    } catch (error) {
      console.error('Failed to log degraded response:', error);
    }
  }

  /**
   * Private: Get or create budget for tenant
   */
  private async getOrCreateBudget(tenantId: string) {
    return this.prisma.tenantAiBudget.upsert({
      where: { tenantId },
      update: {},
      create: {
        tenantId,
        monthlyBudgetCents: this.defaultBudgetCents,
      },
    });
  }

  /**
   * Private: Get or create monthly usage for tenant
   */
  private async getOrCreateMonthlyUsage(
    tenantId: string,
    budgetId: string,
    month: string,
  ) {
    return this.prisma.tenantMonthlyAiUsage.upsert({
      where: {
        tenantId_month: {
          tenantId,
          month,
        },
      },
      update: {},
      create: {
        tenantId,
        budgetId,
        month,
      },
    });
  }
}

/**
 * AI Budget Service
 *
 * Manages AI budget tracking, enforcement, and warnings per tenant.
 * - Tracks monthly usage (calls, tokens, estimated cost)
 * - Enforces hard stop when budget exceeded
 * - Supports soft degrade (mock response fallback)
 * - Warns at 80% threshold
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
  percentUsed: number;
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
   * Check if tenant can make an AI request
   * Enforces hard stop or soft degrade based on config
   */
  async checkBudget(tenantId: string): Promise<BudgetCheckResult> {
    // Get or create budget for tenant
    const budget = await this.getOrCreateBudget(tenantId);

    // Get or create usage for current month
    const month = getCurrentMonth();
    const usage = await this.getOrCreateMonthlyUsage(tenantId, budget.id, month);

    const { estimatedCostCents } = usage;
    const { monthlyBudgetCents } = budget;

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
   * Track usage after AI response is received
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

    // Update usage
    await this.prisma.tenantMonthlyAiUsage.update({
      where: { id: usage.id },
      data: {
        calls: {
          increment: 1,
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
   */
  async getUsageData(tenantId: string, month?: string): Promise<UsageData> {
    const budget = await this.getOrCreateBudget(tenantId);
    const targetMonth = month || getCurrentMonth();
    const usage = await this.getOrCreateMonthlyUsage(tenantId, budget.id, targetMonth);

    return {
      month: targetMonth,
      budgetCents: budget.monthlyBudgetCents,
      calls: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostCents: usage.estimatedCostCents,
      warnedAt: usage.warnedAt || undefined,
      blockedAt: usage.blockedAt || undefined,
      percentUsed: getPercentUsed(usage.estimatedCostCents, budget.monthlyBudgetCents),
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

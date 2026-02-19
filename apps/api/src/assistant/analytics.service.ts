import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantAnalyticsResponse {
  month: string;
  usage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostCents: number;
    budgetCents: number;
    percentUsed: number;
  };
  efficiency: {
    totalInteractions: number;
    cacheHits: number;
    cacheHitRate: number;
    smallCalls: number;
    bigCalls: number;
    mockCalls: number;
  };
  adoption: {
    uniqueUsers: number;
    interactionsByPage: Array<{ page: string; count: number }>;
  };
  templates: Array<{ templateKey: string; runs: number }>;
  actions: Array<{ actionType: string; clicks: number }>;
}

export interface TenantSummaryItem {
  tenantId: string;
  name: string;
  planId: string;
  calls: number;
  estimatedCostCents: number;
  budgetCents: number;
  percentUsed: number;
  atRisk: boolean; // >= 80%
}

export interface TenantDetailedAnalytics extends TenantAnalyticsResponse {
  tenantId: string;
  tenantName: string;
}

@Injectable()
export class AiAnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get analytics for a specific tenant (current month)
   */
  async getTenantAnalytics(tenantId: string, month?: string): Promise<TenantAnalyticsResponse> {
    const currentMonth = month || this.getCurrentMonth();
    const { startDate, endDate } = this.getMonthRange(currentMonth);

    // Usage data from TenantMonthlyAiUsage
    const monthlyUsage = await this.prisma.tenantMonthlyAiUsage.findFirst({
      where: {
        tenantId,
        month: currentMonth,
      },
    });

    const budget = await this.prisma.tenantAiBudget.findUnique({
      where: { tenantId },
    });

    const calls = monthlyUsage?.calls ?? 0;
    const estimatedCostCents = monthlyUsage?.estimatedCostCents ?? 0;
    const budgetCents = budget?.monthlyBudgetCents ?? 500;
    const percentUsed = budgetCents > 0 ? Math.round((estimatedCostCents / budgetCents) * 100) : 0;

    // Efficiency metrics from AiInteractionLog
    const [totalInteractions, cacheHits, smallCalls, bigCalls, mockCalls] = await Promise.all([
      this.prisma.aiInteractionLog.count({
        where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      }),
      this.prisma.aiInteractionLog.count({
        where: { tenantId, cacheHit: true, createdAt: { gte: startDate, lte: endDate } },
      }),
      this.prisma.aiInteractionLog.count({
        where: { tenantId, modelSize: 'SMALL', createdAt: { gte: startDate, lte: endDate } },
      }),
      this.prisma.aiInteractionLog.count({
        where: { tenantId, modelSize: 'BIG', createdAt: { gte: startDate, lte: endDate } },
      }),
      this.prisma.aiInteractionLog.count({
        where: { tenantId, modelSize: 'MOCK', createdAt: { gte: startDate, lte: endDate } },
      }),
    ]);

    const cacheHitRate = totalInteractions > 0 ? Math.round((cacheHits / totalInteractions) * 100) : 0;

    // Adoption by page (indexed column for efficiency)
    const byPage = await this.prisma.aiInteractionLog.groupBy({
      by: ['page'],
      _count: { id: true },
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    // Unique users
    const uniqueUsersResult = await this.prisma.aiInteractionLog.findMany({
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      select: { userId: true },
      distinct: ['userId'],
    });

    // Templates from AuditLog (if available)
    const templatesResult = await this.prisma.$queryRaw<
      Array<{ templateKey: string; runs: bigint }>
    >`
      SELECT metadata->>'templateKey' as "templateKey", COUNT(*) as runs
      FROM "AuditLog"
      WHERE "tenantId" = ${tenantId}
        AND action = 'AI_TEMPLATE_RUN'
        AND "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
      GROUP BY metadata->>'templateKey'
      ORDER BY runs DESC LIMIT 10
    `;

    // Actions from AiActionEvent
    const actions = await this.prisma.aiActionEvent.groupBy({
      by: ['actionType'],
      _count: { id: true },
      where: { tenantId, clickedAt: { gte: startDate, lte: endDate } },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    return {
      month: currentMonth,
      usage: {
        calls,
        inputTokens: monthlyUsage?.inputTokens ?? 0,
        outputTokens: monthlyUsage?.outputTokens ?? 0,
        estimatedCostCents,
        budgetCents,
        percentUsed,
      },
      efficiency: {
        totalInteractions,
        cacheHits,
        cacheHitRate,
        smallCalls,
        bigCalls,
        mockCalls,
      },
      adoption: {
        uniqueUsers: uniqueUsersResult.length,
        interactionsByPage: byPage.map((row) => ({
          page: row.page ?? 'unknown',
          count: row._count.id,
        })),
      },
      templates: templatesResult.map((row) => ({
        templateKey: row.templateKey ?? 'unknown',
        runs: Number(row.runs),
      })),
      actions: actions.map((row) => ({
        actionType: row.actionType,
        clicks: row._count.id,
      })),
    };
  }

  /**
   * Get analytics for all tenants (super-admin view)
   */
  async getAllTenantsAnalytics(month?: string): Promise<TenantSummaryItem[]> {
    const currentMonth = month || this.getCurrentMonth();
    const { startDate, endDate } = this.getMonthRange(currentMonth);

    const results = await this.prisma.$queryRaw<
      Array<{
        tenantId: string;
        name: string;
        planId: string;
        calls: number;
        estimatedCostCents: number;
        budgetCents: number;
        percentUsed: number;
      }>
    >`
      SELECT
        t.id as "tenantId",
        t.name,
        s."planId",
        COALESCE(u.calls, 0) as calls,
        COALESCE(u."estimatedCostCents", 0) as "estimatedCostCents",
        b."monthlyBudgetCents" as "budgetCents",
        CASE WHEN b."monthlyBudgetCents" > 0
          THEN ROUND(COALESCE(u."estimatedCostCents", 0)::decimal / b."monthlyBudgetCents" * 100, 1)
          ELSE 0 END as "percentUsed"
      FROM "Tenant" t
      LEFT JOIN "TenantMonthlyAiUsage" u ON u."tenantId" = t.id AND u.month = ${currentMonth}
      LEFT JOIN "TenantAiBudget" b ON b."tenantId" = t.id
      LEFT JOIN "Subscription" s ON s."tenantId" = t.id AND s.status = 'ACTIVE'
      ORDER BY COALESCE(u."estimatedCostCents", 0) DESC
      LIMIT 100
    `;

    return results.map((row) => ({
      tenantId: row.tenantId,
      name: row.name,
      planId: row.planId,
      calls: row.calls,
      estimatedCostCents: row.estimatedCostCents,
      budgetCents: row.budgetCents,
      percentUsed: Math.round(row.percentUsed),
      atRisk: row.percentUsed >= 80,
    }));
  }

  /**
   * Get detailed analytics for a specific tenant (super-admin view)
   */
  async getTenantDetailedAnalytics(
    tenantId: string,
    month?: string,
  ): Promise<TenantDetailedAnalytics> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const analytics = await this.getTenantAnalytics(tenantId, month);

    return {
      ...analytics,
      tenantId,
      tenantName: tenant.name,
    };
  }

  /**
   * Helper: Get current month in YYYY-MM format
   */
  private getCurrentMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Helper: Get start and end dates for a month
   */
  private getMonthRange(month: string): { startDate: Date; endDate: Date } {
    const [year, monthStr] = month.split('-').map(Number);
    const startDate = new Date(year, monthStr - 1, 1);
    const endDate = new Date(year, monthStr, 0, 23, 59, 59, 999);
    return { startDate, endDate };
  }
}

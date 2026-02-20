import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { AiBudgetService } from './budget.service';
import { getCurrentMonth } from './pricing';

export type AiNudgeSeverity = 'INFO' | 'WARN' | 'BLOCK';

export interface AiNudgeCta {
  label: string;
  action: string;
  href?: string;
}

export interface AiNudge {
  key:
    | 'NUDGE_80'
    | 'NUDGE_100'
    | 'NUDGE_REPEAT'
    | 'NUDGE_BIG_USAGE'
    | 'NUDGE_TEMPLATE_VALUE';
  severity: AiNudgeSeverity;
  title: string;
  message: string;
  dismissible: boolean;
  ctas: AiNudgeCta[];
}

interface MembershipLike {
  id?: string;
  tenantId: string;
  roles: string[];
}

interface UserLike {
  id: string;
  memberships?: MembershipLike[];
}

@Injectable()
export class AiNudgesService {
  private readonly dismissCooldownMs = 7 * 24 * 60 * 60 * 1000;
  private readonly templateUpsellThreshold = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AiBudgetService,
    private readonly audit: AuditService,
  ) {}

  resolveTenantId(user: UserLike, requestedTenantId?: string): string {
    const memberships = user.memberships ?? [];
    if (requestedTenantId) {
      const hasAccess = memberships.some((m) => m.tenantId === requestedTenantId);
      if (!hasAccess) {
        throw new ForbiddenException('No tienes acceso al tenant indicado');
      }
      return requestedTenantId;
    }

    if (memberships.length === 1) {
      return memberships[0].tenantId;
    }

    throw new BadRequestException(
      'tenantId requerido (header X-Tenant-Id) cuando el usuario tiene múltiples tenants',
    );
  }

  async getActiveNudges(user: UserLike, tenantId: string): Promise<AiNudge[]> {
    const membership = await this.getMembership(user.id, tenantId);
    const month = getCurrentMonth();
    const previousMonth = this.getPreviousMonth(month);

    const [usage, limits, subscription, currentMonthUsage, previousMonthUsage, analytics] =
      await Promise.all([
        this.budget.getUsageData(tenantId, month),
        this.budget.getEffectiveLimits(tenantId),
        this.prisma.subscription.findUnique({
          where: { tenantId },
          include: { plan: true },
        }),
        this.prisma.tenantMonthlyAiUsage.findUnique({
          where: {
            tenantId_month: {
              tenantId,
              month,
            },
          },
        }),
        this.prisma.tenantMonthlyAiUsage.findUnique({
          where: {
            tenantId_month: {
              tenantId,
              month: previousMonth,
            },
          },
        }),
        this.getMonthAnalytics(tenantId, month),
      ]);

    const budgetPercent = usage.percentUsed;
    const callsPercent = usage.callsPercent;
    const maxPercentUsed = Math.max(budgetPercent, callsPercent);
    const isExceeded =
      usage.blockedAt !== undefined || budgetPercent >= 100 || callsPercent >= 100;

    const currentExceeded = this.didExceedMonth(currentMonthUsage, limits);
    const previousExceeded = this.didExceedMonth(previousMonthUsage, limits);
    const isRepeatExceeded = currentExceeded && previousExceeded;

    const totalInteractions =
      analytics.smallCalls + analytics.bigCalls + analytics.mockCalls;
    const bigCallRate =
      totalInteractions > 0 ? (analytics.bigCalls / totalInteractions) * 100 : 0;

    const templateRuns = analytics.templateRuns;
    const supportLevel = subscription?.plan?.supportLevel ?? 'COMMUNITY';

    const nudges: AiNudge[] = [];

    if (maxPercentUsed >= 80 && maxPercentUsed < 100) {
      const dismissed = await this.isDismissedRecently(
        tenantId,
        membership.id,
        'NUDGE_80',
      );

      if (!dismissed) {
        if (!usage.warnedAt && !usage.callsWarnedAt) {
          await this.markWarningEmitted(tenantId, month, usage, maxPercentUsed, membership.id, user.id);
        }

        nudges.push({
          key: 'NUDGE_80',
          severity: 'WARN',
          title: 'Estas cerca del limite mensual de IA',
          message: `Llevas ${Math.round(maxPercentUsed)}% de uso. Revisa consumo y evita pausas al final del mes.`,
          dismissible: true,
          ctas: [
            {
              label: 'Ver detalles',
              action: 'OPEN_AI_SETTINGS',
              href: `/${tenantId}/settings/ai`,
            },
            {
              label: 'Solicitar upgrade',
              action: 'REQUEST_UPGRADE_RECOMMENDED',
            },
          ],
        });
      }
    }

    if (isExceeded) {
      nudges.push({
        key: 'NUDGE_100',
        severity: 'BLOCK',
        title: 'IA pausada por limite mensual',
        message:
          'Se alcanzo el limite de presupuesto o llamadas del mes. Puedes solicitar upgrade o soporte para reactivar capacidad.',
        dismissible: false,
        ctas: [
          {
            label: 'Solicitar upgrade',
            action: 'REQUEST_UPGRADE_RECOMMENDED',
          },
          {
            label: 'Contactar soporte',
            action: 'OPEN_SUPPORT',
            href: `/${tenantId}/support?topic=ai-limit`,
          },
          ...(supportLevel === 'PRIORITY'
            ? [
                {
                  label: 'Solicitar aumento temporal',
                  action: 'REQUEST_TEMP_OVERRIDE',
                  href: `/${tenantId}/support?topic=ai-temporary-override`,
                } as AiNudgeCta,
              ]
            : []),
        ],
      });
    }

    if (isRepeatExceeded) {
      const dismissed = await this.isDismissedRecently(
        tenantId,
        membership.id,
        'NUDGE_REPEAT',
      );
      const emittedThisWeek = await this.wasEventEmittedRecently(
        tenantId,
        membership.id,
        'AI_UPGRADE_RECOMMENDED',
      );

      if (!dismissed && !emittedThisWeek) {
        await this.emitNudgeEvent(
          tenantId,
          membership.id,
          user.id,
          'AI_UPGRADE_RECOMMENDED',
          {
            month,
            previousMonth,
          },
        );

        nudges.push({
          key: 'NUDGE_REPEAT',
          severity: 'WARN',
          title: 'Tu uso excede el plan actual',
          message:
            'Detectamos exceso dos meses seguidos. Recomendacion: migrar a PRO o ENTERPRISE para continuidad.',
          dismissible: true,
          ctas: [
            {
              label: 'Solicitar upgrade',
              action: 'REQUEST_UPGRADE_RECOMMENDED',
            },
          ],
        });
      }
    }

    if (bigCallRate > 20 && !limits.allowBigModel) {
      const dismissed = await this.isDismissedRecently(
        tenantId,
        membership.id,
        'NUDGE_BIG_USAGE',
      );

      if (!dismissed) {
        await this.emitNudgeEvent(
          tenantId,
          membership.id,
          user.id,
          'AI_BIG_USAGE_UPSELL',
          {
            month,
            bigCallRate: Number(bigCallRate.toFixed(2)),
          },
          'MONTHLY',
        );

        nudges.push({
          key: 'NUDGE_BIG_USAGE',
          severity: 'INFO',
          title: 'Tu equipo necesita analisis mas avanzados',
          message:
            'El uso de consultas complejas es alto. Upgrade recomendado y uso de templates para optimizar costo.',
          dismissible: true,
          ctas: [
            {
              label: 'Solicitar upgrade',
              action: 'REQUEST_UPGRADE_RECOMMENDED',
            },
            {
              label: 'Ver templates',
              action: 'OPEN_AI_SETTINGS',
              href: `/${tenantId}/settings/ai`,
            },
          ],
        });
      }
    }

    if (templateRuns >= this.templateUpsellThreshold) {
      const dismissed = await this.isDismissedRecently(
        tenantId,
        membership.id,
        'NUDGE_TEMPLATE_VALUE',
      );

      if (!dismissed) {
        await this.emitNudgeEvent(
          tenantId,
          membership.id,
          user.id,
          'AI_TEMPLATE_VALUE_UPSELL',
          {
            month,
            templateRuns,
          },
          'MONTHLY',
        );

        nudges.push({
          key: 'NUDGE_TEMPLATE_VALUE',
          severity: 'INFO',
          title: 'Tu equipo usa IA intensivamente',
          message:
            'Ya hay alto uso de templates este mes. PRO/ENTERPRISE da mas cupo y continuidad para el redactor IA.',
          dismissible: true,
          ctas: [
            {
              label: 'Solicitar upgrade',
              action: 'REQUEST_UPGRADE_RECOMMENDED',
            },
          ],
        });
      }
    }

    const severityOrder: Record<AiNudgeSeverity, number> = {
      BLOCK: 0,
      WARN: 1,
      INFO: 2,
    };

    return nudges.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }

  async dismissNudge(
    user: UserLike,
    tenantId: string,
    key: AiNudge['key'],
  ): Promise<{ key: AiNudge['key']; dismissedUntil: string }> {
    if (key === 'NUDGE_100') {
      throw new BadRequestException('NUDGE_100 no se puede descartar');
    }

    const membership = await this.getMembership(user.id, tenantId);

    await this.prisma.aiActionEvent.create({
      data: {
        tenantId,
        membershipId: membership.id,
        actionType: `AI_NUDGE_DISMISSED_${key}`,
        source: 'NUDGE',
        page: 'ai_nudges',
      },
    });

    await this.audit.createLog({
      tenantId,
      actorUserId: user.id,
      actorMembershipId: membership.id,
      action: AuditAction.AI_ACTION_CLICKED,
      entityType: 'AiNudge',
      entityId: `${tenantId}:${key}`,
      metadata: {
        event: 'AI_NUDGE_DISMISSED',
        key,
        cooldownDays: 7,
      },
    });

    const dismissedUntil = new Date(Date.now() + this.dismissCooldownMs).toISOString();
    return {
      key,
      dismissedUntil,
    };
  }

  async createRecommendedUpgradeRequest(
    user: UserLike,
    tenantId: string,
  ): Promise<{ requestId: string; requestedPlanId: string; note: string; alreadyPending: boolean }> {
    const membership = await this.getMembership(user.id, tenantId);

    const [subscription, usage, limits, analytics] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      }),
      this.budget.getUsageData(tenantId),
      this.budget.getEffectiveLimits(tenantId),
      this.getMonthAnalytics(tenantId, getCurrentMonth()),
    ]);

    if (!subscription) {
      throw new BadRequestException('No existe suscripcion activa para este tenant');
    }

    const previousMonth = this.getPreviousMonth(getCurrentMonth());
    const previousUsage = await this.prisma.tenantMonthlyAiUsage.findUnique({
      where: {
        tenantId_month: {
          tenantId,
          month: previousMonth,
        },
      },
    });

    const totalInteractions =
      analytics.smallCalls + analytics.bigCalls + analytics.mockCalls;
    const bigCallRate =
      totalInteractions > 0 ? (analytics.bigCalls / totalInteractions) * 100 : 0;

    const isRepeatExceeded =
      this.didExceedMonth(previousUsage, limits) &&
      (usage.percentUsed >= 100 || usage.callsPercent >= 100 || usage.blockedAt !== undefined);

    const targetTier: 'PRO' | 'ENTERPRISE' =
      isRepeatExceeded || bigCallRate > 20 ? 'ENTERPRISE' : 'PRO';

    const currentPlanRank = this.getPlanRank(subscription.plan as any);
    const recommendedPlan = await this.findRecommendedPlan(currentPlanRank, targetTier);
    if (!recommendedPlan) {
      throw new BadRequestException('No se encontro un plan recomendado disponible');
    }

    const prismaAny = this.prisma as any;

    const pendingRequest = await prismaAny.planChangeRequest?.findFirst?.({
      where: {
        tenantId,
        status: 'PENDING',
      },
    });

    const note = `Solicitado por alto uso de IA: ${Math.round(
      Math.max(usage.percentUsed, usage.callsPercent),
    )}% / ${usage.calls} calls / ${usage.estimatedCostCents} cents`;

    if (pendingRequest) {
      return {
        requestId: pendingRequest.id,
        requestedPlanId: pendingRequest.requestedPlanId,
        note,
        alreadyPending: true,
      };
    }

    if (currentPlanRank >= this.getPlanRank(recommendedPlan as any)) {
      throw new BadRequestException('El tenant ya esta en un plan igual o superior al recomendado');
    }

    if (!prismaAny.planChangeRequest?.create) {
      throw new BadRequestException(
        'PlanChangeRequest no disponible en el esquema Prisma actual',
      );
    }

    const created = await prismaAny.planChangeRequest.create({
      data: {
        tenantId,
        requestedPlanId: recommendedPlan.id,
        status: 'PENDING',
        requestedByMembershipId: membership.id,
        note,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId: user.id,
        actorMembershipId: membership.id,
        action: 'PLAN_CHANGE_REQUESTED' as any,
        entity: 'PlanChangeRequest',
        entityId: created.id,
        metadata: {
          source: 'AI_RECOMMENDED_NUDGE',
          requestedPlanId: recommendedPlan.id,
          requestedTier: targetTier,
          usage: {
            percentUsed: usage.percentUsed,
            calls: usage.calls,
            estimatedCostCents: usage.estimatedCostCents,
          },
        } as any,
      } as any,
    });

    return {
      requestId: created.id,
      requestedPlanId: recommendedPlan.id,
      note,
      alreadyPending: false,
    };
  }

  private async getMembership(userId: string, tenantId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId,
          tenantId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('No tienes acceso al tenant indicado');
    }

    return membership;
  }

  private async isDismissedRecently(
    tenantId: string,
    membershipId: string,
    key: AiNudge['key'],
  ): Promise<boolean> {
    const latestDismiss = await this.prisma.aiActionEvent.findFirst({
      where: {
        tenantId,
        membershipId,
        actionType: `AI_NUDGE_DISMISSED_${key}`,
      },
      orderBy: {
        clickedAt: 'desc',
      },
    });

    if (!latestDismiss) {
      return false;
    }

    const ageMs = Date.now() - latestDismiss.clickedAt.getTime();
    return ageMs < this.dismissCooldownMs;
  }

  private async wasEventEmittedRecently(
    tenantId: string,
    membershipId: string,
    actionType: string,
  ): Promise<boolean> {
    const lastEvent = await this.prisma.aiActionEvent.findFirst({
      where: {
        tenantId,
        membershipId,
        actionType,
      },
      orderBy: {
        clickedAt: 'desc',
      },
    });

    if (!lastEvent) {
      return false;
    }

    return Date.now() - lastEvent.clickedAt.getTime() < this.dismissCooldownMs;
  }

  private async markWarningEmitted(
    tenantId: string,
    month: string,
    usage: { warnedAt?: Date; callsWarnedAt?: Date; callsPercent: number },
    maxPercentUsed: number,
    membershipId: string,
    userId: string,
  ): Promise<void> {
    const updatedFields: Record<string, Date> = {};

    if (!usage.warnedAt && maxPercentUsed >= 80) {
      updatedFields.warnedAt = new Date();
    }

    if (!usage.callsWarnedAt && usage.callsPercent >= 80) {
      updatedFields.callsWarnedAt = new Date();
    }

    if (Object.keys(updatedFields).length > 0) {
      await this.prisma.tenantMonthlyAiUsage.updateMany({
        where: {
          tenantId,
          month,
        },
        data: updatedFields,
      });

      await this.audit.createLog({
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: AuditAction.AI_LIMIT_WARNED,
        entityType: 'TenantAiBudget',
        entityId: tenantId,
        metadata: {
          month,
          source: 'NUDGE_80',
          threshold: 80,
        },
      });
    }
  }

  private async emitNudgeEvent(
    tenantId: string,
    membershipId: string,
    userId: string,
    actionType: 'AI_UPGRADE_RECOMMENDED' | 'AI_BIG_USAGE_UPSELL' | 'AI_TEMPLATE_VALUE_UPSELL',
    metadata: Record<string, unknown>,
    cadence: 'WEEKLY' | 'MONTHLY' = 'WEEKLY',
  ): Promise<void> {
    const since = new Date(
      Date.now() -
        (cadence === 'WEEKLY' ? this.dismissCooldownMs : 31 * 24 * 60 * 60 * 1000),
    );

    const existing = await this.prisma.aiActionEvent.findFirst({
      where: {
        tenantId,
        membershipId,
        actionType,
        clickedAt: {
          gte: since,
        },
      },
    });

    if (existing) {
      return;
    }

    await this.prisma.aiActionEvent.create({
      data: {
        tenantId,
        membershipId,
        actionType,
        source: 'NUDGE',
        page: 'ai_nudges',
      },
    });

    await this.audit.createLog({
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: AuditAction.AI_ACTION_CLICKED,
      entityType: 'AiNudge',
      entityId: `${tenantId}:${actionType}`,
      metadata: {
        ...metadata,
        event: actionType,
      },
    });
  }

  private async getMonthAnalytics(tenantId: string, month: string) {
    const [year, monthNum] = month.split('-').map(Number);
    const start = new Date(year, monthNum - 1, 1);
    const end = new Date(year, monthNum, 0, 23, 59, 59, 999);

    const [smallCalls, bigCalls, mockCalls, templateRuns] = await Promise.all([
      this.prisma.aiInteractionLog.count({
        where: {
          tenantId,
          modelSize: 'SMALL',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      }),
      this.prisma.aiInteractionLog.count({
        where: {
          tenantId,
          modelSize: 'BIG',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      }),
      this.prisma.aiInteractionLog.count({
        where: {
          tenantId,
          modelSize: 'MOCK',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      }),
      this.prisma.auditLog.count({
        where: {
          tenantId,
          action: 'AI_TEMPLATE_RUN' as any,
          createdAt: {
            gte: start,
            lte: end,
          },
        } as any,
      }),
    ]);

    return {
      smallCalls,
      bigCalls,
      mockCalls,
      templateRuns,
    };
  }

  private didExceedMonth(
    usage:
      | {
          estimatedCostCents: number;
          calls: number;
          blockedAt: Date | null;
        }
      | null,
    limits: { budgetCents: number; callsLimit: number },
  ): boolean {
    if (!usage) {
      return false;
    }

    if (usage.blockedAt) {
      return true;
    }

    const budgetExceeded = limits.budgetCents > 0 && usage.estimatedCostCents >= limits.budgetCents;
    const callsExceeded =
      limits.callsLimit > 0 && limits.callsLimit < 9999 && usage.calls >= limits.callsLimit;

    return budgetExceeded || callsExceeded;
  }

  private getPreviousMonth(month: string): string {
    const [year, monthNum] = month.split('-').map(Number);
    const date = new Date(year, monthNum - 1, 1);
    date.setMonth(date.getMonth() - 1);
    const prevYear = date.getFullYear();
    const prevMonth = String(date.getMonth() + 1).padStart(2, '0');
    return `${prevYear}-${prevMonth}`;
  }

  private async findRecommendedPlan(
    currentPlanRank: number,
    targetTier: 'PRO' | 'ENTERPRISE',
  ) {
    const plans = await this.prisma.billingPlan.findMany();

    if (plans.length === 0) {
      return null;
    }

    const planByName = plans.find((plan) =>
      (plan.name || '').toLowerCase().includes(targetTier.toLowerCase()),
    );

    if (planByName) {
      return planByName;
    }

    const rankedPlans = [...plans].sort(
      (a, b) => this.getPlanRank(a as any) - this.getPlanRank(b as any),
    );

    if (targetTier === 'ENTERPRISE') {
      return rankedPlans[rankedPlans.length - 1] ?? null;
    }

    return rankedPlans.find((plan) => this.getPlanRank(plan as any) > currentPlanRank) ?? null;
  }

  private getPlanRank(plan: { rank?: number; planId?: string; name?: string }): number {
    if (typeof plan.rank === 'number') {
      return plan.rank;
    }

    const normalized = (plan.planId || plan.name || '').toString().toUpperCase();
    if (normalized.includes('FREE')) return 0;
    if (normalized.includes('BASIC')) return 1;
    if (normalized.includes('PRO')) return 2;
    if (normalized.includes('ENTERPRISE')) return 3;
    return 0;
  }
}

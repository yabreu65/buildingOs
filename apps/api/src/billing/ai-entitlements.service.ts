import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AiEntitlementsService: Manages AI consultation limits and usage tracking
 *
 * Enforces monthly consumption limits based on subscription plan.
 * Tracks usage per tenant and resets on monthly boundary.
 *
 * FASE 1: AI Monetization - Backend Foundation
 */
@Injectable()
export class AiEntitlementsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get the monthly AI consultation limit for a tenant
   *
   * @param tenantId - Tenant ID
   * @returns Monthly limit (0 = disabled, 10+ = enabled)
   * @throws BadRequestException if tenant/subscription not found
   */
  async getAiLimit(tenantId: string): Promise<number> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new BadRequestException(`No subscription found for tenant ${tenantId}`);
    }

    return subscription.plan.aiConsultationsLimit ?? 0;
  }

  /**
   * Track AI consultation usage (increment counter)
   *
   * Safely increments the monthly counter. If monthly boundary crossed,
   * resets counter and updates reset timestamp.
   *
   * @param tenantId - Tenant ID
   * @param count - Number of consultations to add (default: 1)
   * @throws BadRequestException if tenant/subscription not found
   */
  async trackConsumption(tenantId: string, count: number = 1): Promise<void> {
    if (count < 1) {
      throw new BadRequestException('Consumption count must be at least 1');
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
    });

    if (!subscription) {
      throw new BadRequestException(`No subscription found for tenant ${tenantId}`);
    }

    const now = new Date();
    const shouldReset = this.shouldResetCounter(subscription.aiConsultationsResetAt);

    if (shouldReset) {
      // Reset counter and update reset timestamp
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          aiConsultationsUsed: count,
          aiConsultationsResetAt: now,
        },
      });
    } else {
      // Increment existing counter
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          aiConsultationsUsed: {
            increment: count,
          },
        },
      });
    }
  }

  /**
   * Check if tenant has remaining consultations this month
   *
   * Compares current usage against plan limit.
   * Automatically resets counter if monthly boundary crossed.
   *
   * @param tenantId - Tenant ID
   * @returns true if consultations available, false if limit reached
   * @throws BadRequestException if tenant/subscription not found
   */
  async hasRemainingConsultations(tenantId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new BadRequestException(`No subscription found for tenant ${tenantId}`);
    }

    // Get current limit
    const limit = subscription.plan.aiConsultationsLimit ?? 0;

    // If limit is 0 or unlimited (999999+), always allow
    if (limit === 0 || limit >= 999999) {
      return true;
    }

    // Check if we need to reset counter (monthly boundary)
    const shouldReset = this.shouldResetCounter(subscription.aiConsultationsResetAt);

    if (shouldReset) {
      // Reset and allow next request
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          aiConsultationsUsed: 0,
          aiConsultationsResetAt: new Date(),
        },
      });
      return true; // After reset, limit not reached
    }

    // Check if usage exceeds limit
    const used = subscription.aiConsultationsUsed ?? 0;
    return used < limit;
  }

  /**
   * Get current usage and limit for a tenant (for UI display)
   *
   * @param tenantId - Tenant ID
   * @returns Object with used, limit, and percentage
   * @throws BadRequestException if tenant/subscription not found
   */
  async getUsageStatus(tenantId: string): Promise<{
    used: number;
    limit: number;
    percentageUsed: number;
    remaining: number;
  }> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new BadRequestException(`No subscription found for tenant ${tenantId}`);
    }

    const limit = subscription.plan.aiConsultationsLimit ?? 0;
    const used = subscription.aiConsultationsUsed ?? 0;

    // Handle unlimited plans
    if (limit >= 999999) {
      return {
        used: 0,
        limit: Infinity,
        percentageUsed: 0,
        remaining: Infinity,
      };
    }

    // If limit is 0, plan doesn't support AI
    if (limit === 0) {
      return {
        used: 0,
        limit: 0,
        percentageUsed: 100, // Consider it "full"
        remaining: 0,
      };
    }

    const percentageUsed = Math.round((used / limit) * 100);
    const remaining = Math.max(0, limit - used);

    return {
      used,
      limit,
      percentageUsed,
      remaining,
    };
  }

  /**
   * Reset monthly counter (called on subscription renewal or plan change)
   *
   * @param tenantId - Tenant ID
   * @throws BadRequestException if tenant/subscription not found
   */
  async resetMonthlyCounter(tenantId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
    });

    if (!subscription) {
      throw new BadRequestException(`No subscription found for tenant ${tenantId}`);
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        aiConsultationsUsed: 0,
        aiConsultationsResetAt: new Date(),
      },
    });
  }

  /**
   * Determine if monthly counter should be reset
   *
   * Resets if:
   * - Never reset before (resetAt is null)
   * - More than 30 days have passed since last reset
   *
   * @param lastResetAt - Timestamp of last reset (null if never reset)
   * @returns true if should reset, false otherwise
   */
  private shouldResetCounter(lastResetAt: Date | null): boolean {
    // Never reset before
    if (!lastResetAt) {
      return true;
    }

    // Check if 30+ days have passed
    const now = new Date();
    const daysSinceReset = (now.getTime() - lastResetAt.getTime()) / (1000 * 60 * 60 * 24);

    return daysSinceReset >= 30;
  }
}

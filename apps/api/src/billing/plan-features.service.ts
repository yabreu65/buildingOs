import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionStatus } from '@prisma/client';

export interface PlanFeatures {
  canExportReports: boolean;
  canBulkOperations: boolean;
  supportLevel: 'COMMUNITY' | 'EMAIL' | 'PRIORITY';
}

/**
 * PlanFeaturesService: Extract feature flags from BillingPlan
 * Features are determined by the subscription's plan, not hardcoded by client type.
 * Always reflects current plan configuration - extensible for new features.
 */
@Injectable()
export class PlanFeaturesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all features available for a tenant's current plan
   * Returns null if no active subscription
   */
  async getTenantFeatures(tenantId: string): Promise<PlanFeatures | null> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      include: { plan: true },
    });

    if (!subscription) {
      return null;
    }

    // Extract features from plan
    return {
      canExportReports: subscription.plan.canExportReports ?? false,
      canBulkOperations: subscription.plan.canBulkOperations ?? false,
      supportLevel: (subscription.plan.supportLevel as any) ?? 'COMMUNITY',
    };
  }

  /**
   * Check if a specific feature is available for a tenant
   * @param tenantId Tenant ID
   * @param featureKey Feature name
   * @returns true if feature is available, false otherwise
   */
  async hasFeature(tenantId: string, featureKey: keyof PlanFeatures): Promise<boolean> {
    const features = await this.getTenantFeatures(tenantId);

    if (!features) {
      return false;
    }

    return features[featureKey] === true || features[featureKey] === 'PRIORITY';
  }

  /**
   * Check if tenant has PRIORITY support
   */
  async hasPrioritySupport(tenantId: string): Promise<boolean> {
    const features = await this.getTenantFeatures(tenantId);
    return features ? features.supportLevel === 'PRIORITY' : false;
  }
}

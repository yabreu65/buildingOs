import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionStatus } from '@prisma/client';

export interface TenantUsage {
  buildings: number;
  units: number;
  activeUsers: number;
  activeOccupants: number;
}

export interface TenantPlan {
  subscriptionId: string;
  subscriptionStatus: SubscriptionStatus;
  planId: string;
  planName: string;
  maxBuildings: number;
  maxUnits: number;
  maxUsers: number;
  maxOccupants: number;
}

/**
 * PlanEntitlementsService: Enforce billing plan limits
 *
 * Checks tenant's current plan and usage to determine if operations are allowed.
 * Blocks creation (writes) when:
 * 1. Subscription status is not ACTIVE/TRIAL
 * 2. Resource count would exceed plan limit
 *
 * Allows reads regardless of subscription status.
 */
@Injectable()
export class PlanEntitlementsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get tenant's current subscription and plan details
   * Returns null if no active subscription
   */
  async getTenantPlan(tenantId: string): Promise<TenantPlan | null> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      include: {
        plan: true,
      },
    });

    if (!subscription) {
      return null;
    }

    return {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planId: subscription.plan.id,
      planName: subscription.plan.name,
      maxBuildings: subscription.plan.maxBuildings,
      maxUnits: subscription.plan.maxUnits,
      maxUsers: subscription.plan.maxUsers,
      maxOccupants: subscription.plan.maxOccupants,
    };
  }

  /**
   * Get tenant's current resource usage
   * Counts active/non-deleted resources
   */
  async getTenantUsage(tenantId: string): Promise<TenantUsage> {
    // Count buildings (all)
    const buildingCount = await this.prisma.building.count({
      where: { tenantId },
    });

    // Count units (all)
    const unitCount = await this.prisma.unit.count({
      where: {
        building: {
          tenantId,
        },
      },
    });

    // Count active memberships in this tenant
    const membershipCount = await this.prisma.membership.count({
      where: {
        tenantId,
      },
    });

    // Count active occupants in units belonging to this tenant
    const occupantCount = await this.prisma.unitOccupant.count({
      where: {
        unit: {
          building: {
            tenantId,
          },
        },
      },
    });

    return {
      buildings: buildingCount,
      units: unitCount,
      activeUsers: membershipCount,
      activeOccupants: occupantCount,
    };
  }

  /**
   * Check if subscription status allows writes
   * Throws if status is PAST_DUE, CANCELED, SUSPENDED, etc.
   */
  private validateSubscriptionStatus(
    subscriptionStatus: SubscriptionStatus
  ): void {
    const isAllowed =
      subscriptionStatus === SubscriptionStatus.ACTIVE ||
      subscriptionStatus === SubscriptionStatus.TRIAL;

    if (!isAllowed) {
      throw new BadRequestException(
        `Cannot create resources: subscription status is ${subscriptionStatus}`
      );
    }
  }

  /**
   * Assert that tenant has not exceeded limit for a resource type
   * Throws ConflictException if limit exceeded
   *
   * @param tenantId Tenant ID
   * @param resourceType One of: buildings, units, users, occupants
   * @throws ConflictException if limit exceeded
   * @throws BadRequestException if subscription not active
   */
  async assertLimit(
    tenantId: string,
    resourceType: 'buildings' | 'units' | 'users' | 'occupants'
  ): Promise<void> {
    // Get tenant's plan
    const plan = await this.getTenantPlan(tenantId);

    if (!plan) {
      throw new BadRequestException('No subscription found for tenant');
    }

    // Validate subscription status (must be ACTIVE or TRIAL for writes)
    this.validateSubscriptionStatus(plan.subscriptionStatus);

    // Get tenant's current usage
    const usage = await this.getTenantUsage(tenantId);

    // Check limit based on resource type
    let limit = 0;
    let current = 0;

    switch (resourceType) {
      case 'buildings':
        limit = plan.maxBuildings;
        current = usage.buildings;
        break;
      case 'units':
        limit = plan.maxUnits;
        current = usage.units;
        break;
      case 'users':
        limit = plan.maxUsers;
        current = usage.activeUsers;
        break;
      case 'occupants':
        limit = plan.maxOccupants;
        current = usage.activeOccupants;
        break;
      default:
        throw new BadRequestException(`Unknown resource type: ${resourceType}`);
    }

    // If current usage is at or above limit, throw error
    if (current >= limit) {
      throw new ConflictException({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `Plan limit exceeded: max${this.capitalize(resourceType)}`,
        metadata: {
          limit,
          current,
          planId: plan.planId,
          resourceType,
        },
      });
    }
  }

  /**
   * Helper to capitalize first letter of resource type for error messages
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

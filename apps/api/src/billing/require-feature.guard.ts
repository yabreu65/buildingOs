import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanFeaturesService } from './plan-features.service';

/**
 * Decorator to mark an endpoint as requiring a specific feature
 * Usage: @RequireFeature('canExportReports')
 */
export const RequireFeature = (featureKey: string) =>
  SetMetadata('requiredFeature', featureKey);

/**
 * Guard that enforces feature availability
 * Use @RequireFeature('featureName') on controller methods
 */
@Injectable()
export class RequireFeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private planFeatures: PlanFeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get the feature key from decorator metadata
    const featureKey = this.reflector.get<string>(
      'requiredFeature',
      context.getHandler(),
    );

    // If no feature required, allow access
    if (!featureKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId || request.headers['x-tenant-id'];

    if (!tenantId) {
      throw new ForbiddenException('Tenant ID required');
    }

    // Check if tenant has the feature
    const hasFeature = await this.planFeatures.hasFeature(
      tenantId,
      featureKey as any,
    );

    if (!hasFeature) {
      throw new ForbiddenException({
        code: 'FEATURE_NOT_AVAILABLE',
        message: `Feature not available on current plan: ${featureKey}`,
        metadata: {
          featureKey,
          requiredPlan: this.getPlanRequiringFeature(featureKey),
        },
      });
    }

    return true;
  }

  /**
   * Helper to suggest which plan includes this feature
   */
  private getPlanRequiringFeature(featureKey: string): string {
    const featurePlanMap: Record<string, string> = {
      canExportReports: 'BASIC',
      canBulkOperations: 'PRO',
      canUseAI: 'ENTERPRISE',
      canUseWhatsApp: 'PRO',
    };

    return featurePlanMap[featureKey] || 'PRO';
  }
}

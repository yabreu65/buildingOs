import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../common/types/request.types';
import { PlanFeaturesService } from './plan-features.service';
import { PlanFeatures } from './plan-features.service';

/**
 * Decorator to mark an endpoint as requiring a specific feature
 * Usage: @RequireFeature('canExportReports')
 */
export const RequireFeature = (featureKey: keyof PlanFeatures) =>
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
    const featureKey = this.reflector.get<keyof PlanFeatures>(
      'requiredFeature',
      context.getHandler(),
    );

    // If no feature required, allow access
    if (!featureKey) {
      return true;
    }

    // Development bypass: allow all features in development mode
    const isDevelopment = process.env.NODE_ENV === 'development';
    if (isDevelopment) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId =
      request.user?.tenantId || this.getTenantIdFromHeader(request);

    if (!tenantId) {
      throw new ForbiddenException('Tenant ID required');
    }

    // Check if tenant has the feature
    const hasFeature = await this.planFeatures.hasFeature(tenantId, featureKey);

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

  private getTenantIdFromHeader(request: AuthenticatedRequest): string | undefined {
    const tenantHeader = request.headers['x-tenant-id'];

    if (typeof tenantHeader === 'string' && tenantHeader) {
      return tenantHeader;
    }

    return Array.isArray(tenantHeader) ? tenantHeader[0] : undefined;
  }

  /**
   * Helper to suggest which plan includes this feature
   */
  private getPlanRequiringFeature(featureKey: keyof PlanFeatures): string {
    const featurePlanMap: Record<keyof PlanFeatures, string> = {
      canExportReports: 'BASIC',
      canBulkOperations: 'PRO',
      canUseAI: 'ENTERPRISE',
      aiConsultationsPerMonth: 'ENTERPRISE',
      supportLevel: 'PRO',
    };

    return featurePlanMap[featureKey];
  }
}

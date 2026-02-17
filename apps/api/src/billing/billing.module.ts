import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanEntitlementsService } from './plan-entitlements.service';
import { PlanFeaturesService } from './plan-features.service';
import { RequireFeatureGuard } from './require-feature.guard';

/**
 * BillingModule: Plan entitlements and feature flags management
 *
 * Exports:
 * - PlanEntitlementsService: Checks plan limits and subscription status
 * - PlanFeaturesService: Extracts feature flags from BillingPlan
 * - RequireFeatureGuard: Enforces feature availability on endpoints
 *
 * Usage examples:
 *
 * In services (check limits):
 * ```
 * constructor(private planEntitlements: PlanEntitlementsService) {}
 *
 * async createBuilding(...) {
 *   await this.planEntitlements.assertLimit(tenantId, 'buildings');
 * }
 * ```
 *
 * In controllers (gate features):
 * ```
 * @UseGuards(RequireFeatureGuard)
 * @RequireFeature('canExportReports')
 * @Post('export')
 * async exportReports(...) { }
 * ```
 */
@Module({
  imports: [PrismaModule],
  providers: [PlanEntitlementsService, PlanFeaturesService, RequireFeatureGuard],
  exports: [PlanEntitlementsService, PlanFeaturesService, RequireFeatureGuard],
})
export class BillingModule {}

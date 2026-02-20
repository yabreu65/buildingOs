import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { PlanEntitlementsService } from './plan-entitlements.service';
import { PlanFeaturesService } from './plan-features.service';
import { RequireFeatureGuard } from './require-feature.guard';
import { SubscriptionService } from './subscription.service';
import { PaymentService } from './payment.service';
import { AdminPaymentController } from './admin.payment.controller';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

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
  imports: [PrismaModule, AuditModule],
  controllers: [AdminPaymentController, BillingController],
  providers: [
    PlanEntitlementsService,
    PlanFeaturesService,
    RequireFeatureGuard,
    SubscriptionService,
    PaymentService,
    BillingService,
  ],
  exports: [
    PlanEntitlementsService,
    PlanFeaturesService,
    RequireFeatureGuard,
    SubscriptionService,
    PaymentService,
    BillingService,
  ],
})
export class BillingModule {}

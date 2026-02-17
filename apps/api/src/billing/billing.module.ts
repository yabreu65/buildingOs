import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanEntitlementsService } from './plan-entitlements.service';

/**
 * BillingModule: Plan and entitlements management
 *
 * Exports:
 * - PlanEntitlementsService: Checks plan limits and subscription status
 *
 * Usage in other services:
 * ```
 * constructor(private planEntitlements: PlanEntitlementsService) {}
 *
 * async createBuilding(...) {
 *   await this.planEntitlements.assertLimit(tenantId, 'buildings');
 *   // proceed with creation
 * }
 * ```
 */
@Module({
  imports: [PrismaModule],
  providers: [PlanEntitlementsService],
  exports: [PlanEntitlementsService],
})
export class BillingModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';
import { VendorsValidators } from './vendors.validators';

/**
 * VendorsModule: Vendors, VendorAssignments, Quotes, and WorkOrders management
 *
 * Provides:
 * - CRUD endpoints for vendors (tenant-level)
 * - CRUD endpoints for vendor assignments (building-scoped)
 * - Read endpoints for quotes (building-scoped)
 * - Read endpoints for work orders (building-scoped)
 *
 * Security:
 * - JwtAuthGuard on all endpoints
 * - BuildingAccessGuard on building-scoped routes
 * - VendorsValidators for scope enforcement
 * - RBAC for permission checks
 */
@Module({
  imports: [PrismaModule],
  controllers: [VendorsController],
  providers: [VendorsService, VendorsValidators],
  exports: [VendorsService, VendorsValidators],
})
export class VendorsModule {}

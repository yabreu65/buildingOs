import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { BillingModule } from '../billing/billing.module';
import { AuditModule } from '../audit/audit.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsValidators } from './reports.validators';

/**
 * ReportsModule: Admin reporting and analytics
 *
 * Exports:
 * - ReportsController: 4 GET endpoints for tickets, finance, communications, activity
 *
 * Services:
 * - ReportsService: Aggregation logic for 4 report types
 * - ReportsValidators: Security and validation
 *
 * Dependencies:
 * - PrismaModule: Database access
 * - TenancyModule: TenantAccessGuard for multi-tenant isolation
 */
@Module({
  imports: [PrismaModule, TenancyModule, BillingModule, AuditModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsValidators],
})
export class ReportsModule {}

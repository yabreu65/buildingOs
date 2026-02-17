import { Module } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { BuildingsController } from './buildings.controller';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TenancyModule, PrismaModule, BillingModule],
  controllers: [BuildingsController],
  providers: [BuildingsService],
  exports: [BuildingsService],
})
export class BuildingsModule {}

import { Module } from '@nestjs/common';
import { UnitsService } from './units.service';
import { UnitsController, BuildingUnitsController } from './units.controller';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TenancyModule, PrismaModule, BillingModule],
  controllers: [UnitsController, BuildingUnitsController],
  providers: [UnitsService],
  exports: [UnitsService],
})
export class UnitsModule {}

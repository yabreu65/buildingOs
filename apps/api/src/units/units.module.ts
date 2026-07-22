import { Module } from '@nestjs/common';
import { UnitsService } from './units.service';
import { UnitsController, BuildingUnitsController } from './units.controller';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ResidentAccessModule } from '../resident-access/resident-access.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TenancyModule, PrismaModule, ResidentAccessModule, BillingModule],
  controllers: [UnitsController, BuildingUnitsController],
  providers: [UnitsService],
  exports: [UnitsService],
})
export class UnitsModule {}

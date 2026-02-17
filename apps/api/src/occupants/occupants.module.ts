import { Module } from '@nestjs/common';
import { OccupantsService } from './occupants.service';
import { OccupantsController } from './occupants.controller';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TenancyModule, PrismaModule, BillingModule],
  controllers: [OccupantsController],
  providers: [OccupantsService],
  exports: [OccupantsService],
})
export class OccupantsModule {}

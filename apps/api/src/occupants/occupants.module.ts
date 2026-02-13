import { Module } from '@nestjs/common';
import { OccupantsService } from './occupants.service';
import { OccupantsController } from './occupants.controller';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [TenancyModule, PrismaModule],
  controllers: [OccupantsController],
  providers: [OccupantsService],
  exports: [OccupantsService],
})
export class OccupantsModule {}

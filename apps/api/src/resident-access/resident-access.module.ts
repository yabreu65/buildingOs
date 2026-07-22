import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ResidentAccessService } from './resident-access.service';

@Module({
  imports: [PrismaModule],
  providers: [ResidentAccessService],
  exports: [ResidentAccessService],
})
export class ResidentAccessModule {}

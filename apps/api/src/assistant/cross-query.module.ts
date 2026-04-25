import { Module } from '@nestjs/common';
import { CrossQueryService } from './cross-query.service';
import { ProcessModule } from '../process/process.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ProcessModule],
  providers: [CrossQueryService],
  exports: [CrossQueryService],
})
export class CrossQueryModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProcessSearchService } from './process-search.service';

@Module({
  imports: [PrismaModule],
  providers: [ProcessSearchService],
  exports: [ProcessSearchService],
})
export class ProcessModule {}

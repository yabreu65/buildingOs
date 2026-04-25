import { Module } from '@nestjs/common';
import { ProcessSearchService } from './process-search.service';

@Module({
  providers: [ProcessSearchService],
  exports: [ProcessSearchService],
})
export class ProcessModule {}
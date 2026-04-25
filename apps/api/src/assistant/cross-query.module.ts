import { Module } from '@nestjs/common';
import { CrossQueryService } from './cross-query.service';
import { ProcessModule } from '../process/process.module';

@Module({
  imports: [ProcessModule],
  providers: [CrossQueryService],
  exports: [CrossQueryService],
})
export class CrossQueryModule {}
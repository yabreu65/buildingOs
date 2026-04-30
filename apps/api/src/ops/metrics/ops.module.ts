import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OpsController } from './ops.controller';
import { OpsMetricsQueueService } from './ops-metrics.queue';
import { OpsMetricsWorker } from './ops-metrics.worker';
import { OpsRepository } from './ops.repository';
import { OpsService } from './ops.service';

@Module({
  imports: [PrismaModule],
  controllers: [OpsController],
  providers: [OpsRepository, OpsService, OpsMetricsQueueService, OpsMetricsWorker],
  exports: [OpsRepository, OpsService, OpsMetricsQueueService],
})
export class OpsModule {}

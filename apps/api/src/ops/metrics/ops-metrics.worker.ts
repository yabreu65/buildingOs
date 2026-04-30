import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { OpsService } from './ops.service';

@Injectable()
export class OpsMetricsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpsMetricsWorker.name);
  private worker?: Worker<{ triggeredBy: 'scheduler' | 'manual' }>;

  constructor(private readonly opsService: OpsService) {}

  onModuleInit(): void {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);

    this.worker = new Worker(
      'metrics.check',
      async (job: Job<{ triggeredBy: 'scheduler' | 'manual' }>) => {
        const result = await this.opsService.runMetricsCheck();
        this.logger.log({ msg: '[OPS] metrics.check completed', ...result, triggeredBy: job.data.triggeredBy });
      },
      { connection: { host, port } },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error({ msg: '[OPS] metrics.check failed', jobId: job?.id, error: err.message });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

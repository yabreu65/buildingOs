import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

type MetricsCheckJob = { triggeredBy: 'scheduler' | 'manual' };

@Injectable()
export class OpsMetricsQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpsMetricsQueueService.name);
  private readonly queue: Queue<MetricsCheckJob>;

  constructor() {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);
    this.queue = new Queue<MetricsCheckJob>('metrics.check', {
      connection: { host, port },
    });
  }

  async onModuleInit(): Promise<void> {
    const everyMinutes = Number(process.env.OPS_METRICS_CHECK_EVERY_MINUTES || 5);
    const everyMs = Math.max(1, everyMinutes) * 60 * 1000;

    await this.queue.add(
      'metrics.check',
      { triggeredBy: 'scheduler' },
      {
        jobId: 'metrics.check.cron',
        repeat: { every: everyMs },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    this.logger.log({ msg: '[OPS] Scheduled metrics.check repeat job', everyMinutes });
  }

  async enqueueManualCheck(): Promise<void> {
    await this.queue.add('metrics.check', { triggeredBy: 'manual' }, { removeOnComplete: 100, removeOnFail: 200 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}

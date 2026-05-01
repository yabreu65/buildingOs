import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { OpsService } from './ops.service';

@Injectable()
export class OpsMetricsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpsMetricsWorker.name);
  private worker?: Worker<{ triggeredBy: 'scheduler' | 'manual' }>;
  private schemaDriftLogged = false;

  constructor(private readonly opsService: OpsService) {}

  onModuleInit(): void {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);

    this.worker = new Worker(
      'metrics.check',
      async (job: Job<{ triggeredBy: 'scheduler' | 'manual' }>) => {
        try {
          const result = await this.opsService.runMetricsCheck();
          this.logger.log({ msg: '[OPS] metrics.check completed', ...result, triggeredBy: job.data.triggeredBy });
        } catch (error) {
          if (this.isSchemaDriftError(error)) {
            if (!this.schemaDriftLogged) {
              this.schemaDriftLogged = true;
              this.logger.error({
                msg: '[OPS] metrics.check skipped: schema is not ready',
                error: error instanceof Error ? error.message : String(error),
              });
            }
            return;
          }
          throw error;
        }
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

  private isSchemaDriftError(error: unknown): boolean {
    const record = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
    const code = typeof record?.code === 'string' ? record.code : undefined;
    const metaCode = typeof record?.meta?.code === 'string' ? record.meta.code : undefined;
    const message = typeof record?.message === 'string' ? record.message : '';
    return (
      code === 'P2021' ||
      code === 'P2022' ||
      metaCode === '42P01' ||
      metaCode === '42703' ||
      /column .* does not exist|relation .* does not exist|table .* does not exist/i.test(message)
    );
  }
}

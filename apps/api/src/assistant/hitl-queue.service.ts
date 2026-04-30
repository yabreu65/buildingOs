import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export type HitlNotifyJob = {
  handoffId: string;
  tenantId: string;
  userId: string;
  role: string;
  question: string;
  traceId: string;
  resolvedLevel: string;
  fallbackPath: string;
  gatewayOutcome: string;
  contextJson: Record<string, unknown>;
};

@Injectable()
export class HitlQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(HitlQueueService.name);
  private readonly queue: Queue<HitlNotifyJob>;

  constructor() {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);
    this.queue = new Queue<HitlNotifyJob>('hitl.notify', {
      connection: { host, port },
    });
  }

  async enqueueNotify(job: HitlNotifyJob): Promise<void> {
    await this.queue.add('hitl.notify', job, {
      attempts: 3,
      removeOnComplete: 200,
      removeOnFail: 200,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });
    this.logger.log({ msg: '[HITL] queued hitl.notify', handoffId: job.handoffId, traceId: job.traceId });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}

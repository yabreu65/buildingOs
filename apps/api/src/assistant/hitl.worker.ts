import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import type { HitlNotifyJob } from './hitl-queue.service';

@Injectable()
export class HitlWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HitlWorker.name);
  private worker?: Worker<HitlNotifyJob>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);

    this.worker = new Worker<HitlNotifyJob>(
      'hitl.notify',
      async (job: Job<HitlNotifyJob>) => {
        await this.sendInternalNotification(job.data);
        await this.prisma.assistantHandoff.update({
          where: { id: job.data.handoffId },
          data: { status: 'NOTIFIED' },
        });
      },
      {
        connection: { host, port },
      },
    );

    this.worker.on('failed', async (job, err) => {
      this.logger.error({ msg: '[HITL] notify failed', handoffId: job?.data?.handoffId, error: err.message });
      if (job?.data?.handoffId) {
        await this.prisma.assistantHandoff.update({
          where: { id: job.data.handoffId },
          data: { status: 'FAILED' },
        });
      }
    });
  }

  private async sendInternalNotification(payload: HitlNotifyJob): Promise<void> {
    this.logger.warn({
      msg: '[HITL] notify internal channel',
      channel: process.env.HITL_NOTIFY_CHANNEL || 'internal-log',
      traceId: payload.traceId,
      tenantId: payload.tenantId,
      userId: payload.userId,
      role: payload.role,
      fallbackPath: payload.fallbackPath,
      gatewayOutcome: payload.gatewayOutcome,
      question: payload.question,
      context: payload.contextJson,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

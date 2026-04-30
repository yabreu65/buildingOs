import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HitlQueueService } from './hitl-queue.service';

export const HITL_FALLBACK_WHITELIST = [
  'invalid_entities',
  'intent_library_tool_null',
  'intent_library_tool_error',
  'bridge_timeout',
  'bridge_exception',
  'bridge_http_not_ok',
  'bridge_invalid_payload',
  'bridge_contract_mismatch',
  'bridge_non_live_data_operational',
  'rag_no_sources',
] as const;

type MaybeHitlParams = {
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
export class AssistantHitlService {
  private readonly logger = new Logger(AssistantHitlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: HitlQueueService,
  ) {}

  async maybeCreateHandoff(params: MaybeHitlParams): Promise<{ created: boolean; handoffId?: string }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: params.tenantId },
      select: { id: true, managedServiceEnabled: true },
    });

    if (!tenant?.managedServiceEnabled) {
      return { created: false };
    }

    if (!HITL_FALLBACK_WHITELIST.includes(params.fallbackPath as (typeof HITL_FALLBACK_WHITELIST)[number])) {
      return { created: false };
    }

    const handoff = await this.prisma.assistantHandoff.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        role: params.role,
        question: params.question,
        traceId: params.traceId,
        resolvedLevel: params.resolvedLevel,
        fallbackPath: params.fallbackPath,
        gatewayOutcome: params.gatewayOutcome,
        contextJson: params.contextJson,
        status: 'PENDING',
      },
    });

    await this.queue.enqueueNotify({
      handoffId: handoff.id,
      tenantId: params.tenantId,
      userId: params.userId,
      role: params.role,
      question: params.question,
      traceId: params.traceId,
      resolvedLevel: params.resolvedLevel,
      fallbackPath: params.fallbackPath,
      gatewayOutcome: params.gatewayOutcome,
      contextJson: params.contextJson,
    });

    this.logger.log({ msg: '[HITL] handoff created', handoffId: handoff.id, traceId: params.traceId });
    return { created: true, handoffId: handoff.id };
  }
}

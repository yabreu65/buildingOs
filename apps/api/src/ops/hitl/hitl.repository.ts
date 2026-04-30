import { Injectable } from '@nestjs/common';
import { Prisma, AssistantHandoffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HitlRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    tenantId?: string;
    statuses?: AssistantHandoffStatus[];
    fallbackPath?: string;
    cursor?: string;
    limit: number;
  }) {
    const where: Prisma.AssistantHandoffWhereInput = {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.fallbackPath ? { fallbackPath: params.fallbackPath } : {}),
      ...(params.statuses && params.statuses.length > 0
        ? { status: { in: params.statuses } }
        : {}),
    };

    const rows = await this.prisma.assistantHandoff.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      take: params.limit + 1,
      select: {
        id: true,
        tenantId: true,
        userId: true,
        assignedToUserId: true,
        role: true,
        question: true,
        traceId: true,
        resolvedLevel: true,
        fallbackPath: true,
        gatewayOutcome: true,
        contextJson: true,
        createdAt: true,
        assignedAt: true,
        resolvedAt: true,
        resolutionNote: true,
        status: true,
      },
    });

    const hasMore = rows.length > params.limit;
    const items = hasMore ? rows.slice(0, params.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return {
      items,
      nextCursor,
    };
  }

  async findById(id: string) {
    return this.prisma.assistantHandoff.findUnique({
      where: { id },
      include: {
        audits: {
          orderBy: [{ createdAt: 'desc' }],
          select: {
            id: true,
            action: true,
            actorUserId: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async assign(params: {
    id: string;
    assignedToUserId: string;
  }) {
    return this.prisma.assistantHandoff.update({
      where: { id: params.id },
      data: {
        assignedToUserId: params.assignedToUserId,
        assignedAt: new Date(),
        status: 'IN_PROGRESS',
      },
    });
  }

  async resolve(params: {
    id: string;
    resolutionNote: string;
    actorUserId: string;
  }) {
    return this.prisma.assistantHandoff.update({
      where: { id: params.id },
      data: {
        assignedToUserId: params.actorUserId,
        assignedAt: new Date(),
        resolvedAt: new Date(),
        resolutionNote: params.resolutionNote,
        status: 'RESOLVED',
      },
    });
  }

  async dismiss(id: string) {
    return this.prisma.assistantHandoff.update({
      where: { id },
      data: {
        status: 'DISMISSED',
      },
    });
  }

  async createAudit(params: {
    handoffId: string;
    actorUserId: string;
    action: string;
  }) {
    return this.prisma.assistantHandoffAudit.create({
      data: {
        handoffId: params.handoffId,
        actorUserId: params.actorUserId,
        action: params.action,
      },
    });
  }

  async createMessage(params: {
    tenantId: string;
    userId: string;
    handoffId: string;
    traceId: string;
    content: string;
    createdByUserId: string;
    channel?: 'IN_APP' | 'EMAIL' | 'WHATSAPP' | 'PUSH';
    deliveryStatus?: 'PENDING' | 'QUEUED' | 'DELIVERED' | 'FAILED';
  }) {
    return this.prisma.assistantMessage.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        handoffId: params.handoffId,
        traceId: params.traceId,
        direction: 'OUTBOUND',
        content: params.content,
        createdByUserId: params.createdByUserId,
        channel: params.channel ?? 'IN_APP',
        deliveryStatus: params.deliveryStatus ?? 'DELIVERED',
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        handoffId: true,
        traceId: true,
        channel: true,
        deliveryStatus: true,
      },
    });
  }
}

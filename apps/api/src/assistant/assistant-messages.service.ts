import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssistantMessagesService {
  constructor(private readonly prisma: PrismaService) {}

  private clampLimit(limit?: number): number {
    if (!limit || Number.isNaN(limit)) {
      return 20;
    }
    return Math.max(1, Math.min(100, limit));
  }

  async listForUser(params: {
    tenantId: string;
    userId: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = this.clampLimit(params.limit);

    const rows = await this.prisma.assistantMessage.findMany({
      where: {
        tenantId: params.tenantId,
        userId: params.userId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      take: limit + 1,
      select: {
        id: true,
        tenantId: true,
        userId: true,
        handoffId: true,
        traceId: true,
        direction: true,
        content: true,
        createdAt: true,
        createdByUserId: true,
        channel: true,
        deliveryStatus: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return { items, nextCursor };
  }
}


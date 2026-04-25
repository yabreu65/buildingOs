import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ProcessType, ProcessStatus } from '@prisma/client';

export type ProcessSearchType = 'LIQUIDATION' | 'EXPENSE_VALIDATION' | 'CLAIM';
export type ProcessSearchStatus = 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';

export interface SearchProcessesInput {
  processTypes?: ProcessSearchType[];
  statuses?: ProcessSearchStatus[];
  buildingId?: string;
  unitId?: string;
  assigned?: boolean;
  assignedToUserId?: string;
  priority?: number;
  period?: string;
  createdAfter?: string;
  createdBefore?: string;
  overdueSla?: boolean;
  limit?: number;
  cursor?: string;
  sortBy?: 'createdAt' | 'dueAt' | 'priority';
  sortDir?: 'asc' | 'desc';
}

export interface ProcessSummaryInput {
  groupBy: 'processType' | 'status' | 'priority';
  processTypes?: ProcessSearchType[];
  buildingId?: string;
  overdueSla?: boolean;
}

export interface ProcessSummaryOutput {
  groups: Array<{ key: string; count: number; pendingSla: number }>;
  generatedAt: string;
}

export interface SearchProcessesOutput {
  processes: Array<{
    id: string;
    processType: string;
    referenceId?: string;
    title: string;
    status: string;
    buildingId?: string;
    unitId?: string;
    assignedToUserId?: string;
    priority: number;
    period?: string;
    dueAt?: string;
    overdueSla: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  pagination: {
    total: number;
    limit: number;
    nextCursor?: string;
    hasMore: boolean;
  };
  asOf: string;
}

@Injectable()
export class ProcessSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async searchProcesses(
    tenantId: string,
    input: SearchProcessesInput,
  ): Promise<SearchProcessesOutput> {
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const sortBy = input.sortBy ?? 'createdAt';
    const sortDir = input.sortDir ?? 'desc';

    const where: Prisma.ProcessInstanceWhereInput = { tenantId };

    if (input.processTypes?.length) {
      where.processType = { in: input.processTypes as ProcessType[] };
    }
    if (input.statuses?.length) {
      where.status = { in: input.statuses as ProcessStatus[] };
    }
    if (input.buildingId) {
      where.buildingId = input.buildingId;
    }
    if (input.unitId) {
      where.unitId = input.unitId;
    }
    if (input.period) {
      where.period = input.period;
    }
    if (input.assigned !== undefined) {
      if (input.assigned) {
        where.assignedToUserId = { not: null };
      } else {
        where.assignedToUserId = null;
      }
    }
    if (input.assignedToUserId) {
      where.assignedToUserId = input.assignedToUserId;
    }
    if (input.priority !== undefined) {
      where.priority = input.priority;
    }
    if (input.overdueSla) {
      where.overdueSla = true;
    }
    if (input.createdAfter || input.createdBefore) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (input.createdAfter) dateFilter.gte = new Date(input.createdAfter);
      if (input.createdBefore) dateFilter.lte = new Date(input.createdBefore);
      where.createdAt = dateFilter;
    }

    const [items, total] = await Promise.all([
      this.prisma.processInstance.findMany({
        where,
        take: limit + 1,
        ...(input.cursor
          ? { cursor: { id: input.cursor }, skip: 1 }
          : {}),
        orderBy: { [sortBy]: sortDir },
      }),
      this.prisma.processInstance.count({ where }),
    ]);

    const hasMore = items.length > limit;
    const results = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

    return {
      processes: results.map((p) => ({
        id: p.id,
        processType: p.processType,
        referenceId: p.referenceId ?? undefined,
        title: p.title,
        status: p.status,
        buildingId: p.buildingId ?? undefined,
        unitId: p.unitId ?? undefined,
        assignedToUserId: p.assignedToUserId ?? undefined,
        priority: p.priority,
        period: p.period ?? undefined,
        dueAt: p.dueAt?.toISOString() ?? undefined,
        overdueSla: p.overdueSla,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      pagination: {
        total,
        limit,
        nextCursor: nextCursor ?? undefined,
        hasMore,
      },
      asOf: new Date().toISOString(),
    };
  }

  async getProcessSummary(
    tenantId: string,
    input: ProcessSummaryInput,
  ): Promise<ProcessSummaryOutput> {
    const where: Prisma.ProcessInstanceWhereInput = { tenantId };

    if (input.processTypes?.length) {
      where.processType = { in: input.processTypes as ProcessType[] };
    }
    if (input.buildingId) {
      where.buildingId = input.buildingId;
    }
    if (input.overdueSla) {
      where.overdueSla = true;
    }

    const groupByField = input.groupBy;
    const allItems = await this.prisma.processInstance.findMany({ where });

    const groupsMap = new Map<string, { count: number; pendingSla: number }>();

    for (const item of allItems) {
      const key =
        groupByField === 'processType'
          ? item.processType
          : groupByField === 'status'
            ? item.status
            : String(item.priority);

      const current = groupsMap.get(key) ?? { count: 0, pendingSla: 0 };
      current.count += 1;
      if (item.overdueSla && item.status !== 'COMPLETED' && item.status !== 'CANCELLED') {
        current.pendingSla += 1;
      }
      groupsMap.set(key, current);
    }

    const groups = [...groupsMap.entries()].map(([key, stats]) => ({
      key,
      ...stats,
    }));

    return {
      groups,
      generatedAt: new Date().toISOString(),
    };
  }

  async searchClaims(
    tenantId: string,
    input: Omit<SearchProcessesInput, 'processTypes'>,
  ): Promise<SearchProcessesOutput> {
    return this.searchProcesses(tenantId, {
      ...input,
      processTypes: ['CLAIM'],
    });
  }
}
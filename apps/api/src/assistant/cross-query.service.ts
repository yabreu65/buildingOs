import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProcessSearchService } from '../process/process-search.service';

export type TemplateId = 'TPL-01' | 'TPL-02' | 'TPL-03' | 'TPL-04' | 'TPL-05' | 'TPL-06' | 'TPL-07' | 'TPL-08' | 'TPL-09' | 'TPL-10';

export const TEMPLATE_ALLOWLIST: Record<TemplateId, { roles: string[]; params: string[] }> = {
  'TPL-01': { roles: ['TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR'], params: ['buildingId', 'period', 'topN', 'currency', 'limit', 'cursor'] },
  'TPL-02': { roles: ['TENANT_OWNER', 'TENANT_ADMIN'], params: ['buildingId', 'period', 'currency', 'limit', 'cursor'] },
  'TPL-03': { roles: ['TENANT_OWNER', 'TENANT_ADMIN'], params: ['buildingId', 'period', 'topN', 'currency'] },
  'TPL-04': { roles: ['TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR'], params: ['buildingId', 'period', 'monthsBack', 'processTypes', 'statuses', 'overdueSla', 'topN'] },
  'TPL-05': { roles: ['TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR'], params: ['buildingId', 'assignedToUserId', 'monthsBack', 'limit', 'cursor', 'topN'] },
  'TPL-06': { roles: ['TENANT_OWNER', 'TENANT_ADMIN'], params: ['buildingId', 'monthsBack', 'currency'] },
  'TPL-07': { roles: ['TENANT_OWNER', 'TENANT_ADMIN'], params: ['buildingId', 'asOf', 'currency', 'topN'] },
  'TPL-08': { roles: ['TENANT_OWNER', 'TENANT_ADMIN'], params: ['buildingId', 'period', 'monthsBack', 'processTypes'] },
  'TPL-09': { roles: ['TENANT_OWNER', 'TENANT_ADMIN'], params: ['buildingId', 'period', 'topN', 'currency'] },
  'TPL-10': { roles: ['TENANT_OWNER', 'SUPER_ADMIN'], params: ['buildingId', 'period', 'monthsBack', 'currency'] },
};

export const VALID_TEMPLATES = Object.keys(TEMPLATE_ALLOWLIST) as TemplateId[];

export interface CrossQueryInput {
  templateId: TemplateId;
  params: Record<string, unknown>;
}

export interface CrossQueryOutput {
  templateId: string;
  templateName: string;
  answerSource: 'snapshot' | 'live_data' | 'clarification' | 'no_data' | 'error';
  asOf: string;
  scope: { tenantId: string; buildingId: string | null; currency: string; role: string };
  responseType: 'list' | 'kpi' | 'dashboard' | 'clarification' | 'no_data' | 'error' | 'timeseries' | 'distribution';
  errorCode?: 'role_denied' | 'tenant_denied' | 'contract_mismatch' | 'unavailable' | 'invalid_params';
  sections: Array<{ title: string; type: string; data: unknown; notes?: string[] }>;
  coverage?: { from: string; to: string; completeness: number };
  pagination?: { limit: number; nextCursor: string | null; hasMore: boolean };
}

type WorkqueueItem = {
  sourceType: 'process' | 'ticket' | 'payment';
  id: string;
  title: string;
  status: string;
  priority: number;
  overdueSla: boolean;
  createdAt: string;
  buildingId: string | null;
  unitId: string | null;
  linkRef: string;
};

type WorkqueueSectionItem = {
  type: 'process' | 'ticket' | 'payment';
  id: string;
  title: string;
  priority: number;
  createdAt: string;
  linkRef: string;
  status: string;
  overdueSla: boolean;
};

function getLastClosedMonth(): string {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const lastClosedMonth = month === 0 ? 12 : month;
  const lastClosedYear = month === 0 ? year - 1 : year;
  return `${lastClosedYear}-${String(lastClosedMonth).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculateCollectionRateBp(chargedMinor: number, collectedMinor: number): number | null {
  if (chargedMinor === 0) return null;
  return Math.round((collectedMinor * 10000) / chargedMinor);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function shiftPeriod(period: string, months: number): string {
  const [yearRaw, monthRaw] = period.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + months);
  const shiftedYear = date.getUTCFullYear();
  const shiftedMonth = date.getUTCMonth() + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`;
}

function maxIsoDate(values: string[]): string {
  if (values.length === 0) return new Date().toISOString();
  return values.reduce((latest, current) => (current > latest ? current : latest));
}

@Injectable()
export class CrossQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processSearch: ProcessSearchService,
  ) {}

  async execute(tenantId: string, role: string, input: CrossQueryInput): Promise<CrossQueryOutput> {
    const { templateId, params } = input;

    if (!VALID_TEMPLATES.includes(templateId)) {
      return this.buildError('contract_mismatch', tenantId, role);
    }

    const allowlist = TEMPLATE_ALLOWLIST[templateId];
    if (!allowlist.roles.includes(role)) {
      return this.buildError('role_denied', tenantId, role);
    }

    try {
      switch (templateId) {
        case 'TPL-01': return this.executeTPL01(tenantId, role, params);
        case 'TPL-02': return this.executeTPL02(tenantId, role, params);
        case 'TPL-03': return this.executeTPL03(tenantId, role, params);
        case 'TPL-04': return this.executeTPL04(tenantId, role, params);
        case 'TPL-05': return this.executeTPL05(tenantId, role, params);
        case 'TPL-06': return this.executeTPL06(tenantId, role, params);
        case 'TPL-07': return this.executeTPL07(tenantId, role, params);
        case 'TPL-08': return this.executeTPL08(tenantId, role, params);
        case 'TPL-09': return this.executeTPL09(tenantId, role, params);
        case 'TPL-10': return this.executeTPL10(tenantId, role, params);
        default:
          return this.buildError('contract_mismatch', tenantId, role);
      }
    } catch (error) {
      console.error(`CrossQuery error: ${templateId}`, error);
      return this.buildError('unavailable', tenantId, role);
    }
  }

  private buildError(errorCode: CrossQueryOutput['errorCode'], tenantId: string, role: string): CrossQueryOutput {
    return {
      templateId: 'UNKNOWN',
      templateName: 'Unknown Template',
      answerSource: 'error',
      asOf: new Date().toISOString(),
      scope: { tenantId, buildingId: null, currency: 'ARS', role },
      responseType: 'error',
      errorCode,
      sections: [],
    };
  }

  private buildScope(tenantId: string, buildingId: string | null, role: string) {
    return { tenantId, buildingId, currency: 'ARS', role };
  }

  private getDefaultPeriod(): string {
    return getLastClosedMonth();
  }

  private getDefaultMonthsBack(): number {
    return 6;
  }

  private decodeCursor(cursor?: string): WorkqueueItem | null {
    if (!cursor) return null;
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as WorkqueueItem;
      return decoded;
    } catch {
      return null;
    }
  }

  private encodeCursor(item: WorkqueueItem): string {
    return Buffer.from(JSON.stringify(item), 'utf8').toString('base64');
  }

  private compareWorkqueue(a: WorkqueueItem, b: WorkqueueItem): number {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.overdueSla !== b.overdueSla) return b.overdueSla ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    if (a.sourceType !== b.sourceType) return a.sourceType.localeCompare(b.sourceType);
    return a.id.localeCompare(b.id);
  }

  private async needsBuildingClarification(tenantId: string, buildingId?: string | null): Promise<boolean> {
    if (buildingId) return false;
    const count = await this.prisma.building.count({ where: { tenantId } });
    return count > 1;
  }

  private getClarificationCount(params: Record<string, unknown>): number {
    const raw = Number(params.clarificationCount ?? 0);
    if (!Number.isFinite(raw)) return 0;
    return clamp(Math.trunc(raw), 0, 10);
  }

  private buildClarification(
    templateId: TemplateId,
    templateName: string,
    tenantId: string,
    role: string,
    message: string,
    clarificationCount = 0,
  ): CrossQueryOutput {
    const capReached = clarificationCount >= 2;
    return {
      templateId,
      templateName,
      answerSource: 'clarification',
      asOf: new Date().toISOString(),
      scope: this.buildScope(tenantId, null, role),
      responseType: 'clarification',
      sections: [{
        title: 'clarification',
        type: 'text',
        data: {
          message,
          clarificationCount,
          maxClarifications: 2,
          capReached,
        },
      }],
    };
  }

  private async executeTPL01(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const period = (params.period as string) || this.getDefaultPeriod();
    const topN = clamp(Number(params.topN ?? 5), 1, 50);
    const limit = clamp(Number(params.limit ?? 20), 1, 50);
    const buildingId = (params.buildingId as string) || null;
    const clarificationCount = this.getClarificationCount(params);

    if (await this.needsBuildingClarification(_tenantId, buildingId)) {
      return this.buildClarification(
        'TPL-01',
        'UNIT_DEBT_OCCUPANCY',
        _tenantId,
        role,
        'Tenant tiene múltiples edificios; indicá buildingId.',
        clarificationCount,
      );
    }

    const trendFrom = shiftPeriod(period, -5);
    const [currentSnapshots, trendSnapshots, totalUnits, activeOccupants] = await Promise.all([
      this.prisma.unitBalanceMonthlySnapshot.findMany({
        where: {
          tenantId: _tenantId,
          period,
          ...(buildingId ? { buildingId } : {}),
        },
        include: {
          unit: {
            include: {
              building: { select: { name: true } },
              unitOccupants: {
                where: { endDate: null },
                include: { member: { select: { name: true } } },
              },
            },
          },
        },
        orderBy: [{ outstandingMinor: 'desc' }, { id: 'asc' }],
        take: limit,
      }),
      this.prisma.buildingBalanceMonthlySnapshot.findMany({
        where: {
          tenantId: _tenantId,
          ...(buildingId ? { buildingId } : {}),
          period: { gte: trendFrom, lte: period },
        },
        orderBy: [{ period: 'asc' }, { buildingId: 'asc' }],
      }),
      this.prisma.unit.count({
        where: buildingId ? { buildingId } : { building: { tenantId: _tenantId } },
      }),
      this.prisma.unitOccupant.findMany({
        where: {
          tenantId: _tenantId,
          endDate: null,
          ...(buildingId ? { unit: { buildingId } } : {}),
        },
        select: { role: true, unitId: true, memberId: true },
      }),
    ]);

    if (currentSnapshots.length === 0) {
      return {
        templateId: 'TPL-01',
        templateName: 'UNIT_DEBT_OCCUPANCY',
        answerSource: 'snapshot',
        asOf: new Date().toISOString(),
        scope: this.buildScope(_tenantId, buildingId, role),
        responseType: 'no_data',
        sections: [{ title: 'no_data', type: 'text', data: { message: 'No hay snapshots para el período solicitado.' } }],
        coverage: { from: period, to: period, completeness: 0 },
      };
    }

    const asOf = currentSnapshots[0]?.asOf.toISOString() ?? new Date().toISOString();
    const totalDebt = currentSnapshots.reduce((acc, s) => acc + s.outstandingMinor, 0);
    const totalOverdue = currentSnapshots.reduce((acc, s) => acc + (s.overdueMinor ?? 0), 0);
    const totalCharged = currentSnapshots.reduce((acc, s) => acc + s.chargedMinor, 0);
    const totalCollected = currentSnapshots.reduce((acc, s) => acc + s.collectedMinor, 0);

    const trendByPeriod = new Map<string, { chargedMinor: number; collectedMinor: number; outstandingMinor: number; overdueMinor: number; asOf: string }>();
    for (const snapshot of trendSnapshots) {
      const current = trendByPeriod.get(snapshot.period) ?? {
        chargedMinor: 0,
        collectedMinor: 0,
        outstandingMinor: 0,
        overdueMinor: 0,
        asOf: snapshot.asOf.toISOString(),
      };
      current.chargedMinor += snapshot.chargedMinor;
      current.collectedMinor += snapshot.collectedMinor;
      current.outstandingMinor += snapshot.outstandingMinor;
      current.overdueMinor += snapshot.overdueMinor ?? 0;
      current.asOf = snapshot.asOf.toISOString() > current.asOf ? snapshot.asOf.toISOString() : current.asOf;
      trendByPeriod.set(snapshot.period, current);
    }

    const trendSeries = [...trendByPeriod.entries()].map(([seriesPeriod, data]) => ({
      period: seriesPeriod,
      asOf: data.asOf,
      chargedMinor: data.chargedMinor,
      collectedMinor: data.collectedMinor,
      outstandingMinor: data.outstandingMinor,
      overdueMinor: data.overdueMinor,
      collectionRateBp: calculateCollectionRateBp(data.chargedMinor, data.collectedMinor),
    }));

    const topUnits = currentSnapshots.slice(0, topN).map((snapshot) => ({
      unitId: snapshot.unitId,
      unitLabel: snapshot.unit.label ?? snapshot.unit.code,
      buildingName: snapshot.unit.building.name,
      occupants: snapshot.unit.unitOccupants.map((occupant) => ({
        memberName: occupant.member.name,
        role: occupant.role,
      })),
      chargedMinor: snapshot.chargedMinor,
      collectedMinor: snapshot.collectedMinor,
      outstandingMinor: snapshot.outstandingMinor,
      overdueMinor: snapshot.overdueMinor ?? 0,
      collectionRateBp: snapshot.collectionRateBp,
    }));

    const occupiedUnits = new Set(activeOccupants.map((o) => o.unitId)).size;
    const residents = activeOccupants.filter((o) => o.role === 'RESIDENT').length;
    const owners = activeOccupants.filter((o) => o.role === 'OWNER').length;
    const uniqueOccupants = new Set(activeOccupants.map((o) => o.memberId)).size;

    return {
      templateId: 'TPL-01',
      templateName: 'UNIT_DEBT_OCCUPANCY',
      answerSource: 'snapshot',
      asOf,
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'list',
      sections: [
        {
          title: 'debt_snapshot',
          type: 'snapshot',
          data: {
            period,
            asOf,
            coverage: { from: trendFrom, to: period, points: trendSeries.length },
            kpis: {
              totalDebt,
              totalOverdue,
              totalCharged,
              totalCollected,
              collectionRateBp: calculateCollectionRateBp(totalCharged, totalCollected),
            },
            series: trendSeries,
            topUnits,
          },
          notes: ['source:snapshot'],
        },
        {
          title: 'occupancy',
          type: 'live_data',
          data: {
            asOf: new Date().toISOString(),
            totalUnits,
            occupiedUnits,
            vacantUnits: Math.max(totalUnits - occupiedUnits, 0),
            occupancyRateBp: totalUnits === 0 ? null : Math.round((occupiedUnits * 10000) / totalUnits),
            occupantsSummary: {
              residents,
              owners,
              assignments: activeOccupants.length,
              uniqueOccupants,
            },
          },
          notes: ['source:live_data'],
        },
      ],
      coverage: {
        from: trendFrom,
        to: period,
        completeness: Math.min(1, trendSeries.length / 6),
      },
      pagination: {
        limit,
        nextCursor: currentSnapshots.length === limit ? currentSnapshots[currentSnapshots.length - 1]?.id ?? null : null,
        hasMore: currentSnapshots.length === limit,
      },
    };
  }

  private async executeTPL02(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const period = (params.period as string) || this.getDefaultPeriod();
    const limit = clamp((params.limit as number) ?? 20, 1, 50);
    const buildingId = (params.buildingId as string) || null;

    return {
      templateId: 'TPL-02',
      templateName: 'PAYMENT_CHARGE_MISMATCH',
      answerSource: 'live_data',
      asOf: new Date().toISOString(),
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'list',
      sections: [
        { title: 'Resumen', type: 'kpi', data: { totalUnmatched: 0, totalAmount: 0 } },
        { title: 'Pagos Sin Cargo', type: 'list', data: [] },
      ],
      pagination: { limit, nextCursor: null, hasMore: false },
    };
  }

  private async executeTPL03(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const period = (params.period as string) || this.getDefaultPeriod();
    const topN = clamp((params.topN as number) ?? 5, 1, 50);
    const buildingId = (params.buildingId as string) || null;

    return {
      templateId: 'TPL-03',
      templateName: 'CHARGED_COLLECTED_BY_UNIT_CATEGORY',
      answerSource: 'snapshot',
      asOf: new Date().toISOString(),
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'kpi',
      sections: [
        { title: 'Totales', type: 'kpi', data: { totalCharged: 0, totalCollected: 0, overallRateBp: null } },
        { title: 'Por Categoría', type: 'kpi', data: [] },
      ],
      coverage: { from: period, to: period, completeness: 1.0 },
    };
  }

  private async executeTPL04(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const buildingId = (params.buildingId as string) || null;

    return {
      templateId: 'TPL-04',
      templateName: 'PROCESS_LOAD_BY_BUILDING',
      answerSource: 'live_data',
      asOf: new Date().toISOString(),
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'list',
      sections: [
        { title: 'Resumen de Procesos', type: 'kpi', data: { total: 0, pending: 0, overdue: 0 } },
      ],
    };
  }

  private async executeTPL05(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const limit = clamp(Number(params.limit ?? 20), 1, 50);
    const topN = clamp(Number(params.topN ?? 5), 1, 50);
    const monthsBack = clamp(Number(params.monthsBack ?? 1), 1, 24);
    const assignedToUserId = (params.assignedToUserId as string) || undefined;
    const buildingId = (params.buildingId as string) || null;
    const cursor = this.decodeCursor(params.cursor as string | undefined);
    const clarificationCount = this.getClarificationCount(params);

    const createdAfter = new Date();
    createdAfter.setUTCMonth(createdAfter.getUTCMonth() - monthsBack);

    if (await this.needsBuildingClarification(_tenantId, buildingId)) {
      return this.buildClarification(
        'TPL-05',
        'OPEN_WORKQUEUE_CROSS_MODULE',
        _tenantId,
        role,
        'Tenant tiene múltiples edificios; indicá buildingId.',
        clarificationCount,
      );
    }

    const [processes, tickets, pendingPayments] = await Promise.all([
      this.processSearch.searchProcesses(_tenantId, {
        statuses: ['PENDING', 'IN_PROGRESS'],
        buildingId: buildingId ?? undefined,
        assignedToUserId,
        createdAfter: createdAfter.toISOString(),
        sortBy: 'createdAt',
        sortDir: 'asc',
        limit: 500,
      }),
      this.prisma.ticket.findMany({
        where: {
          tenantId: _tenantId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          createdAt: { gte: createdAfter },
          ...(buildingId ? { buildingId } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
      this.prisma.payment.findMany({
        where: {
          tenantId: _tenantId,
          status: 'SUBMITTED',
          createdAt: { gte: createdAfter },
          ...(buildingId ? { buildingId } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
    ]);

    const ticketPriority: Record<string, number> = {
      URGENT: 3,
      HIGH: 2,
      MEDIUM: 1,
      LOW: 0,
    };

    const items: WorkqueueItem[] = [
      ...processes.processes.map((p) => ({
        sourceType: 'process' as const,
        id: p.id,
        title: p.title,
        status: p.status,
        priority: p.priority,
        overdueSla: p.overdueSla,
        createdAt: p.createdAt,
        buildingId: p.buildingId ?? null,
        unitId: p.unitId ?? null,
        linkRef: `process:${p.id}`,
      })),
      ...tickets.map((t) => ({
        sourceType: 'ticket' as const,
        id: t.id,
        title: t.title,
        status: t.status,
        priority: ticketPriority[t.priority] ?? 0,
        overdueSla: false,
        createdAt: t.createdAt.toISOString(),
        buildingId: t.buildingId,
        unitId: t.unitId,
        linkRef: `ticket:${t.id}`,
      })),
      ...pendingPayments.map((p) => ({
        sourceType: 'payment' as const,
        id: p.id,
        title: `Pago pendiente ${p.reference ?? p.id}`,
        status: p.status,
        priority: 1,
        overdueSla: false,
        createdAt: p.createdAt.toISOString(),
        buildingId: p.buildingId,
        unitId: p.unitId,
        linkRef: `payment:${p.id}`,
      })),
    ];

    items.sort((a, b) => this.compareWorkqueue(a, b));
    const filtered = cursor ? items.filter((item) => this.compareWorkqueue(item, cursor) > 0) : items;
    const pageItems = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const nextCursor = hasMore && pageItems.length > 0 ? this.encodeCursor(pageItems[pageItems.length - 1] as WorkqueueItem) : null;

    const byType = {
      process: pageItems.filter((i) => i.sourceType === 'process').length,
      ticket: pageItems.filter((i) => i.sourceType === 'ticket').length,
      payment: pageItems.filter((i) => i.sourceType === 'payment').length,
    };

    const normalizedItems: WorkqueueSectionItem[] = pageItems.map((item) => ({
      type: item.sourceType,
      id: item.id,
      title: item.title,
      priority: item.priority,
      createdAt: item.createdAt,
      linkRef: item.linkRef,
      status: item.status,
      overdueSla: item.overdueSla,
    }));

    if (pageItems.length === 0) {
      return {
        templateId: 'TPL-05',
        templateName: 'OPEN_WORKQUEUE_CROSS_MODULE',
        answerSource: 'live_data',
        asOf: new Date().toISOString(),
        scope: this.buildScope(_tenantId, buildingId, role),
        responseType: 'no_data',
        sections: [{ title: 'no_data', type: 'text', data: { message: 'No hay pendientes en la cola de trabajo.' } }],
        pagination: { limit, nextCursor: null, hasMore: false },
      };
    }

    return {
      templateId: 'TPL-05',
      templateName: 'OPEN_WORKQUEUE_CROSS_MODULE',
      answerSource: 'live_data',
      asOf: new Date().toISOString(),
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'list',
      sections: [
        {
          title: 'workqueue_summary',
          type: 'kpi',
          data: {
            byType,
            topN,
            monthsBack,
            asOf: new Date().toISOString(),
          },
          notes: ['source:live_data'],
        },
        {
          title: 'workqueue',
          type: 'list',
          data: normalizedItems,
          notes: ['source:live_data', 'sort:priority_desc,overdueSla_desc,createdAt_asc,sourceType_asc,id_asc'],
        },
      ],
      pagination: { limit, nextCursor, hasMore },
    };
  }

  private async executeTPL06(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const monthsBack = clamp((params.monthsBack as number) || this.getDefaultMonthsBack(), 1, 24);
    const buildingId = (params.buildingId as string) || null;

    return {
      templateId: 'TPL-06',
      templateName: 'REVENUE_OCCUPANCY_TREND',
      answerSource: 'snapshot',
      asOf: new Date().toISOString(),
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'timeseries',
      sections: [
        { title: 'Promedios', type: 'kpi', data: { avgOccupancy: 0, avgCollectionRateBp: null } },
        { title: 'Tendencia', type: 'kpi', data: [] },
      ],
      coverage: { from: '', to: '', completeness: monthsBack / 24 },
    };
  }

  private async executeTPL07(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const asOf = (params.asOf as string) || new Date().toISOString().split('T')[0];
    const buildingId = (params.buildingId as string) || null;

    const asOfStr = String(asOf);
    return {
      templateId: 'TPL-07',
      templateName: 'DEBT_AGING_BY_BUILDING',
      answerSource: 'live_data',
      asOf: new Date().toISOString(),
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'kpi',
      sections: [
        { title: 'Resumen', type: 'kpi', data: { currentDebt: 0, legacyDebt: 0 } },
        { title: 'Distribución', type: 'kpi', data: {} },
      ],
      coverage: { from: asOfStr, to: asOfStr, completeness: 1.0 },
    };
  }

  private async executeTPL08(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const buildingId = (params.buildingId as string) || null;

    return {
      templateId: 'TPL-08',
      templateName: 'PROCESS_TURNAROUND_BY_TYPE',
      answerSource: 'live_data',
      asOf: new Date().toISOString(),
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'kpi',
      sections: [
        { title: 'Por Tipo', type: 'kpi', data: [] },
      ],
    };
  }

  private async executeTPL09(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const period = (params.period as string) || this.getDefaultPeriod();
    const buildingId = (params.buildingId as string) || null;

    return {
      templateId: 'TPL-09',
      templateName: 'COLLECTION_EFFICIENCY_BY_OCCUPANT_TYPE',
      answerSource: 'snapshot',
      asOf: new Date().toISOString(),
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'kpi',
      sections: [
        { title: 'Por Tipo', type: 'kpi', data: [] },
      ],
      coverage: { from: period, to: period, completeness: 1.0 },
    };
  }

  private async executeTPL10(_tenantId: string, role: string, params: Record<string, unknown>): Promise<CrossQueryOutput> {
    const period = (params.period as string) || this.getDefaultPeriod();
    const monthsBack = clamp(Number(params.monthsBack ?? this.getDefaultMonthsBack()), 1, 24);
    const buildingId = (params.buildingId as string) || null;
    const clarificationCount = this.getClarificationCount(params);

    if (await this.needsBuildingClarification(_tenantId, buildingId)) {
      return this.buildClarification(
        'TPL-10',
        'EXECUTIVE_DASHBOARD_CROSS_MODULE',
        _tenantId,
        role,
        'Tenant tiene múltiples edificios; indicá buildingId.',
        clarificationCount,
      );
    }

    const [snapshots, processSummary, openTickets, pendingPayments] = await Promise.all([
      this.prisma.buildingBalanceMonthlySnapshot.findMany({
        where: {
          tenantId: _tenantId,
          period,
          ...(buildingId ? { buildingId } : {}),
        },
        orderBy: [{ asOf: 'desc' }, { buildingId: 'asc' }],
      }),
      this.processSearch.searchProcesses(_tenantId, {
        statuses: ['PENDING', 'IN_PROGRESS'],
        buildingId: buildingId ?? undefined,
        limit: 500,
      }),
      this.prisma.ticket.findMany({
        where: {
          tenantId: _tenantId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          ...(buildingId ? { buildingId } : {}),
        },
        select: { id: true, priority: true, status: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.payment.findMany({
        where: {
          tenantId: _tenantId,
          status: 'SUBMITTED',
          ...(buildingId ? { buildingId } : {}),
        },
        select: { id: true, amount: true, status: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    if (snapshots.length === 0) {
      return {
        templateId: 'TPL-10',
        templateName: 'EXECUTIVE_DASHBOARD_CROSS_MODULE',
        answerSource: 'no_data',
        asOf: new Date().toISOString(),
        scope: this.buildScope(_tenantId, buildingId, role),
        responseType: 'no_data',
        sections: [{ title: 'no_data', type: 'text', data: { message: 'No hay snapshot financiero para el período.' } }],
        coverage: { from: period, to: period, completeness: 0 },
      };
    }

    const snapshotAsOf = snapshots[0]?.asOf.toISOString() ?? new Date().toISOString();
    const debt = snapshots.reduce(
      (acc, snapshot) => {
        acc.chargedMinor += snapshot.chargedMinor;
        acc.collectedMinor += snapshot.collectedMinor;
        acc.outstandingMinor += snapshot.outstandingMinor;
        acc.overdueMinor += snapshot.overdueMinor ?? 0;
        return acc;
      },
      { chargedMinor: 0, collectedMinor: 0, outstandingMinor: 0, overdueMinor: 0 },
    );
    const collectionRateBp = calculateCollectionRateBp(debt.chargedMinor, debt.collectedMinor);

    const processesAsOf = processSummary.asOf;
    const processesOpen = processSummary.processes.length;
    const overdueProcesses = processSummary.processes.filter((p) => p.overdueSla).length;

    const ticketsByPriority = {
      urgent: openTickets.filter((t) => t.priority === 'URGENT').length,
      high: openTickets.filter((t) => t.priority === 'HIGH').length,
      medium: openTickets.filter((t) => t.priority === 'MEDIUM').length,
      low: openTickets.filter((t) => t.priority === 'LOW').length,
    };
    const ticketsAsOf = openTickets.length > 0 ? toIso(openTickets[openTickets.length - 1].createdAt) : new Date().toISOString();

    const pendingPaymentsAmountMinor = pendingPayments.reduce((acc, payment) => acc + payment.amount, 0);
    const pendingPaymentsAsOf = pendingPayments.length > 0
      ? toIso(pendingPayments[pendingPayments.length - 1].createdAt)
      : new Date().toISOString();

    const asOf = maxIsoDate([snapshotAsOf, processesAsOf, ticketsAsOf, pendingPaymentsAsOf]);

    return {
      templateId: 'TPL-10',
      templateName: 'EXECUTIVE_DASHBOARD_CROSS_MODULE',
      answerSource: 'snapshot',
      asOf,
      scope: this.buildScope(_tenantId, buildingId, role),
      responseType: 'dashboard',
      sections: [
        {
          title: 'debt',
          type: 'kpi',
          data: {
            asOf: snapshotAsOf,
            outstandingMinor: debt.outstandingMinor,
            overdueMinor: debt.overdueMinor,
          },
          notes: ['source:snapshot'],
        },
        {
          title: 'collections',
          type: 'kpi',
          data: {
            asOf: snapshotAsOf,
            chargedMinor: debt.chargedMinor,
            collectedMinor: debt.collectedMinor,
            collectionRateBp,
          },
          notes: ['source:snapshot'],
        },
        {
          title: 'processes',
          type: 'kpi',
          data: {
            asOf: processesAsOf,
            open: processesOpen,
            overdueSla: overdueProcesses,
          },
          notes: ['source:live_data'],
        },
        {
          title: 'tickets',
          type: 'kpi',
          data: {
            asOf: ticketsAsOf,
            open: openTickets.length,
            byPriority: ticketsByPriority,
          },
          notes: ['source:live_data'],
        },
        {
          title: 'pendingPayments',
          type: 'kpi',
          data: {
            asOf: pendingPaymentsAsOf,
            submittedCount: pendingPayments.length,
            submittedAmountMinor: pendingPaymentsAmountMinor,
          },
          notes: ['source:live_data'],
        },
      ],
      coverage: {
        from: shiftPeriod(period, -(monthsBack - 1)),
        to: period,
        completeness: 1,
      },
    };
  }
}

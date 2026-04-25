import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ChargeStatus, PaymentStatus, TicketStatus, UnitOccupantRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ASSISTANT_READ_ONLY_INTENTS,
  AssistantReadOnlyAction,
  AssistantReadOnlyIntentCode,
  AssistantReadOnlyQueryContext,
  AssistantReadOnlyQueryRequest,
  AssistantReadOnlyQueryResponse,
  AssistantReadOnlyResponseType,
  resolveReadOnlyIntentCode,
} from './read-only-query.types';

type ResolverResult = {
  answer: string;
  responseType: AssistantReadOnlyResponseType;
  actions: AssistantReadOnlyAction[];
  metadata: Record<string, unknown>;
};

@Injectable()
export class AssistantReadOnlyQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Execute a deterministic read-only query for assistant intents.
   */
  async execute(
    request: AssistantReadOnlyQueryRequest,
    headers: {
      apiKey?: string;
      tenantId?: string;
      userId?: string;
      role?: string;
    },
  ): Promise<AssistantReadOnlyQueryResponse> {
    this.assertApiKey(headers.apiKey);

    if (!request || typeof request.question !== 'string' || request.question.trim().length === 0) {
      throw new BadRequestException('question is required');
    }

    if (!request.context) {
      throw new BadRequestException('context is required');
    }

    const context = this.normalizeContext(request.context);
    this.assertAuthoritativeHeaderConsistency(context, headers);
    this.assertCanaryTenantEnabled(context.tenantId);

    const intentCode = resolveReadOnlyIntentCode(request.intentCode, request.intent);
    if (!intentCode) {
      return this.buildControlledResponse({
        answer:
          'No pude identificar una intención read-only válida. Reformulá la consulta con más contexto.',
        responseType: 'clarification',
        actions: [],
        metadata: {
          noIntent: true,
        },
      });
    }

    const definition = ASSISTANT_READ_ONLY_INTENTS[intentCode];

    await this.assertMembershipAndRole(context, definition.rolesAllowed);

    const startedAt = Date.now();
    const result = await this.routeIntent(intentCode, context, request.question);

    return this.buildControlledResponse({
      ...result,
      metadata: {
        ...result.metadata,
        intent: intentCode,
        intentCode,
        resolverKey: definition.resolverKey,
        answerSource: definition.answerSource,
        latencyMs: Date.now() - startedAt,
      },
    });
  }

  private async routeIntent(
    intentCode: AssistantReadOnlyIntentCode,
    context: AssistantReadOnlyQueryContext,
    question: string,
  ): Promise<ResolverResult> {
    switch (intentCode) {
      case 'GET_OVERDUE_UNITS':
        return this.overdueUnitsResolver(context);
      case 'GET_PENDING_PAYMENTS':
        return this.pendingPaymentsResolver(context);
      case 'GET_OPEN_TICKETS':
        return this.openTicketsResolver(context);
      case 'GET_VACANT_UNITS':
        return this.vacantUnitsResolver(context);
      case 'GET_COLLECTIONS_SUMMARY':
        return this.collectionsSummaryResolver(context);
      case 'GET_UNIT_PRIMARY_RESIDENT':
        return this.unitPrimaryResidentResolver(context, question);
      default:
        return {
          answer: 'Intención no soportada en modo read-only.',
          responseType: 'clarification',
          actions: [],
          metadata: {},
        };
    }
  }

  private async overdueUnitsResolver(
    context: AssistantReadOnlyQueryContext,
  ): Promise<ResolverResult> {
    const now = new Date();

    const overdueCharges = await this.prisma.charge.findMany({
      where: {
        tenantId: context.tenantId,
        canceledAt: null,
        dueDate: { lt: now },
        status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] },
      },
      include: {
        unit: {
          select: {
            id: true,
            label: true,
            building: {
              select: {
                name: true,
              },
            },
          },
        },
        paymentAllocations: {
          include: {
            payment: {
              select: {
                status: true,
              },
            },
          },
        },
      },
      take: 5000,
    });

    const debtByUnit = new Map<
      string,
      { unitLabel: string; buildingName: string; outstanding: number }
    >();

    for (const charge of overdueCharges) {
      const approvedAllocated = charge.paymentAllocations.reduce((acc, allocation) => {
        if (
          allocation.payment?.status === PaymentStatus.APPROVED ||
          allocation.payment?.status === PaymentStatus.RECONCILED
        ) {
          return acc + allocation.amount;
        }
        return acc;
      }, 0);

      const outstanding = Math.max(0, charge.amount - approvedAllocated);
      if (outstanding <= 0) {
        continue;
      }

      const existing = debtByUnit.get(charge.unitId) ?? {
        unitLabel: charge.unit?.label || charge.unitId,
        buildingName: charge.unit?.building?.name || 'N/A',
        outstanding: 0,
      };
      existing.outstanding += outstanding;
      debtByUnit.set(charge.unitId, existing);
    }

    const rows = [...debtByUnit.entries()]
      .map(([unitId, info]) => ({ unitId, ...info }))
      .sort((a, b) => b.outstanding - a.outstanding);

    if (rows.length === 0) {
      return {
        answer: 'No hay unidades morosas para el tenant en este momento.',
        responseType: 'no_data',
        actions: [
          { key: 'open-charges', label: 'Open Charges' },
          { key: 'open-units', label: 'Open Units' },
        ],
        metadata: {
          noData: true,
          itemCount: 0,
        },
      };
    }

    const preview = rows
      .slice(0, 5)
      .map(
        (row) =>
          `${row.unitLabel} (${row.buildingName}): ${this.formatCurrency(row.outstanding)}`,
      )
      .join(' | ');

    return {
      answer: `Hay ${rows.length} unidades con deuda vencida. Top morosos: ${preview}.`,
      responseType: 'list',
      actions: [
        { key: 'open-charges', label: 'Open Charges' },
        { key: 'open-units', label: 'Open Units' },
      ],
      metadata: {
        itemCount: rows.length,
        top: rows.slice(0, 10),
      },
    };
  }

  private async pendingPaymentsResolver(
    context: AssistantReadOnlyQueryContext,
  ): Promise<ResolverResult> {
    const [count, pending] = await Promise.all([
      this.prisma.payment.count({
        where: {
          tenantId: context.tenantId,
          status: PaymentStatus.SUBMITTED,
          canceledAt: null,
        },
      }),
      this.prisma.payment.findMany({
        where: {
          tenantId: context.tenantId,
          status: PaymentStatus.SUBMITTED,
          canceledAt: null,
        },
        include: {
          unit: {
            select: {
              label: true,
              building: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
    ]);

    if (count === 0) {
      return {
        answer: 'No hay pagos pendientes de aprobación.',
        responseType: 'no_data',
        actions: [{ key: 'open-payments', label: 'Open Payments' }],
        metadata: {
          noData: true,
          itemCount: 0,
        },
      };
    }

    const preview = pending
      .slice(0, 5)
      .map((payment) => {
        const unitLabel = payment.unit?.label || 'Sin unidad';
        const buildingName = payment.unit?.building?.name || 'N/A';
        return `${unitLabel} (${buildingName}): ${this.formatCurrency(payment.amount)}`;
      })
      .join(' | ');

    const totalPendingAmount = pending.reduce((sum, payment) => sum + payment.amount, 0);

    return {
      answer: `Hay ${count} pagos pendientes de aprobación. Vista previa: ${preview}.`,
      responseType: 'list',
      actions: [{ key: 'open-payments', label: 'Open Payments' }],
      metadata: {
        itemCount: count,
        pendingAmountPreview: totalPendingAmount,
      },
    };
  }

  private async openTicketsResolver(
    context: AssistantReadOnlyQueryContext,
  ): Promise<ResolverResult> {
    const [count, tickets] = await Promise.all([
      this.prisma.ticket.count({
        where: {
          tenantId: context.tenantId,
          status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        },
      }),
      this.prisma.ticket.findMany({
        where: {
          tenantId: context.tenantId,
          status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        },
        include: {
          building: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
    ]);

    if (count === 0) {
      return {
        answer: 'No hay tickets abiertos o en progreso.',
        responseType: 'no_data',
        actions: [{ key: 'open-tickets', label: 'Open Support' }],
        metadata: {
          noData: true,
          itemCount: 0,
        },
      };
    }

    const preview = tickets
      .slice(0, 5)
      .map((ticket) => `${ticket.title} (${ticket.building?.name || 'N/A'})`)
      .join(' | ');

    return {
      answer: `Hay ${count} tickets abiertos/en progreso. Prioritarios: ${preview}.`,
      responseType: 'list',
      actions: [{ key: 'open-tickets', label: 'Open Support' }],
      metadata: {
        itemCount: count,
        top: tickets.slice(0, 10).map((ticket) => ({
          id: ticket.id,
          title: ticket.title,
          status: ticket.status,
          buildingName: ticket.building?.name || null,
        })),
      },
    };
  }

  private async vacantUnitsResolver(
    context: AssistantReadOnlyQueryContext,
  ): Promise<ResolverResult> {
    const [count, units] = await Promise.all([
      this.prisma.unit.count({
        where: {
          building: {
            tenantId: context.tenantId,
          },
          occupancyStatus: 'VACANT',
        },
      }),
      this.prisma.unit.findMany({
        where: {
          building: {
            tenantId: context.tenantId,
          },
          occupancyStatus: 'VACANT',
        },
        include: {
          building: {
            select: {
              name: true,
            },
          },
        },
        orderBy: [{ buildingId: 'asc' }, { code: 'asc' }],
        take: 20,
      }),
    ]);

    if (count === 0) {
      return {
        answer: 'No hay unidades vacantes en este momento.',
        responseType: 'no_data',
        actions: [{ key: 'open-units', label: 'Open Units' }],
        metadata: {
          noData: true,
          itemCount: 0,
        },
      };
    }

    const preview = units
      .slice(0, 8)
      .map((unit) => `${unit.label || unit.code} (${unit.building?.name || 'N/A'})`)
      .join(' | ');

    return {
      answer: `Hay ${count} unidades vacantes. Vista previa: ${preview}.`,
      responseType: 'list',
      actions: [{ key: 'open-units', label: 'Open Units' }],
      metadata: {
        itemCount: count,
        top: units.slice(0, 20).map((unit) => ({
          id: unit.id,
          code: unit.code,
          label: unit.label,
          buildingName: unit.building?.name || null,
        })),
      },
    };
  }

  private async collectionsSummaryResolver(
    context: AssistantReadOnlyQueryContext,
  ): Promise<ResolverResult> {
    const now = new Date();
    const period = this.toPeriod(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const charges = await this.prisma.charge.findMany({
      where: {
        tenantId: context.tenantId,
        period,
        canceledAt: null,
      },
      include: {
        paymentAllocations: {
          include: {
            payment: {
              select: {
                status: true,
              },
            },
          },
        },
      },
      take: 10000,
    });

    const emitted = charges.reduce((sum, charge) => sum + charge.amount, 0);
    const collectedApplied = charges.reduce((sum, charge) => {
      const approvedAllocations = charge.paymentAllocations.reduce((allocSum, allocation) => {
        if (
          allocation.payment?.status === PaymentStatus.APPROVED ||
          allocation.payment?.status === PaymentStatus.RECONCILED
        ) {
          return allocSum + allocation.amount;
        }
        return allocSum;
      }, 0);
      return sum + approvedAllocations;
    }, 0);

    const outstanding = Math.max(0, emitted - collectedApplied);

    const [pendingApprovals, approvedInMonth] = await Promise.all([
      this.prisma.payment.count({
        where: {
          tenantId: context.tenantId,
          status: PaymentStatus.SUBMITTED,
          canceledAt: null,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          tenantId: context.tenantId,
          status: { in: [PaymentStatus.APPROVED, PaymentStatus.RECONCILED] },
          updatedAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
          canceledAt: null,
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const approvedTotal = approvedInMonth._sum.amount || 0;
    const collectionRate = emitted > 0 ? collectedApplied / emitted : 0;

    if (emitted === 0 && approvedTotal === 0) {
      return {
        answer: `No hay movimientos de cobranzas para el período ${period}.`,
        responseType: 'no_data',
        actions: [{ key: 'open-charges', label: 'Open Charges' }],
        metadata: {
          noData: true,
          period,
          emitted,
          collectedApplied,
          outstanding,
          pendingApprovals,
        },
      };
    }

    return {
      answer: `Resumen ${period}: emitido ${this.formatCurrency(emitted)}, cobrado aplicado ${this.formatCurrency(collectedApplied)}, pendiente ${this.formatCurrency(outstanding)}, tasa de cobranza ${(collectionRate * 100).toFixed(1)}%, pagos pendientes de aprobación ${pendingApprovals}.`,
      responseType: 'summary',
      actions: [
        { key: 'open-charges', label: 'Open Charges' },
        { key: 'open-payments', label: 'Open Payments' },
      ],
      metadata: {
        period,
        metricValue: Number((collectionRate * 100).toFixed(2)),
        emitted,
        collectedApplied,
        outstanding,
        pendingApprovals,
        approvedTotal,
      },
    };
  }

  private async unitPrimaryResidentResolver(
    context: AssistantReadOnlyQueryContext,
    question: string,
  ): Promise<ResolverResult> {
    const normalizedQuestion = this.normalizeText(question);
    const unitToken = this.extractUnitToken(normalizedQuestion);
    const towerToken = this.extractTowerToken(normalizedQuestion);

    if (!unitToken || !towerToken) {
      return {
        answer:
          'Necesito unidad y torre exactas para responder. Ejemplo: "Como se llama el residente del apartamento 12-8 Torre A".',
        responseType: 'clarification',
        actions: [{ key: 'open-units', label: 'Open Units' }],
        metadata: { needsClarification: true },
      };
    }

    const buildings = await this.prisma.building.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, name: true },
    });

    const matchedBuildings = buildings.filter((building) =>
      this.matchesTowerToken(building.name, towerToken),
    );

    if (matchedBuildings.length === 0) {
      return {
        answer: `No encontre la torre "${towerToken.toUpperCase()}" en este tenant.`,
        responseType: 'clarification',
        actions: [{ key: 'open-buildings', label: 'Open Buildings' }],
        metadata: { noTowerMatch: true },
      };
    }

    if (matchedBuildings.length > 1) {
      return {
        answer: `Hay mas de una torre coincidente (${matchedBuildings.map((b) => b.name).join(', ')}). Necesito el nombre exacto.`,
        responseType: 'clarification',
        actions: [{ key: 'open-buildings', label: 'Open Buildings' }],
        metadata: { ambiguousTower: true, matches: matchedBuildings.map((b) => b.name) },
      };
    }

    const building = matchedBuildings[0]!;
    const units = await this.prisma.unit.findMany({
      where: { buildingId: building.id },
      select: { id: true, code: true, label: true },
    });

    const matchedUnits = units.filter((unit) => this.matchesUnitToken(unit, unitToken));
    if (matchedUnits.length === 0) {
      return {
        answer: `No encontre la unidad "${unitToken}" en ${building.name}.`,
        responseType: 'clarification',
        actions: [{ key: 'open-units', label: 'Open Units' }],
        metadata: { noUnitMatch: true },
      };
    }

    if (matchedUnits.length > 1) {
      return {
        answer: `La unidad es ambigua. Coincide con: ${matchedUnits.map((u) => u.label || u.code).join(', ')}.`,
        responseType: 'clarification',
        actions: [{ key: 'open-units', label: 'Open Units' }],
        metadata: { ambiguousUnit: true, matches: matchedUnits.map((u) => u.label || u.code) },
      };
    }

    const unit = matchedUnits[0]!;
    const occupants = await this.prisma.unitOccupant.findMany({
      where: { unitId: unit.id, endDate: null },
      include: {
        member: {
          select: { id: true, name: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (occupants.length === 0) {
      return {
        answer: `La unidad ${unit.label || unit.code} de ${building.name} no tiene ocupantes activos.`,
        responseType: 'no_data',
        actions: [{ key: 'open-units', label: 'Open Units' }],
        metadata: { noOccupants: true },
      };
    }

    const primaryOccupants = occupants.filter((o) => o.isPrimary);
    if (primaryOccupants.length > 1) {
      return {
        answer: `Hay mas de un ocupante primario en ${building.name} unidad ${unit.label || unit.code}.`,
        responseType: 'clarification',
        actions: [{ key: 'open-units', label: 'Open Units' }],
        metadata: { multiplePrimary: true },
      };
    }

    const selected =
      primaryOccupants[0] ??
      occupants.find((o) => o.role === UnitOccupantRole.OWNER) ??
      occupants[0];

    if (!selected) {
      return {
        answer: `No pude determinar un ocupante activo para ${building.name} unidad ${unit.label || unit.code}.`,
        responseType: 'clarification',
        actions: [{ key: 'open-units', label: 'Open Units' }],
        metadata: { noSelectedOccupant: true },
      };
    }

    return {
      answer: `En ${building.name}, la unidad ${unit.label || unit.code} tiene como ocupante principal a ${selected.member?.name || 'N/A'}.`,
      responseType: 'summary',
      actions: [{ key: 'open-units', label: 'Open Units' }],
      metadata: {
        buildingId: building.id,
        unitId: unit.id,
        occupantId: selected.id,
      },
    };
  }

  private normalizeContext(context: AssistantReadOnlyQueryContext): AssistantReadOnlyQueryContext {
    const tenantId = (context.tenantId ?? '').trim();
    const userId = (context.userId ?? '').trim();
    const role = (context.role ?? '').trim().toUpperCase();

    if (!tenantId || !userId || !role) {
      throw new BadRequestException('context.tenantId, context.userId and context.role are required');
    }

    return {
      ...context,
      tenantId,
      userId,
      role,
    };
  }

  private async assertMembershipAndRole(
    context: AssistantReadOnlyQueryContext,
    allowedRoles: string[],
  ): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId: context.userId,
          tenantId: context.tenantId,
        },
      },
      include: {
        roles: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException('User is not a member of the tenant');
    }

    const membershipRoles = membership.roles.map((membershipRole) =>
      String(membershipRole.role),
    );

    if (!membershipRoles.includes(context.role)) {
      throw new ForbiddenException('Role does not match tenant membership');
    }

    if (!allowedRoles.includes(context.role)) {
      throw new ForbiddenException('Role not allowed for this read-only intent');
    }
  }

  private assertAuthoritativeHeaderConsistency(
    context: AssistantReadOnlyQueryContext,
    headers: {
      tenantId?: string;
      userId?: string;
      role?: string;
    },
  ): void {
    if (headers.tenantId && headers.tenantId.trim() !== context.tenantId) {
      throw new ForbiddenException('Tenant mismatch between header and context');
    }
    if (headers.userId && headers.userId.trim() !== context.userId) {
      throw new ForbiddenException('User mismatch between header and context');
    }
    if (headers.role && headers.role.trim().toUpperCase() !== context.role) {
      throw new ForbiddenException('Role mismatch between header and context');
    }
  }

  private assertCanaryTenantEnabled(tenantId: string): void {
    const allowlist = this.parseCsvEnv(
      process.env.ASSISTANT_READONLY_CANARY_TENANTS || process.env.BUILDINGOS_ASSISTANT_CANARY_TENANTS,
    );

    if (allowlist.length === 0) {
      return;
    }

    if (!allowlist.includes(tenantId)) {
      throw new ForbiddenException('Read-only assistant is not enabled for this tenant');
    }
  }

  private assertApiKey(apiKey?: string): void {
    const keys = this.parseCsvEnv(
      process.env.ASSISTANT_READONLY_API_KEYS || process.env.BUILDINGOS_READONLY_QUERY_API_KEY,
    );

    if (keys.length === 0) {
      throw new UnauthorizedException('Read-only assistant API key is not configured');
    }

    if (!apiKey || !keys.includes(apiKey)) {
      throw new UnauthorizedException('Invalid API key for read-only assistant endpoint');
    }
  }

  private parseCsvEnv(value?: string): string[] {
    if (!value) {
      return [];
    }

    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private buildControlledResponse(payload: ResolverResult): AssistantReadOnlyQueryResponse {
    return {
      answer: payload.answer,
      answerSource: 'live_data',
      responseType: payload.responseType,
      dataScope: 'tenant',
      actions: payload.actions,
      metadata: payload.metadata,
    };
  }

  private formatCurrency(cents: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  }

  private toPeriod(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private normalizeText(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private extractUnitToken(message: string): string | null {
    const match = message.match(/(?:unidad|apartamento|depto|depar?tamento|apto)\s+([a-z0-9-]+)/i);
    return match?.[1] || null;
  }

  private extractTowerToken(message: string): string | null {
    const match = message.match(/torre\s+([a-z0-9]+)/i);
    return match?.[1] || null;
  }

  private matchesTowerToken(buildingName: string, towerToken: string): boolean {
    const normalizedName = this.normalizeText(buildingName);
    const token = this.normalizeText(towerToken);
    return normalizedName === `torre ${token}` || normalizedName.includes(`torre ${token}`);
  }

  private matchesUnitToken(unit: { code: string; label: string | null }, unitToken: string): boolean {
    const token = this.normalizeText(unitToken);
    const compactToken = token.replace(/[^a-z0-9]/g, '');
    const code = this.normalizeText(unit.code);
    const compactCode = code.replace(/[^a-z0-9]/g, '');
    const label = this.normalizeText(unit.label || '');
    const floorDeptMatch = token.match(/^(\d{1,2})-(\d{1,2})$/);
    const derivedCode = floorDeptMatch
      ? `${floorDeptMatch[1]}${floorDeptMatch[2]}`
      : null;
    return (
      code === token ||
      label === token ||
      compactCode === compactToken ||
      (derivedCode !== null && compactCode === derivedCode)
    );
  }
}

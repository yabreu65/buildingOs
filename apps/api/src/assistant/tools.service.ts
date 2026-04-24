import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, ChargeStatus, PaymentStatus, TicketStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ASSISTANT_RESPONSE_SCHEMA_VERSION,
  AssistantToolName,
  AssistantToolRequest,
  AssistantToolResponse,
} from './tools.types';

const TOOL_PERMISSION = {
  resolve_unit_ref: 'tools.resolve_unit_ref',
  get_unit_balance: 'tools.get_unit_balance',
  get_unit_profile: 'tools.get_unit_profile',
  search_payments: 'tools.search_payments',
  search_tickets: 'tools.search_tickets',
} as const;

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: Object.values(TOOL_PERMISSION),
  TENANT_OWNER: Object.values(TOOL_PERMISSION),
  TENANT_ADMIN: Object.values(TOOL_PERMISSION),
  OPERATOR: Object.values(TOOL_PERMISSION),
  RESIDENT: [],
};

@Injectable()
export class AssistantToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async executeTool(
    toolName: AssistantToolName,
    request: AssistantToolRequest,
    headers: { apiKey?: string; tenantId?: string; userId?: string; role?: string },
  ): Promise<AssistantToolResponse> {
    const startedAt = Date.now();
    this.assertApiKey(headers.apiKey);
    const context = this.normalizeAndValidateContext(request.context, headers);
    await this.assertMembershipAndPermissions(context.tenantId, context.userId, context.role, toolName);

    let response: AssistantToolResponse;
    switch (toolName) {
      case 'resolve_unit_ref':
        response = await this.resolveUnitRef(context.tenantId, request.question, request.toolInput);
        break;
      case 'get_unit_balance':
        response = await this.getUnitBalance(context.tenantId, request.question, request.toolInput);
        break;
      case 'get_unit_profile':
        response = await this.getUnitProfile(context.tenantId, request.question, request.toolInput);
        break;
      case 'search_payments':
        response = await this.searchPayments(context.tenantId, request.question, request.toolInput);
        break;
      case 'search_tickets':
        response = await this.searchTickets(context.tenantId, request.question, request.toolInput);
        break;
      default:
        throw new BadRequestException(`Unsupported tool: ${toolName}`);
    }

    void this.audit.createLog({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: AuditAction.AI_INTERACTION,
      entityType: 'AssistantTool',
      entityId: context.tenantId,
      metadata: {
        intentCode: request.intentCode ?? null,
        toolName,
        resultType: response.responseType,
        answerSource: response.answerSource,
        latencyMs: Date.now() - startedAt,
      },
    });

    return response;
  }

  private async resolveUnitRef(
    tenantId: string,
    question?: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const ranking = this.pickRanking(input);
    const buildingFilter = this.pickString(input, 'buildingName') ?? this.extractTowerToken(question ?? '');
    const unitFilter =
      this.pickString(input, 'unitRef') ??
      this.pickString(input, 'unitCode') ??
      this.extractUnitToken(question ?? '');

    const buildings = await this.prisma.building.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    if (buildings.length > 1 && !buildingFilter) {
      const options = buildings.slice(0, 2).map((b, i) => `${i + 1}) ${b.name}`).join(' | ');
      return this.buildResponse(
        `Necesito que indiques el edificio. Opciones: ${options}`,
        'clarification',
        {
          needsBuilding: true,
          buildingOptions: buildings.slice(0, 2).map((b) => b.name),
          ranking,
        },
      );
    }

    const matchedBuildings = buildingFilter
      ? buildings.filter((b) => this.normalize(b.name).includes(this.normalize(buildingFilter)))
      : buildings;

    if (matchedBuildings.length === 0) {
      return this.buildResponse('No encontré edificio para esa referencia.', 'clarification', {
        noBuildingMatch: true,
      });
    }

    const buildingIds = matchedBuildings.map((b) => b.id);
    const units = await this.prisma.unit.findMany({
      where: { buildingId: { in: buildingIds } },
      select: {
        id: true,
        code: true,
        label: true,
        buildingId: true,
        building: { select: { name: true } },
      },
      orderBy: [{ buildingId: 'asc' }, { code: 'asc' }],
      take: 200,
    });

    const matchedUnits = unitFilter
      ? units.filter((u) => this.matchesUnit(u.code, u.label, unitFilter))
      : units;

    if (matchedUnits.length === 0) {
      return this.buildResponse('No encontré unidad para esa referencia.', 'clarification', {
        noUnitMatch: true,
      });
    }

    if (matchedUnits.length > 1) {
      return this.buildResponse(
        `Referencia ambigua. Opciones: ${matchedUnits
          .slice(0, 2)
          .map((u, i) => `${i + 1}) ${u.building?.name ?? 'N/A'} ${u.label ?? u.code}`)
          .join(' | ')}`,
        'clarification',
        {
          ambiguousUnit: true,
          options: matchedUnits.slice(0, 2).map((u) => ({ id: u.id, label: u.label ?? u.code })),
        },
      );
    }

    const selected = matchedUnits[0]!;
    return this.buildResponse(
      `Unidad resuelta: ${selected.building?.name ?? 'N/A'} ${selected.label ?? selected.code}.`,
      'summary',
      {
        buildingId: selected.buildingId,
        unitId: selected.id,
        unitCode: selected.code,
      },
    );
  }

  private async getUnitBalance(
    tenantId: string,
    question?: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const unitResolution = await this.resolveUnitRef(tenantId, question, input);
    const unitId = this.pickString(unitResolution.metadata, 'unitId');
    if (!unitId) {
      return unitResolution;
    }

    const debtStatus = (this.pickString(input, 'debtStatus') ?? 'OVERDUE').toUpperCase();
    const now = new Date();
    const unit = await this.prisma.unit.findUniqueOrThrow({
      where: { id: unitId },
      select: { id: true, code: true, label: true, building: { select: { name: true } } },
    });

    const charges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        unitId,
        canceledAt: null,
        ...(debtStatus === 'OVERDUE' ? { dueDate: { lt: now } } : {}),
        status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] },
      },
      include: {
        paymentAllocations: { include: { payment: { select: { status: true } } } },
      },
    });

    const outstanding = charges.reduce((sum, charge) => {
      const allocated = charge.paymentAllocations.reduce((allocSum, allocation) => {
        const status = allocation.payment?.status;
        if (status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) {
          return allocSum + allocation.amount;
        }
        return allocSum;
      }, 0);
      return sum + Math.max(0, charge.amount - allocated);
    }, 0);

    const answer = outstanding > 0
      ? `La unidad ${unit.label ?? unit.code} (${unit.building.name}) tiene deuda pendiente de ${this.formatMoney(outstanding)}.`
      : `La unidad ${unit.label ?? unit.code} (${unit.building.name}) no tiene deuda pendiente.`;

    return this.buildResponse(answer, 'summary', {
      unitId,
      debtStatus,
      outstanding,
    });
  }

  private async getUnitProfile(
    tenantId: string,
    question?: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const unitResolution = await this.resolveUnitRef(tenantId, question, input);
    const unitId = this.pickString(unitResolution.metadata, 'unitId');
    if (!unitId) {
      return unitResolution;
    }

    const fields = this.pickStringArray(input?.fields) ?? [
      'occupants',
      'primaryResident',
      'building',
      'unit',
    ];

    const unit = await this.prisma.unit.findUniqueOrThrow({
      where: { id: unitId },
      select: {
        id: true,
        code: true,
        label: true,
        building: { select: { id: true, name: true } },
      },
    });

    const occupants = await this.prisma.unitOccupant.findMany({
      where: { unitId, endDate: null },
      include: { member: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const primary = occupants.find((o) => o.isPrimary) ?? occupants[0] ?? null;
    const answer = primary?.member?.name
      ? `Perfil unidad ${unit.label ?? unit.code} (${unit.building.name}): ocupante principal ${primary.member.name}.`
      : `Perfil unidad ${unit.label ?? unit.code} (${unit.building.name}): sin ocupante principal definido.`;

    return this.buildResponse(answer, 'summary', {
      unitId,
      fields,
      primaryResident: primary?.member?.name ?? null,
      occupantCount: occupants.length,
    });
  }

  private async searchPayments(
    tenantId: string,
    question?: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const ranking = this.pickRanking(input);
    const mode = (this.pickString(input, 'mode') ?? '').toLowerCase();

    if (mode === 'overdue_units') {
      const now = new Date();
      const charges = await this.prisma.charge.findMany({
        where: {
          tenantId,
          canceledAt: null,
          dueDate: { lt: now },
          status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] },
        },
        include: {
          unit: { select: { id: true, label: true, code: true, building: { select: { name: true } } } },
          paymentAllocations: { include: { payment: { select: { status: true } } } },
        },
        take: 5000,
      });

      const debtByUnit = new Map<string, { label: string; building: string; amount: number }>();
      for (const charge of charges) {
        const allocated = charge.paymentAllocations.reduce((sum, allocation) => {
          const status = allocation.payment?.status;
          if (status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) {
            return sum + allocation.amount;
          }
          return sum;
        }, 0);
        const outstanding = Math.max(0, charge.amount - allocated);
        if (outstanding <= 0) continue;
        const current = debtByUnit.get(charge.unitId) ?? {
          label: charge.unit?.label ?? charge.unit?.code ?? charge.unitId,
          building: charge.unit?.building?.name ?? 'N/A',
          amount: 0,
        };
        current.amount += outstanding;
        debtByUnit.set(charge.unitId, current);
      }

      const top = [...debtByUnit.entries()]
        .map(([unitId, info]) => ({ unitId, ...info }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, ranking);

      return this.buildResponse(
        top.length === 0
          ? 'No hay unidades con deuda vencida.'
          : `Top ${top.length} unidades con deuda vencida: ${top
              .map((item) => `${item.label} (${item.building}) ${this.formatMoney(item.amount)}`)
              .join(' | ')}.`,
        top.length === 0 ? 'no_data' : 'list',
        { ranking, debtStatus: 'OVERDUE', top },
      );
    }

    const statuses = this.pickStringArray(input?.status)?.map((s) => s.toUpperCase()) ?? ['SUBMITTED'];
    const rows = await this.prisma.payment.findMany({
      where: {
        tenantId,
        status: { in: statuses as PaymentStatus[] },
        canceledAt: null,
      },
      include: {
        unit: { select: { label: true, code: true, building: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: ranking,
    });

    const answer = rows.length === 0
      ? 'No hay pagos para ese filtro.'
      : `Pagos encontrados: ${rows
          .map((row) => `${row.unit?.label ?? row.unit?.code ?? 'N/A'} (${row.unit?.building?.name ?? 'N/A'}) ${this.formatMoney(row.amount)}`)
          .join(' | ')}.`;
    return this.buildResponse(answer, rows.length === 0 ? 'no_data' : 'list', {
      ranking,
      count: rows.length,
      status: statuses,
    });
  }

  private async searchTickets(
    tenantId: string,
    _question?: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const ranking = this.pickRanking(input);
    const statuses = this.pickStringArray(input?.status)?.map((s) => s.toUpperCase()) ?? [
      'OPEN',
      'IN_PROGRESS',
    ];

    const rows = await this.prisma.ticket.findMany({
      where: {
        tenantId,
        status: { in: statuses as TicketStatus[] },
      },
      include: { building: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: ranking,
    });

    const answer = rows.length === 0
      ? 'No hay tickets para ese filtro.'
      : `Tickets activos: ${rows.map((t) => `${t.title} (${t.building?.name ?? 'N/A'})`).join(' | ')}.`;
    return this.buildResponse(answer, rows.length === 0 ? 'no_data' : 'list', {
      ranking,
      count: rows.length,
      statuses,
    });
  }

  private async assertMembershipAndPermissions(
    tenantId: string,
    userId: string,
    role: string,
    toolName: AssistantToolName,
  ): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { roles: true },
    });
    if (!membership) {
      throw new ForbiddenException('User is not a member of the tenant');
    }

    const membershipRoles = membership.roles.map((item) => String(item.role));
    if (!membershipRoles.includes(role)) {
      throw new ForbiddenException('Role does not match tenant membership');
    }

    const rolePermissions = this.getRolePermissionPolicy();
    const rolePerms = rolePermissions[role] ?? [];
    const requiredPermission = TOOL_PERMISSION[toolName];
    if (!rolePerms.includes(requiredPermission)) {
      throw new ForbiddenException(`Role not allowed for tool ${toolName}`);
    }
  }

  private normalizeAndValidateContext(
    context: AssistantToolRequest['context'],
    headers: { tenantId?: string; userId?: string; role?: string },
  ): { tenantId: string; userId: string; role: string } {
    if (!context) {
      throw new BadRequestException('context is required');
    }

    const tenantId = String(context.tenantId ?? '').trim();
    const userId = String(context.userId ?? '').trim();
    const role = String(context.role ?? '').trim().toUpperCase();

    if (!tenantId || !userId || !role) {
      throw new BadRequestException('context.tenantId, context.userId and context.role are required');
    }

    if (headers.tenantId && headers.tenantId.trim() !== tenantId) {
      throw new ForbiddenException('Tenant mismatch between header and context');
    }
    if (headers.userId && headers.userId.trim() !== userId) {
      throw new ForbiddenException('User mismatch between header and context');
    }
    if (headers.role && headers.role.trim().toUpperCase() !== role) {
      throw new ForbiddenException('Role mismatch between header and context');
    }

    return { tenantId, userId, role };
  }

  private assertApiKey(apiKey?: string): void {
    const configured = (process.env.ASSISTANT_READONLY_API_KEYS || process.env.BUILDINGOS_READONLY_QUERY_API_KEY || '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (configured.length === 0) {
      throw new UnauthorizedException('Read-only assistant API key is not configured');
    }
    if (!apiKey || !configured.includes(apiKey.trim())) {
      throw new UnauthorizedException('Invalid API key for assistant tools endpoint');
    }
  }

  private getRolePermissionPolicy(): Record<string, string[]> {
    const raw = process.env.ASSISTANT_TOOLS_ROLE_PERMISSIONS_JSON;
    if (!raw || raw.trim().length === 0) {
      return DEFAULT_ROLE_PERMISSIONS;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      return Object.entries(parsed).reduce<Record<string, string[]>>((acc, [role, permissions]) => {
        acc[role.toUpperCase()] = Array.isArray(permissions) ? permissions.map((p) => String(p)) : [];
        return acc;
      }, {});
    } catch {
      return DEFAULT_ROLE_PERMISSIONS;
    }
  }

  private buildResponse(
    answer: string,
    responseType: AssistantToolResponse['responseType'],
    metadata: Record<string, unknown>,
  ): AssistantToolResponse {
    return {
      contractVersion: ASSISTANT_RESPONSE_SCHEMA_VERSION,
      answer,
      answerSource: 'live_data',
      responseType,
      dataScope: 'tenant',
      actions: [],
      metadata,
    };
  }

  private pickString(value: unknown, key: string): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private pickStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
      return null;
    }
    const parsed = value.map((item) => String(item).trim()).filter((item) => item.length > 0);
    return parsed.length > 0 ? parsed : null;
  }

  private pickRanking(value?: Record<string, unknown>): number {
    const raw = value?.ranking;
    const numeric = typeof raw === 'number' ? raw : Number(raw ?? 5);
    if (!Number.isFinite(numeric)) {
      return 5;
    }
    return Math.min(20, Math.max(1, Math.floor(numeric)));
  }

  private extractTowerToken(message: string): string | null {
    const match = this.normalize(message).match(/torre\s+([a-z0-9]+)/i);
    return match?.[1] ?? null;
  }

  private extractUnitToken(message: string): string | null {
    const match = this.normalize(message).match(
      /(?:unidad|apartamento|depto|departamento|apto)\s+([a-z0-9-]+)/i,
    );
    return match?.[1] ?? null;
  }

  private matchesUnit(code: string, label: string | null, token: string): boolean {
    const normalizedToken = this.normalize(token);
    const compactToken = normalizedToken.replace(/[^a-z0-9]/g, '');
    const normalizedCode = this.normalize(code);
    const normalizedLabel = this.normalize(label ?? '');
    return (
      normalizedCode === normalizedToken ||
      normalizedLabel === normalizedToken ||
      normalizedCode.replace(/[^a-z0-9]/g, '') === compactToken
    );
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private formatMoney(cents: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  }
}

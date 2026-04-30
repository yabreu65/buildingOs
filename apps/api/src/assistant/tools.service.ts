import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { AuditAction, ChargeStatus, PaymentStatus, TicketStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProcessSearchService, ProcessSummaryInput, SearchProcessesInput } from '../process/process-search.service';
import { CrossQueryService } from './cross-query.service';
import {
  ASSISTANT_TOOL_REQUEST_CONTRACT_VERSION,
  ASSISTANT_RESPONSE_SCHEMA_VERSION,
  ASSISTANT_RESPONSE_SCHEMA_VERSION_V2,
  AssistantToolName,
  AssistantToolRequest,
  AssistantToolResponse,
} from './tools.types';

const TOOL_PERMISSION = {
  resolve_unit_ref: 'tools.resolve_unit_ref',
  get_unit_balance: 'tools.get_unit_balance',
  get_unit_profile: 'tools.get_unit_profile',
  get_unit_payments: 'tools.get_unit_payments',
  get_unit_balance_by_period: 'tools.get_unit_balance_by_period',
  search_payments: 'tools.search_payments',
  analytics_debt_aging: 'tools.analytics_debt_aging',
  analytics_debt_by_tower: 'tools.analytics_debt_by_tower',
  search_tickets: 'tools.search_tickets',
  get_unit_debt_trend: 'tools.get_unit_debt_trend',
  get_building_debt_trend: 'tools.get_building_debt_trend',
  get_collections_trend: 'tools.get_collections_trend',
  search_processes: 'tools.search_processes',
  get_process_summary: 'tools.get_process_summary',
  search_claims: 'tools.search_claims',
  cross_query: 'tools.cross_query',
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
    private readonly processSearch: ProcessSearchService,
    private readonly crossQuery: CrossQueryService,
  ) {}

  async executeTool(
    toolName: AssistantToolName,
    request: AssistantToolRequest,
    headers: { apiKey?: string; tenantId?: string; userId?: string; role?: string },
  ): Promise<AssistantToolResponse> {
    const startedAt = Date.now();
    this.assertApiKey(headers.apiKey);
    const context = this.normalizeAndValidateContext(request.context, headers);

    let response: AssistantToolResponse;
    try {
      await this.assertMembershipAndPermissions(context.tenantId, context.userId, context.role, toolName);

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
        case 'get_unit_payments':
          response = await this.getUnitPayments(context.tenantId, request.question, request.toolInput);
          break;
        case 'get_unit_balance_by_period':
          response = await this.getUnitBalanceByPeriod(context.tenantId, request.question, request.toolInput);
          break;
        case 'search_payments':
          response = await this.searchPayments(context.tenantId, request.question, request.toolInput);
          break;
        case 'analytics_debt_aging':
          response = await this.analyticsDebtAging(context.tenantId, request.toolInput);
          break;
        case 'analytics_debt_by_tower':
          response = await this.analyticsDebtByTower(context.tenantId, request.toolInput);
          break;
        case 'search_tickets':
          response = await this.searchTickets(context.tenantId, request.question, request.toolInput);
          break;
        case 'get_unit_debt_trend':
          response = await this.getUnitDebtTrend(context.tenantId, request.question ?? '', request.toolInput, request.responseContractVersion ?? ASSISTANT_RESPONSE_SCHEMA_VERSION);
          break;
        case 'get_building_debt_trend':
          response = await this.getBuildingDebtTrend(context.tenantId, request.toolInput, request.responseContractVersion ?? ASSISTANT_RESPONSE_SCHEMA_VERSION);
          break;
        case 'get_collections_trend':
          response = await this.getCollectionsTrend(context.tenantId, request.toolInput, request.responseContractVersion ?? ASSISTANT_RESPONSE_SCHEMA_VERSION);
          break;
        case 'search_processes':
          response = await this.searchProcesses(context.tenantId, request.toolInput);
          break;
        case 'get_process_summary':
          response = await this.getProcessSummary(context.tenantId, request.toolInput);
          break;
        case 'search_claims':
          response = await this.searchClaims(context.tenantId, request.toolInput);
          break;
        case 'cross_query':
          response = await this.executeCrossQuery(context.tenantId, context.role, request.toolInput);
          break;
        default:
          throw new BadRequestException(`Unsupported tool: ${toolName}`);
      }
    } catch (error) {
      // Handle operational tool errors with controlled responses
      // This prevents fallback to knowledge/docs when operational routes match
      const traceId = this.generateTraceId();
      const gatewayOutcome = this.getGatewayOutcomeFromError(error);

      response = this.buildControlledErrorResponse(gatewayOutcome, traceId, {
        originalError: error instanceof Error ? error.message : String(error),
        toolName,
      });
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

  /**
   * Builds a controlled error response for operational tools
   * Ensures no fallback to knowledge/docs when operational routes match
   */
  private buildControlledErrorResponse(
    gatewayOutcome: string,
    traceId: string,
    metadata: Record<string, unknown> = {},
  ): AssistantToolResponse {
    return {
      contractVersion: ASSISTANT_RESPONSE_SCHEMA_VERSION,
      answer: `No pude obtener datos operativos en este momento. Detalle: ${gatewayOutcome}. Referencia: ${traceId}`,
      answerSource: 'error',
      responseType: 'error',
      dataScope: 'tenant',
      actions: [],
      metadata: {
        ...metadata,
        gatewayOutcome,
        traceId,
      },
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
    const normalized = this.normalize(message);
    const match = normalized.match(/(?:torre|edificio|bloque)\s+([a-z0-9]+)/i);
    if (match?.[1]) return match[1];
    const towerDirectMatch = normalized.match(/^([a-z0-9]+)\s*-\s*\d+\s*$/);
    if (towerDirectMatch?.[1]) return towerDirectMatch[1];
    return null;
  }

  private extractUnitToken(message: string): string | null {
    const normalized = this.normalize(message);
    const explicitMatch = normalized.match(
      /(?:unidad|apartamento|depto|departamento|apto|piso)\s+([a-z0-9][-]?[a-z0-9]*)/i,
    );
    if (explicitMatch?.[1]) return explicitMatch[1];
    const directCodeMatch = normalized.match(/\b([a-z]\s*-\s*\d+|\d+\s*-\s*\d+)\b/i);
    if (directCodeMatch?.[1]) return directCodeMatch[1].replace(/\s/g, '');
    const standaloneUnitMatch = normalized.match(/\b([a-z]?\d{2,4})\b/);
    if (standaloneUnitMatch?.[1]) return standaloneUnitMatch[1];
    return null;
  }

  private matchesUnit(code: string, label: string | null, token: string): boolean {
    const normalizedCode = this.normalize(code).replace(/\s/g, '');
    const normalizedLabel = this.normalize(label ?? '').replace(/\s/g, '');
    const normalizedToken = this.normalize(token).replace(/\s/g, '');
    const compactToken = normalizedToken.replace(/[^a-z0-9]/g, '');
    if (
      normalizedCode === normalizedToken ||
      normalizedLabel === normalizedToken ||
      normalizedCode.replace(/[^a-z0-9]/g, '') === compactToken ||
      normalizedLabel.replace(/[^a-z0-9]/g, '') === compactToken
    ) {
      return true;
    }
    if (/^[a-z]-\d+$/i.test(token) || /^\d+-\d+$/.test(token)) {
      const compactTokenForMatch = token.replace(/[^a-z0-9]/gi, '');
      const codeNormalized = normalizedCode.replace(/[^a-z0-9]/gi, '');
      if (codeNormalized === compactTokenForMatch) return true;
      const labelNormalized = normalizedLabel.replace(/[^a-z0-9]/gi, '');
      if (labelNormalized === compactTokenForMatch) return true;
    }
    return false;
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

  private generateTraceId(): string {
    try {
      return crypto.randomUUID().slice(0, 8).toUpperCase();
    } catch {
      return `T${Date.now().toString(36).toUpperCase()}`;
    }
  }

  private getGatewayOutcomeFromError(error: unknown): string {
    if (error instanceof ForbiddenException) {
      return 'forbidden';
    }
    if (error instanceof BadRequestException) {
      return 'invalid_request';
    }
    if (error instanceof Error && error.message.includes('timeout')) {
      return 'timeout';
    }
    if (error instanceof Error && error.message.includes('unavailable')) {
      return 'unavailable';
    }
    return 'error';
  }

  private async getUnitPayments(
    tenantId: string,
    question?: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const unitResolution = await this.resolveUnitRef(tenantId, question, input);
    const unitId = this.pickString(unitResolution.metadata, 'unitId');
    if (!unitId) {
      return unitResolution;
    }

    const ranking = this.pickRanking(input);
    const orderByField = this.pickString(input, 'orderBy') ?? 'paidAt';
    const orderDirection = orderByField === 'createdAt' ? 'desc' : 'desc';

    const rows = await this.prisma.payment.findMany({
      where: { tenantId, unitId, canceledAt: null },
      include: { unit: { select: { label: true, code: true, building: { select: { name: true } } } } },
      orderBy: { [orderByField]: orderDirection },
      take: ranking,
    });

    const answer = rows.length === 0
      ? 'No hay pagos para esa unidad.'
      : `Últimos ${rows.length} pagos: ${rows.map((r) => `${this.formatMoney(r.amount)} (${r.status.toLowerCase()})`).join(' | ')}.`;
    return this.buildResponse(answer, rows.length === 0 ? 'no_data' : 'list', { unitId, ranking, count: rows.length });
  }

  private async getUnitBalanceByPeriod(
    tenantId: string,
    question?: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const unitResolution = await this.resolveUnitRef(tenantId, question, input);
    const unitId = this.pickString(unitResolution.metadata, 'unitId');
    if (!unitId) {
      return unitResolution;
    }

    const periodsBack = this.pickNumeric(input, 'periodsBack', 3, 12);
    const includeCurrent = this.pickBool(input, 'includeCurrent', false);
    const debtStatus = this.pickString(input, 'debtStatus') ?? 'OVERDUE';
    const asOf = this.pickString(input, 'asOf') ?? new Date().toISOString().split('T')[0];

    const periods = this.getLastCompletePeriods(periodsBack, includeCurrent);
    const balances: Record<string, number> = {};

    for (const period of periods) {
      const { from } = this.getPeriodDateRange(period);
      const charges = await this.prisma.charge.aggregate({
        where: { tenantId, unitId, period, canceledAt: null, ...(debtStatus === 'OVERDUE' ? { dueDate: { lt: new Date(from) } } : {}) },
        _sum: { amount: true },
      });
      const paid = await this.prisma.payment.aggregate({
        where: { tenantId, unitId, status: { in: [PaymentStatus.APPROVED, PaymentStatus.RECONCILED] }, canceledAt: null },
        _sum: { amount: true },
      });
      balances[period] = (charges._sum.amount ?? 0) - (paid._sum.amount ?? 0);
    }

    const answer = `Evolución de deuda (${periods.join(', ')}): ${Object.entries(balances).map(([p, a]) => `${p}: ${this.formatMoney(a)}`).join(' | ')}.`;
    return this.buildResponse(answer, 'list', { unitId, periods, balances, asOf });
  }

  private async analyticsDebtAging(
    tenantId: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const asOfInput = this.pickString(input, 'asOf');
    const asOf = asOfInput ? asOfInput : new Date().toISOString().split('T')[0] ?? '2026-04-24';
    const buildingIds = this.pickStringArray(input?.buildingIds);
    const now = new Date(asOf);

    const whereClause: Record<string, unknown> = { tenantId, canceledAt: null, dueDate: { lt: now }, status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] } };
    if (buildingIds && buildingIds.length > 0) {
      (whereClause as Record<string, unknown>).buildingId = { in: buildingIds };
    }

    const charges = await this.prisma.charge.findMany({
      where: whereClause as never,
      include: { unit: { select: { id: true, label: true, code: true, building: { select: { name: true } } } }, paymentAllocations: { include: { payment: { select: { status: true, amount: true } } } } },
    });

    const buckets = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
    for (const charge of charges) {
      const allocated = charge.paymentAllocations.reduce((sum, alloc) => {
        const status = alloc.payment?.status;
        return status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED ? sum + alloc.amount : sum;
      }, 0);
      const outstanding = Math.max(0, charge.amount - allocated);
      if (outstanding <= 0) continue;
      const daysOverdue = Math.floor((now.getTime() - charge.dueDate.getTime()) / (24 * 60 * 60 * 1000));
      let bucket: keyof typeof buckets = 'current';
      if (daysOverdue <= 30) bucket = '1_30';
      else if (daysOverdue <= 60) bucket = '31_60';
      else if (daysOverdue <= 90) bucket = '61_90';
      else bucket = '90_plus';
      buckets[bucket] += outstanding;
    }

    const answer = `Antigüedad: ${Object.entries(buckets).map(([b, a]) => `${b}: ${this.formatMoney(a)}`).join(' | ')}.`;
    return this.buildResponse(answer, 'metric', { asOf, buckets });
  }

  private async analyticsDebtByTower(
    tenantId: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const asOfInput = this.pickString(input, 'asOf');
    const asOf = asOfInput ? asOfInput : new Date().toISOString().split('T')[0] ?? '2026-04-24';
    const buildingIds = this.pickStringArray(input?.buildingIds);
    const now = new Date(asOf);

    const whereClause: Record<string, unknown> = { tenantId, canceledAt: null, dueDate: { lt: now }, status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] } };
    if (buildingIds && buildingIds.length > 0) {
      (whereClause as Record<string, unknown>).buildingId = { in: buildingIds };
    }

    const charges = await this.prisma.charge.findMany({
      where: whereClause as never,
      include: { unit: { select: { buildingId: true, label: true, building: { select: { name: true } } } }, paymentAllocations: { include: { payment: { select: { status: true, amount: true } } } } },
    });

    const debtByBuilding = new Map<string, { name: string; totalDebt: number; unitCount: number }>();
    for (const charge of charges) {
      const allocated = charge.paymentAllocations.reduce((sum, alloc) => {
        const status = alloc.payment?.status;
        return status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED ? sum + alloc.amount : sum;
      }, 0);
      const outstanding = Math.max(0, charge.amount - allocated);
      if (outstanding <= 0) continue;
      const name = charge.unit?.building?.name ?? 'N/A';
      const id = charge.unit?.buildingId ?? 'unknown';
      const current = debtByBuilding.get(id) ?? { name, totalDebt: 0, unitCount: 0 };
      current.totalDebt += outstanding;
      current.unitCount += 1;
      debtByBuilding.set(id, current);
    }

    const sorted = [...debtByBuilding.values()].sort((a, b) => b.totalDebt - a.totalDebt);
    const answer = sorted.length === 0 ? 'No hay deuda por edificio.' : `Deuda por edificio: ${sorted.map((b) => `${b.name}: ${this.formatMoney(b.totalDebt)} (${b.unitCount} uni)`).join(' | ')}.`;
    return this.buildResponse(answer, sorted.length === 0 ? 'no_data' : 'list', { asOf, buildings: sorted });
  }

  private pickNumeric(input: Record<string, unknown> | undefined, key: string, min: number, max: number): number {
    const raw = input?.[key];
    const value = typeof raw === 'number' ? raw : Number(raw ?? min);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min;
  }

  private pickBool(input: Record<string, unknown> | undefined, key: string, defaultValue: boolean): boolean {
    const raw = input?.[key];
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') return raw.toLowerCase() === 'true';
    return defaultValue;
  }

  private getLastCompletePeriods(count: number, includeCurrent: boolean): string[] {
    const now = new Date();
    const periods: string[] = [];
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    for (let i = 0; i < count + (includeCurrent ? 1 : 0); i++) {
      const monthOffset = includeCurrent ? i : i + 1;
      const targetMonth = currentMonth - monthOffset;
      const year = currentYear + Math.floor(targetMonth / 12);
      const month = ((targetMonth % 12) + 12) % 12 + 1;
      periods.push(`${year}-${String(month).padStart(2, '0')}`);
    }
    return periods.reverse();
  }

  private getPeriodDateRange(period: string): { from: string; to: string } {
    const parts = period.split('-').map(Number);
    const year = parts[0] ?? 2026;
    const month = parts[1] ?? 1;
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0);
    const fromStr = from.toISOString().split('T')[0] ?? '2026-01-01';
    const toStr = to.toISOString().split('T')[0] ?? '2026-01-31';
    return { from: fromStr, to: toStr };
  }

  private buildResponseV2(
    answer: string,
    responseType: AssistantToolResponse['responseType'],
    metadata: Record<string, unknown>,
    answerSource: 'snapshot' | 'clarification' = 'snapshot',
  ): AssistantToolResponse {
    return {
      contractVersion: ASSISTANT_RESPONSE_SCHEMA_VERSION_V2,
      answer,
      answerSource,
      responseType,
      dataScope: 'tenant',
      actions: [],
      metadata,
    };
  }

  private getTrendPeriods(months: number): string[] {
    const now = new Date();
    const periods: string[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return periods.reverse();
  }

  private async getUnitDebtTrend(
    tenantId: string,
    _question: string,
    input: Record<string, unknown> | undefined,
    responseContractVersion?: string,
  ): Promise<AssistantToolResponse> {
    const responseVersion = responseContractVersion ?? ASSISTANT_RESPONSE_SCHEMA_VERSION;
    if (responseVersion !== ASSISTANT_RESPONSE_SCHEMA_VERSION_V2) {
      throw new BadRequestException(`Unsupported responseContractVersion: ${responseContractVersion}. Use ${ASSISTANT_RESPONSE_SCHEMA_VERSION_V2} for snapshot tools.`);
    }

    const unitId = this.pickString(input, 'unitId');
    if (!unitId) {
      return this.buildResponse('Se requiere unitId para consultar tendencias.', 'clarification', { missingUnitId: true });
    }

    const buildingId = this.pickString(input, 'buildingId');
    const months = this.pickNumeric(input, 'months', 1, 24);
    const clampedMonths = Math.min(24, Math.max(1, months));
    const metric = this.pickString(input, 'metric') ?? 'outstanding';

    const periods = this.getTrendPeriods(clampedMonths);

    const snapshots = await this.prisma.unitBalanceMonthlySnapshot.findMany({
      where: {
        tenantId,
        unitId,
        ...(buildingId ? { buildingId } : {}),
        period: { in: periods },
      },
      orderBy: { period: 'asc' },
      select: { period: true, chargedMinor: true, collectedMinor: true, outstandingMinor: true, overdueMinor: true, collectionRateBp: true, asOf: true },
    });

    if (snapshots.length === 0) {
      return this.buildResponseV2('No hay datos de tendencias para esa unidad en el período solicitado.', 'no_data', {
        unitId,
        buildingId,
        months: clampedMonths,
        requestedMonths: clampedMonths,
        returnedMonths: 0,
      });
    }

    const series = snapshots.map((s) => {
      const value = metric === 'charged' ? s.chargedMinor
        : metric === 'collected' ? s.collectedMinor
        : metric === 'outstanding' ? s.outstandingMinor
        : metric === 'overdue' ? (s.overdueMinor ?? 0)
        : s.collectionRateBp ?? 0;
      return { period: s.period, value };
    });

    const latestAsOf = snapshots[snapshots.length - 1]?.asOf?.toISOString();
    const trendStr = series.map((s) => `${s.period}: ${metric === 'collection_rate' ? s.value + 'bp' : this.formatMoney(Number(s.value))}`).join(' | ');
    const answer = `Tendencia de ${metric} para unidad (últimos ${snapshots.length} meses): ${trendStr}.`;

    return this.buildResponseV2(answer, 'list', {
      unitId,
      buildingId,
      metric,
      series,
      coverage: { requestedMonths: clampedMonths, returnedMonths: snapshots.length },
      dataFreshnessAsOf: latestAsOf,
      asOf: latestAsOf,
    });
  }

  private async getBuildingDebtTrend(
    tenantId: string,
    input: Record<string, unknown> | undefined,
    responseContractVersion?: string,
  ): Promise<AssistantToolResponse> {
    const responseVersion = responseContractVersion ?? ASSISTANT_RESPONSE_SCHEMA_VERSION;
    if (responseVersion !== ASSISTANT_RESPONSE_SCHEMA_VERSION_V2) {
      throw new BadRequestException(`Unsupported responseContractVersion: ${responseContractVersion}. Use ${ASSISTANT_RESPONSE_SCHEMA_VERSION_V2} for snapshot tools.`);
    }

    const buildingId = this.pickString(input, 'buildingId');
    if (!buildingId) {
      return this.buildResponse('Se requiere buildingId para consultar tendencias por edificio.', 'clarification', { missingBuildingId: true });
    }

    const months = this.pickNumeric(input, 'months', 1, 24);
    const clampedMonths = Math.min(24, Math.max(1, months));
    const metric = this.pickString(input, 'metric') ?? 'outstanding';

    const periods = this.getTrendPeriods(clampedMonths);

    const snapshots = await this.prisma.buildingBalanceMonthlySnapshot.findMany({
      where: { tenantId, buildingId, period: { in: periods } },
      orderBy: { period: 'asc' },
      select: { period: true, chargedMinor: true, collectedMinor: true, outstandingMinor: true, overdueMinor: true, collectionRateBp: true, asOf: true },
    });

    if (snapshots.length === 0) {
      return this.buildResponseV2('No hay datos de tendencias para ese edificio en el período solicitado.', 'no_data', {
        buildingId,
        months: clampedMonths,
        requestedMonths: clampedMonths,
        returnedMonths: 0,
      });
    }

    const series = snapshots.map((s) => {
      const value = metric === 'charged' ? s.chargedMinor
        : metric === 'collected' ? s.collectedMinor
        : metric === 'outstanding' ? s.outstandingMinor
        : metric === 'overdue' ? (s.overdueMinor ?? 0)
        : s.collectionRateBp ?? 0;
      return { period: s.period, value };
    });

    const latestAsOf = snapshots[snapshots.length - 1]?.asOf?.toISOString();
    const trendStr = series.map((s) => `${s.period}: ${metric === 'collection_rate' ? s.value + 'bp' : this.formatMoney(Number(s.value))}`).join(' | ');
    const answer = `Tendencia de ${metric} para edificio (últimos ${snapshots.length} meses): ${trendStr}.`;

    return this.buildResponseV2(answer, 'list', {
      buildingId,
      metric,
      series,
      coverage: { requestedMonths: clampedMonths, returnedMonths: snapshots.length },
      dataFreshnessAsOf: latestAsOf,
      asOf: latestAsOf,
    });
  }

  private async getCollectionsTrend(
    tenantId: string,
    input: Record<string, unknown> | undefined,
    responseContractVersion?: string,
  ): Promise<AssistantToolResponse> {
    const responseVersion = responseContractVersion ?? ASSISTANT_RESPONSE_SCHEMA_VERSION;
    if (responseVersion !== ASSISTANT_RESPONSE_SCHEMA_VERSION_V2) {
      throw new BadRequestException(`Unsupported responseContractVersion: ${responseContractVersion}. Use ${ASSISTANT_RESPONSE_SCHEMA_VERSION_V2} for snapshot tools.`);
    }

    const buildingId = this.pickString(input, 'buildingId');
    const months = this.pickNumeric(input, 'months', 1, 24);
    const clampedMonths = Math.min(24, Math.max(1, months));

    const periods = this.getTrendPeriods(clampedMonths);

    const where: Record<string, unknown> = { tenantId, period: { in: periods } };
    if (buildingId) (where as Record<string, unknown>).buildingId = buildingId;

    const snapshots = await this.prisma.buildingBalanceMonthlySnapshot.findMany({
      where,
      orderBy: { period: 'asc' },
      select: { period: true, chargedMinor: true, collectedMinor: true, collectionRateBp: true, asOf: true },
    });

    if (snapshots.length === 0) {
      return this.buildResponseV2('No hay datos de cobros para el período solicitado.', 'no_data', {
        buildingId,
        months: clampedMonths,
        requestedMonths: clampedMonths,
        returnedMonths: 0,
      });
    }

    const series = snapshots.map((s) => ({
      period: s.period,
      chargedMinor: s.chargedMinor,
      collectedMinor: s.collectedMinor,
      collectionRateBp: s.collectionRateBp ?? 0,
    }));

    const latestAsOf = snapshots[snapshots.length - 1]?.asOf?.toISOString();
    const answer = `Tendencia de cobros (últimos ${snapshots.length} meses): ${series.map((s) => `${s.period}: ${this.formatMoney(s.collectedMinor)}/${this.formatMoney(s.chargedMinor)} (${Math.round(s.collectionRateBp / 100)}%)`).join(' | ')}.`;

    return this.buildResponseV2(answer, 'list', {
      buildingId,
      series,
      coverage: { requestedMonths: clampedMonths, returnedMonths: snapshots.length },
      dataFreshnessAsOf: latestAsOf,
      asOf: latestAsOf,
    });
  }

  private async searchProcesses(
    tenantId: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const filters = this.parseProcessFilters(input);
    const result = await this.processSearch.searchProcesses(tenantId, filters);

    if (result.processes.length === 0) {
      return this.buildResponse('No se encontraron procesos con los filtros aplicados.', 'no_data', {
        filters,
        ...result,
      });
    }

    const summary = result.processes
      .slice(0, 5)
      .map((p) => `${p.title} (${p.status})`)
      .join(' | ');

    return this.buildResponse(
      `Procesos encontrados (${result.pagination.total} total): ${summary}`,
      'list',
      {
        ...result,
        filters,
      },
    );
  }

  private async getProcessSummary(
    tenantId: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const groupBy = this.pickString(input, 'groupBy') as 'processType' | 'status' | 'priority' ?? 'status';
    const processTypes = this.parseProcessTypes(input?.processTypes);
    const overdueSla = this.pickBool(input, 'overdueSla', false);
    const buildingId = this.pickString(input, 'buildingId');

    const result = await this.processSearch.getProcessSummary(tenantId, {
      groupBy,
      processTypes: (processTypes?.length ? processTypes : undefined) as ProcessSummaryInput['processTypes'],
      overdueSla,
      buildingId: buildingId ?? undefined,
    });

    const summary = result.groups
      .map((g) => `${g.key}: ${g.count}`)
      .join(', ');

    return this.buildResponse(
      `Resumen de procesos (agrupado por ${groupBy}): ${summary}`,
      'metric',
      {
        ...result,
        groupBy,
      },
    );
  }

  private async searchClaims(
    tenantId: string,
    input?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const filters = this.parseProcessFilters(input);
    const result = await this.processSearch.searchClaims(tenantId, filters);

    if (result.processes.length === 0) {
      return this.buildResponse('No se encontraron reclamos con los filtros aplicados.', 'no_data', {
        filters,
        ...result,
      });
    }

    const summary = result.processes
      .slice(0, 5)
      .map((p) => `${p.title} (${p.status})`)
      .join(' | ');

    return this.buildResponse(
      `Reclamos encontrados (${result.pagination.total} total): ${summary}`,
      'list',
      {
        ...result,
        filters,
      },
    );
  }

  private parseProcessFilters(input?: Record<string, unknown>): SearchProcessesInput {
    return {
      processTypes: this.parseProcessTypes(input?.processTypes) as SearchProcessesInput['processTypes'],
      statuses: this.parseProcessStatuses(input?.statuses) as SearchProcessesInput['statuses'],
      buildingId: this.pickString(input, 'buildingId') ?? undefined,
      unitId: this.pickString(input, 'unitId') ?? undefined,
      assigned: this.pickBool(input, 'assigned', false),
      assignedToUserId: this.pickString(input, 'assignedToUserId') ?? undefined,
      priority: this.pickNumericValue(input?.priority),
      period: this.pickString(input, 'period') ?? undefined,
      createdAfter: this.pickString(input, 'createdAfter') ?? undefined,
      createdBefore: this.pickString(input, 'createdBefore') ?? undefined,
      overdueSla: this.pickBool(input, 'overdueSla', false),
      limit: this.pickNumericValue(input?.limit) ?? 20,
      cursor: this.pickString(input, 'cursor') ?? undefined,
      sortBy: (this.pickString(input, 'sortBy') ?? 'createdAt') as 'createdAt' | 'dueAt' | 'priority',
      sortDir: (this.pickString(input, 'sortDir') ?? 'desc') as 'asc' | 'desc',
    };
  }

  private parseProcessTypes(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const valid = ['LIQUIDATION', 'EXPENSE_VALIDATION', 'CLAIM'];
    const parsed = value.map((v) => String(v)).filter((v) => valid.includes(v));
    return parsed.length ? parsed : undefined;
  }

  private parseProcessStatuses(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const valid = ['PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'];
    const parsed = value.map((v) => String(v)).filter((v) => valid.includes(v));
    return parsed.length ? parsed : undefined;
  }

  private pickNumericValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private async executeCrossQuery(
    tenantId: string,
    role: string,
    toolInput?: Record<string, unknown>,
  ): Promise<AssistantToolResponse> {
    const templateId = this.pickString(toolInput, 'templateId') as 'TPL-01' | 'TPL-02' | 'TPL-03' | 'TPL-04' | 'TPL-05' | 'TPL-06' | 'TPL-07' | 'TPL-08' | 'TPL-09' | 'TPL-10' | undefined;
    if (!templateId) {
      return this.buildResponse('Template ID requerido', 'no_data', {});
    }

    const params = toolInput?.params as Record<string, unknown> | undefined;
    const result = await this.crossQuery.execute(tenantId, role, { templateId, params: params || {} });

    if (result.responseType === 'error') {
      return this.buildResponse(
        `Error: ${result.errorCode}`,
        'no_data',
        { templateId: result.templateId, errorCode: result.errorCode },
      );
    }

    const normalizedType = (result.responseType === 'timeseries' || result.responseType === 'distribution' || result.responseType === 'dashboard')
      ? 'list' as const
      : result.responseType === 'kpi'
        ? 'metric' as const
        : result.responseType;

    return this.buildResponse(
      `${result.templateName} - ${result.responseType}`,
      normalizedType,
      result as unknown as Record<string, unknown>,
    );
  }
}

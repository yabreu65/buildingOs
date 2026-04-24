import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, PaymentStatus, Prisma, UnitOccupantRole } from '@prisma/client';
import { AiBudgetService } from './budget.service';
import { AiRouterService } from './router.service';
import { AiCacheService } from './cache.service';
import { AiContextSummaryService, ContextSummary } from './context-summary.service';
import { OllamaProvider } from './ollama.provider';
import {
  SuggestedActionType,
  SuggestedAction,
  ChatResponse,
  AiProvider,
  AiProviderContext,
} from './ai.types';

// Re-export types for backward compatibility
export type { SuggestedActionType, SuggestedAction, ChatResponse, AiProvider };

export interface ChatRequest {
  message: string;
  page: string;
  buildingId?: string;
  unitId?: string;
}

interface ContextValidation {
  tenantId: string;
  userId: string;
  membershipId: string;
  buildingId?: string;
  unitId?: string;
  page: string;
  userRoles: string[];
  buildingScope?: string; // For BUILDING-scoped roles
  unitScope?: string; // For UNIT-scoped roles
}

interface YoryiAssistantAction {
  key?: string;
}

interface YoryiAssistantChatResponse {
  answer?: string;
  answerSource?: 'live_data' | 'knowledge' | 'fallback' | string;
  actions?: YoryiAssistantAction[];
}

// MOCK Provider - always works, good for development
@Injectable()
export class MockAiProvider implements AiProvider {
  /**
   * Generate deterministic mock response for development/testing.
   */
  async chat(
    message: string,
    context: AiProviderContext,
    options?: { model?: string; maxTokens?: number }
  ): Promise<ChatResponse> {
    // Simulate thinking (less time for small model)
    const delayMs = options?.model === 'gpt-4.1-nano' ? 50 : 100;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    let answer: string = `I understand you're asking about "${message.substring(0, 50)}...". Let me help you find the right information.`;
    if (message.toLowerCase().includes('ticket'))
      answer = 'You have 3 open tickets. View them to manage maintenance requests.';
    else if (message.toLowerCase().includes('payment'))
      answer =
        'Current balance is $1,250. Outstanding payments are due by end of month.';
    else if (message.toLowerCase().includes('occupant'))
      answer =
        "You have 8 occupants assigned. Recent activity shows good compliance.";

    const suggestedActions: SuggestedAction[] = [
      {
        type: 'VIEW_TICKETS',
        payload: { buildingId: context.buildingId },
      },
    ];

    if (context.page !== 'payments') {
      suggestedActions.push({
        type: 'VIEW_PAYMENTS',
        payload: { buildingId: context.buildingId },
      });
    }

    return { answer, suggestedActions };
  }
}

@Injectable()
export class AssistantService {
  private readonly provider: AiProvider;
  private readonly dailyLimit: number;
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly budget: AiBudgetService,
    private readonly router: AiRouterService,
    private readonly cache: AiCacheService,
    private readonly contextSummary: AiContextSummaryService,
    private readonly ollamaProvider: OllamaProvider,
    private readonly mockAiProvider: MockAiProvider,
  ) {
    this.dailyLimit = parseInt(process.env.AI_DAILY_LIMIT_PER_TENANT || '100', 10);
    // Initialize provider based on env
    const providerName = process.env.AI_PROVIDER || 'MOCK';
    if (providerName === 'OLLAMA') {
      this.provider = this.ollamaProvider;
    } else if (providerName === 'OPENAI') {
      // OPENAI provider will be implemented later
      // For now, fallback to MOCK
      this.provider = this.mockAiProvider;
    } else {
      this.provider = this.mockAiProvider;
    }
  }

  /**
   * Chat endpoint: Process user message with AI assistant
   *
   * @param tenantId - Tenant ID from X-Tenant-Id header
   * @param userId - User ID from JWT
   * @param membershipId - Membership ID from JWT
   * @param request - Chat request with message, page, buildingId, unitId
   * @param userRoles - User roles for this tenant
   * @returns ChatResponse with answer and suggestedActions
   */
  async chat(
    tenantId: string,
    userId: string,
    membershipId: string,
    request: ChatRequest,
    userRoles: string[],
  ): Promise<ChatResponse> {
    // Validate message
    if (!request.message || request.message.trim().length === 0) {
      throw new BadRequestException('Message cannot be empty');
    }

    if (request.message.length > 2000) {
      throw new BadRequestException('Message cannot exceed 2000 characters');
    }

    // Validate context (buildingId, unitId ownership)
    const context = await this.validateContext(
      tenantId,
      userId,
      request.buildingId,
      request.unitId,
      userRoles,
    );

    // Check rate limit
    await this.checkRateLimit(tenantId);

    // Phase 13: Check calls limit (monthly)
    const callsLimitCheck = await this.budget.checkCallsLimit(tenantId);
    if (!callsLimitCheck.allowed) {
      throw new ConflictException(
        `AI calls limit exceeded. Used: ${callsLimitCheck.callsUsed} of ${callsLimitCheck.callsLimit} calls this month`,
      );
    }

    // ROUTER + CACHE OPTIMIZATION
    // Step 1: Check cache first (avoid provider call if hit)
    const cacheKey = this.cache.generateKey(
      tenantId,
      request.message,
      request.page,
      request.buildingId,
      request.unitId,
    );

    const cachedResponse = this.cache.get(cacheKey);
    if (cachedResponse) {
      // Cache hit! Log interaction and return cached response
      const interactionId = await this.logInteraction(tenantId, userId, membershipId, request, cachedResponse, true, 'CACHE');
      void this.audit.createLog({
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: AuditAction.AI_INTERACTION,
        entityType: 'AiInteraction',
        entityId: tenantId,
        metadata: {
          page: request.page,
          buildingId: request.buildingId,
          unitId: request.unitId,
          provider: 'CACHE',
          cacheHit: true,
          actionCount: cachedResponse.suggestedActions.length,
        },
      });

      return {
        ...cachedResponse,
        interactionId: interactionId ?? undefined,
      };
    }

    // Step 2: Classify request to determine model size
    let routerDecision = this.router.classifyRequest({
      message: request.message,
      page: request.page,
      buildingId: request.buildingId,
      unitId: request.unitId,
    });

    // Phase 13: Respect plan's allowBigModel flag
    const limits = await this.budget.getEffectiveLimits(tenantId);
    if (!limits.allowBigModel && routerDecision.model === 'BIG') {
      // Silent override: downgrade BIG to SMALL if plan doesn't allow it
      routerDecision = { ...routerDecision, model: 'SMALL' };
    }

    const modelName = this.router.getModelName(routerDecision.model);
    const maxTokens = this.router.getMaxTokens(routerDecision.model);

    // Step 2.5: Enrich context with real data (minimal snapshot)
    let contextSummary: ContextSummary | null = null;
    try {
      const summaryResult = await this.contextSummary.getSummary({
        tenantId,
        membershipId,
        buildingId: request.buildingId,
        unitId: request.unitId,
        page: request.page,
        userRoles,
      });
      contextSummary = summaryResult;
    } catch (error) {
      // Context enrichment never blocks main request
      this.logger.error('Failed to enrich context', error);
    }

    let response: ChatResponse;
    let resolvedModelForLog = modelName;

    const strictOperationalResponse = await this.tryResolveStrictOperationalQuestion(
      tenantId,
      request.message,
      userRoles,
    );

    if (strictOperationalResponse) {
      response = strictOperationalResponse;
      resolvedModelForLog = 'LIVE_DATA_STRICT';
    } else {
      const yoryiResponse = await this.tryYoryiReadOnlyResponse({
        tenantId,
        userId,
        membershipId,
        userRoles,
        request,
      });

      if (yoryiResponse) {
        response = yoryiResponse;
        resolvedModelForLog = 'YORYI_CORE';
      } else {
        // Step 3: Check budget (and enforce hard stop or soft degrade)
        const budgetCheck = await this.budget.checkBudget(tenantId);

        if (!budgetCheck.allowed) {
          // Budget exceeded and soft degrade disabled
          throw new ConflictException(
            `AI budget exceeded. Used: $${(budgetCheck.usedCents / 100).toFixed(2)} of $${(budgetCheck.budgetCents / 100).toFixed(2)} monthly budget`,
          );
        }

        if (budgetCheck.blockedAt || (budgetCheck.percentUsed >= 100)) {
          // Budget exceeded but soft degrade enabled - use mock response
          response = await this.provider.chat(
            request.message,
            {
              buildingId: request.buildingId,
              unitId: request.unitId,
              page: request.page,
              tenantId,
              contextSnapshot: contextSummary?.snapshot as unknown as Record<string, unknown> | undefined,
            },
            { model: 'gpt-4.1-nano', maxTokens: 150 }
          );

          void this.budget.logDegradedResponse(tenantId, 'Monthly budget exceeded');
          resolvedModelForLog = 'DEGRADED_MOCK';
        } else {
          // Local fallback only when yoryi is disabled/unavailable.
          response = await this.provider.chat(
            request.message,
            {
              buildingId: request.buildingId,
              unitId: request.unitId,
              page: request.page,
              tenantId,
              contextSnapshot: contextSummary?.snapshot as unknown as Record<string, unknown> | undefined,
            },
            { model: modelName, maxTokens }
          );

          void this.budget.trackUsage(tenantId, {
            model: modelName,
            inputTokens: 0,
            outputTokens: 0,
          });
        }
      }
    }

    // Step 4: Cache the response for future similar requests
    this.cache.set(cacheKey, response, resolvedModelForLog);

    // Filter suggested actions based on RBAC
    response.suggestedActions = this.filterSuggestedActions(
      response.suggestedActions,
      userRoles,
      context,
    );

    // Store interaction log (fire-and-forget)
    // Determine modelSize from router decision
    const modelSizeStr = resolvedModelForLog === 'YORYI_CORE'
      ? 'YORYI_CORE'
      : resolvedModelForLog === 'LIVE_DATA_STRICT'
        ? 'LIVE_DATA_STRICT'
        : (routerDecision?.model === 'BIG' ? 'BIG' : (routerDecision?.model === 'SMALL' ? 'SMALL' : 'MOCK'));
    const interactionId = await this.logInteraction(tenantId, userId, membershipId, request, response, false, modelSizeStr);

    // Audit the interaction (fire-and-forget)
    void this.audit.createLog({
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: AuditAction.AI_INTERACTION,
      entityType: 'AiInteraction',
      entityId: tenantId,
      metadata: {
        page: request.page,
        buildingId: request.buildingId,
        unitId: request.unitId,
        provider: process.env.AI_PROVIDER || 'MOCK',
        actionCount: response.suggestedActions.length,
        limited: false,
        summaryVersion: contextSummary?.summaryVersion || null,
        contextScoped: contextSummary ? 'yes' : 'no',
      },
    });

    return {
      ...response,
      interactionId: interactionId ?? undefined,
    };
  }

  private async tryYoryiReadOnlyResponse(params: {
    tenantId: string;
    userId: string;
    membershipId: string;
    userRoles: string[];
    request: ChatRequest;
  }): Promise<ChatResponse | null> {
    if (!this.shouldUseYoryiEngine(params.tenantId, params.userRoles)) {
      return null;
    }

    const baseUrl = process.env.YORYI_ASSISTANT_API_BASE_URL;
    if (!baseUrl) {
      return null;
    }

    const role = this.resolvePrimaryAdminRole(params.userRoles);
    if (!role) {
      return null;
    }

    try {
      const response = await fetch(new URL('/assistant/chat', baseUrl).toString(), {
        method: 'POST',
        headers: this.buildYoryiHeaders({
          tenantId: params.tenantId,
          userId: params.userId,
          role,
        }),
        body: JSON.stringify({
          message: params.request.message,
          sessionId: `buildingos:${params.tenantId}:${params.membershipId}`,
          context: {
            appId: 'buildingos',
            tenantId: params.tenantId,
            userId: params.userId,
            role,
            route: this.resolveRouteFromPage(params.request.page),
            currentModule: this.resolveModuleFromPage(
              params.request.page,
              params.request.message,
            ),
          },
        }),
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as YoryiAssistantChatResponse;
      if (!payload || !this.isAllowedYoryiAnswerSource(payload.answerSource) || !payload.answer) {
        return null;
      }

      const suggestedActions = this.mapYoryiActionsToBuildingOsActions(
        payload.actions,
        params.request,
      );

      return {
        answer: payload.answer,
        suggestedActions,
      };
    } catch (error) {
      this.logger.warn(`Yoryi read-only fallback to local provider: ${String(error)}`);
      return null;
    }
  }

  private shouldUseYoryiEngine(tenantId: string, userRoles: string[]): boolean {
    const enabled = process.env.ASSISTANT_YORYI_ENGINE_ENABLED === 'true';
    if (!enabled) {
      return false;
    }

    const role = this.resolvePrimaryAdminRole(userRoles);
    if (!role) {
      return false;
    }

    const canaryTenants = this.parseCsvEnv(process.env.ASSISTANT_YORYI_CANARY_TENANTS);
    if (canaryTenants.length === 0) {
      return true;
    }

    return canaryTenants.includes(tenantId);
  }

  private resolvePrimaryAdminRole(userRoles: string[]): string | null {
    if (userRoles.includes('SUPER_ADMIN')) {
      return 'SUPER_ADMIN';
    }
    if (userRoles.includes('TENANT_OWNER')) {
      return 'TENANT_OWNER';
    }
    if (userRoles.includes('TENANT_ADMIN')) {
      return 'TENANT_ADMIN';
    }
    return null;
  }

  private isAllowedYoryiAnswerSource(answerSource?: string): boolean {
    const p0Enforced = process.env.ASSISTANT_P0_ENFORCEMENT_ENABLED !== 'false';
    if (p0Enforced) {
      return answerSource === 'live_data';
    }

    return answerSource === 'live_data' || answerSource === 'knowledge';
  }

  private buildYoryiHeaders(context: {
    tenantId: string;
    userId: string;
    role: string;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-app-id': 'buildingos',
      'x-tenant-id': context.tenantId,
      'x-user-id': context.userId,
      'x-user-role': context.role,
    };

    const apiKey = process.env.YORYI_ASSISTANT_API_KEY;
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    return headers;
  }

  private mapYoryiActionsToBuildingOsActions(
    actions: YoryiAssistantAction[] | undefined,
    request: ChatRequest,
  ): SuggestedAction[] {
    if (!Array.isArray(actions) || actions.length === 0) {
      return [];
    }

    const mapped: SuggestedAction[] = [];
    const seen = new Set<SuggestedActionType>();

    for (const action of actions) {
      const key = (action.key ?? '').trim().toLowerCase();
      const type = this.mapActionKeyToSuggestedActionType(key);
      if (!type || seen.has(type)) {
        continue;
      }

      seen.add(type);
      mapped.push({
        type,
        payload: {
          buildingId: request.buildingId,
          unitId: request.unitId,
        },
      });
    }

    return mapped;
  }

  private mapActionKeyToSuggestedActionType(actionKey: string): SuggestedActionType | null {
    if (!actionKey) {
      return null;
    }

    if (['open-tickets', 'review-open-tickets', 'view-my-tickets'].includes(actionKey)) {
      return 'VIEW_TICKETS';
    }
    if (['open-payments', 'review-pending-payments', 'view-all-payments'].includes(actionKey)) {
      return 'VIEW_PAYMENTS';
    }
    if (['open-charges', 'open-units', 'open-buildings'].includes(actionKey)) {
      return 'VIEW_REPORTS';
    }
    if (['open-documents', 'open-communications', 'view-notices', 'view-my-inbox'].includes(actionKey)) {
      return 'SEARCH_DOCS';
    }
    if (actionKey === 'create-communication') {
      return 'DRAFT_COMMUNICATION';
    }
    if (actionKey === 'create-ticket') {
      return 'CREATE_TICKET';
    }

    return null;
  }

  private resolveRouteFromPage(page: string): string {
    const normalized = (page ?? '').trim().toLowerCase();
    if (!normalized) {
      return '/tenant/dashboard';
    }
    if (normalized.startsWith('/')) {
      return normalized;
    }
    return `/tenant/${normalized}`;
  }

  private resolveModuleFromPage(page: string, message: string = ''): string {
    const normalizedPage = this.normalizeText(page);
    const normalizedMessage = this.normalizeText(message);

    if (
      normalizedPage.includes('payment') ||
      normalizedMessage.includes('pago') ||
      normalizedMessage.includes('pagos') ||
      normalizedMessage.includes('deuda') ||
      normalizedMessage.includes('saldo') ||
      normalizedMessage.includes('moros')
    ) {
      return 'payments';
    }

    if (normalizedPage.includes('charge') || normalizedPage.includes('finanza')) return 'charges';
    if (normalizedPage.includes('ticket') || normalizedPage.includes('support')) return 'tickets';
    if (normalizedPage.includes('unit')) return 'units';
    if (normalizedPage.includes('building')) return 'buildings';
    return 'general';
  }

  private async tryResolveStrictOperationalQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
  ): Promise<ChatResponse | null> {
    const residentResponse = await this.tryResolveStrictResidentNameQuestion(
      tenantId,
      message,
      userRoles,
    );
    if (residentResponse) {
      return residentResponse;
    }

    return this.tryResolveStrictUnitDebtQuestion(tenantId, message, userRoles);
  }

  private async tryResolveStrictResidentNameQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isResidentQuery =
      normalizedMessage.includes('residente') &&
      (normalizedMessage.includes('como se llama') ||
        normalizedMessage.includes('quien vive') ||
        normalizedMessage.includes('quien es') ||
        normalizedMessage.includes('nombre'));

    if (!isResidentQuery) {
      return null;
    }

    const unitToken = this.extractUnitToken(normalizedMessage);
    const towerToken = this.extractTowerToken(normalizedMessage);

    if (!unitToken || !towerToken) {
      return {
        answer:
          'Para responder con precision necesito unidad y torre exactas. Ejemplo: "Como se llama el residente del apartamento 12-8 Torre A".',
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    const strictMatch = await this.resolveStrictUnitMatch(tenantId, unitToken, towerToken);
    if (strictMatch.errorResponse) {
      return strictMatch.errorResponse;
    }

    const { building, unit } = strictMatch;
    if (!building || !unit) {
      return null;
    }

    const occupants = await this.prisma.unitOccupant.findMany({
      where: {
        unitId: unit.id,
        endDate: null,
      },
      include: {
        member: {
          select: { id: true, name: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (occupants.length === 0) {
      return {
        answer: `La ${building.name} unidad ${unit.label || unit.code} no tiene ocupantes activos asignados.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const primaryOccupants = occupants.filter((o) => o.isPrimary);
    if (primaryOccupants.length > 1) {
      return {
        answer: `Hay mas de un ocupante primario en ${building.name} unidad ${unit.label || unit.code}. Necesito que revises la asignacion antes de confirmar un nombre.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const selected =
      primaryOccupants[0] ||
      occupants.find((o) => o.role === UnitOccupantRole.OWNER) ||
      occupants[0];

    if (!selected?.member?.name) {
      return {
        answer: `La ${building.name} unidad ${unit.label || unit.code} tiene ocupante activo, pero sin nombre cargado en TenantMember.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const roleLabel =
      selected.role === UnitOccupantRole.OWNER ? 'propietario/a' : 'residente';

    return {
      answer: `En ${building.name}, la unidad ${unit.label || unit.code} tiene como ${roleLabel} principal a ${selected.member.name}.`,
      suggestedActions: [
        {
          type: 'VIEW_REPORTS',
          payload: {
            buildingId: building.id,
            unitId: unit.id,
          },
        },
      ],
    };
  }

  private async tryResolveStrictUnitDebtQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isDebtQuery =
      normalizedMessage.includes('debe') ||
      normalizedMessage.includes('cuanto debe') ||
      normalizedMessage.includes('deuda') ||
      normalizedMessage.includes('saldo pendiente') ||
      normalizedMessage.includes('adeuda');

    if (!isDebtQuery) {
      return null;
    }

    const unitToken = this.extractUnitToken(normalizedMessage);
    const towerToken = this.extractTowerToken(normalizedMessage);

    if (!unitToken || !towerToken) {
      return {
        answer:
          'Para responder con precision necesito ambos datos exactos: unidad y torre. Ejemplo: "Cuanto debe la unidad 123 de Torre A".',
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: {} }],
      };
    }

    const strictMatch = await this.resolveStrictUnitMatch(tenantId, unitToken, towerToken);
    if (strictMatch.errorResponse) {
      return strictMatch.errorResponse;
    }

    const { building, unit } = strictMatch;
    if (!building || !unit) {
      return null;
    }

    const [tenant, charges] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      }),
      this.prisma.charge.findMany({
        where: {
          tenantId,
          unitId: unit.id,
          canceledAt: null,
        },
        include: {
          paymentAllocations: {
            include: {
              payment: {
                select: { status: true },
              },
            },
          },
        },
      }),
    ]);

    const outstanding = charges.reduce((sum, charge) => {
      const approvedAllocated = charge.paymentAllocations.reduce((allocSum, allocation) => {
        const status = allocation.payment?.status;
        if (status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) {
          return allocSum + allocation.amount;
        }
        return allocSum;
      }, 0);

      return sum + Math.max(0, charge.amount - approvedAllocated);
    }, 0);

    const unitLabel = unit.label || unit.code;
    const amountText = this.formatMoney(outstanding, tenant.currency);
    const answer = outstanding > 0
      ? `La ${building.name} unidad ${unitLabel} tiene una deuda pendiente de ${amountText}.`
      : `La ${building.name} unidad ${unitLabel} no tiene deuda pendiente. Saldo actual: ${amountText}.`;

    return {
      answer,
      suggestedActions: [
        {
          type: 'VIEW_PAYMENTS',
          payload: {
            buildingId: building.id,
            unitId: unit.id,
          },
        },
      ],
    };
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

  private canAccessOperationalData(userRoles: string[]): boolean {
    return (
      userRoles.includes('SUPER_ADMIN') ||
      userRoles.includes('TENANT_OWNER') ||
      userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('OPERATOR')
    );
  }

  private async resolveStrictUnitMatch(
    tenantId: string,
    unitToken: string,
    towerToken: string,
  ): Promise<{
    building: { id: string; name: string } | null;
    unit: { id: string; code: string; label: string | null } | null;
    errorResponse: ChatResponse | null;
  }> {
    const buildings = await this.prisma.building.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    });

    const matchedBuildings = buildings.filter((building) =>
      this.matchesTowerToken(building.name, towerToken),
    );

    if (matchedBuildings.length === 0) {
      return {
        building: null,
        unit: null,
        errorResponse: {
          answer: `No encontre la torre "${towerToken.toUpperCase()}" en este tenant. Verifica el nombre exacto y volve a intentar.`,
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
        },
      };
    }

    if (matchedBuildings.length > 1) {
      return {
        building: null,
        unit: null,
        errorResponse: {
          answer: `Hay mas de una torre coincidente (${matchedBuildings.map((b) => b.name).join(', ')}). Necesito el nombre exacto para responder de forma estricta.`,
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
        },
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
        building,
        unit: null,
        errorResponse: {
          answer: `No encontre la unidad "${unitToken}" en ${building.name}. Verifica el codigo/label exacto y volve a intentar.`,
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id } }],
        },
      };
    }

    if (matchedUnits.length > 1) {
      return {
        building,
        unit: null,
        errorResponse: {
          answer: `La unidad es ambigua. Coincide con: ${matchedUnits.map((u) => u.label || u.code).join(', ')}. Indica el identificador exacto para responder con precision.`,
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id } }],
        },
      };
    }

    return {
      building,
      unit: matchedUnits[0]!,
      errorResponse: null,
    };
  }

  private normalizeText(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private formatMoney(amountCents: number, currency: string): string {
    const amount = amountCents / 100;
    try {
      return new Intl.NumberFormat('es-VE', {
        style: 'currency',
        currency,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
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

  /**
   * Validate context: Check buildingId/unitId ownership
   * Returns context with additional info like buildingScope/unitScope
   */
  private async validateContext(
    tenantId: string,
    userId: string,
    buildingId?: string,
    unitId?: string,
    userRoles?: string[],
  ): Promise<ContextValidation> {
    const context: ContextValidation = {
      tenantId,
      userId,
      membershipId: '', // Placeholder
      page: '', // Will be set by caller
      userRoles: userRoles || [],
    };

    // Validate buildingId if provided
    if (buildingId) {
      const building = await this.prisma.building.findUnique({
        where: { id: buildingId },
      });

      if (!building || building.tenantId !== tenantId) {
        throw new BadRequestException('Invalid building');
      }
      context.buildingId = buildingId;
    }

    // Validate unitId if provided
    if (unitId) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: unitId },
        include: { building: true },
      });

      if (!unit || unit.building.tenantId !== tenantId) {
        throw new BadRequestException('Invalid unit');
      }
      context.unitId = unitId;

      // If unitId provided, buildingId should match
      if (buildingId && unit.buildingId !== buildingId) {
        throw new BadRequestException('Unit does not belong to building');
      }
    }

    return context;
  }

  /**
   * Check rate limit: 100 calls per tenant per day
   * Uses TenantDailyAiUsage table with UNIQUE constraint
   */
  private async checkRateLimit(tenantId: string): Promise<void> {
    const today: string = new Date().toISOString().split('T')[0]!; // YYYY-MM-DD

    const usage = await this.prisma.tenantDailyAiUsage.findUnique({
      where: {
        tenantId_day: {
          tenantId,
          day: today,
        },
      },
    });

    const currentCount = usage?.count || 0;

    if (currentCount >= this.dailyLimit) {
      throw new ConflictException(
        `Daily AI limit (${this.dailyLimit} calls) exceeded. Resets at midnight UTC.`,
      );
    }

    // Increment usage (upsert pattern for thread safety)
    await this.prisma.tenantDailyAiUsage.upsert({
      where: {
        tenantId_day: {
          tenantId,
          day: today,
        },
      },
      update: {
        count: {
          increment: 1,
        },
      },
      create: {
        tenantId,
        day: today,
        count: 1,
      },
    });
  }

  /**
   * Filter suggested actions based on user permissions
   * Only include actions the user can execute
   */
  private filterSuggestedActions(
    actions: SuggestedAction[],
    userRoles: string[],
    _context: ContextValidation,
  ): SuggestedAction[] {
    const canViewBuilding = userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('TENANT_OWNER') ||
      userRoles.includes('OPERATOR');
    const canViewPayments = userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('TENANT_OWNER') ||
      userRoles.includes('OPERATOR');
    const canPublishComm = userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('TENANT_OWNER');
    const canCreateTicket = userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('TENANT_OWNER') ||
      userRoles.includes('OPERATOR') ||
      userRoles.includes('RESIDENT');

    return actions.filter((action) => {
      switch (action.type) {
        case 'VIEW_TICKETS':
        case 'SEARCH_DOCS':
        case 'VIEW_REPORTS':
          return canViewBuilding;
        case 'VIEW_PAYMENTS':
          return canViewPayments;
        case 'DRAFT_COMMUNICATION':
          return canPublishComm;
        case 'CREATE_TICKET':
          return canCreateTicket;
        default:
          return false;
      }
    });
  }

  /**
   * Log interaction to AiInteractionLog (fire-and-forget)
   * Never fails the main operation
   * PHASE 12: Now captures cacheHit, modelSize, and page for analytics
   * Returns the created interaction ID for frontend tracking
   */
  private async logInteraction(
    tenantId: string,
    userId: string,
    membershipId: string,
    request: ChatRequest,
    response: ChatResponse,
    cacheHit: boolean = false,
    modelSize: string = 'MOCK',
  ): Promise<string | null> {
    try {
      const log = await this.prisma.aiInteractionLog.create({
        
        data: {
          tenantId,
          userId,
          membershipId,
          context: {
            buildingId: request.buildingId,
            unitId: request.unitId,
            page: request.page,
          } as Prisma.InputJsonValue,
          prompt: request.message,
          response: {
            answer: response.answer,
            suggestedActions: response.suggestedActions,
          } as unknown as Prisma.InputJsonValue,
          provider: process.env.AI_PROVIDER || 'MOCK',
          tokensIn: null,
          tokensOut: null,
          // PHASE 12: Analytics
          cacheHit,
          modelSize,
          page: request.page,
        },
      });
      return log.id;
    } catch (error) {
      // Fire-and-forget: log but don't fail
      this.logger.error('Failed to log AI interaction', error);
      return null;
    }
  }

  /**
   * FASE 3: Get AI-suggested replies for a ticket
   *
   * Returns 3 professional suggested replies based on ticket title and description
   * These are used to help admins compose faster responses to resident tickets
   *
   * @param tenantId - Tenant ID
   * @param ticketId - Ticket ID (for reference)
   * @param title - Ticket title
   * @param description - Ticket description
   * @returns Array of 3 suggested replies
   */
  async getTicketReplySuggestions(
    tenantId: string,
    ticketId: string,
    title: string,
    description: string,
  ): Promise<string[]> {
    // Build prompt for the AI provider
    const prompt = `You are a professional property management assistant.
Based on this resident ticket, suggest 3 professional and helpful response templates.

Ticket Title: ${title}
Ticket Description: ${description}

Please provide 3 concise, professional replies that:
1. Acknowledge the issue
2. Are friendly and professional
3. Are appropriate for a property manager to send

Format each suggestion on a new line starting with 1., 2., 3.`;

    try {
      // Get response from provider
      const response = await this.provider.chat(
        prompt,
        {
          tenantId,
          ticketId,
          page: 'ticket-detail',
        },
        { model: 'gpt-4.1-nano', maxTokens: 500 }, // Use small model for quick replies
      );

      // Parse the response to extract 3 suggestions
      // Expected format: "1. Reply 1\n2. Reply 2\n3. Reply 3"
      const suggestions = this.parseReplySuggestions(response.answer);

      return suggestions;
    } catch (error) {
      this.logger.error('Failed to generate reply suggestions', error);
      // Return fallback replies if provider fails
      return this.getFallbackReplies();
    }
  }

  /**
   * Parse AI response to extract 3 reply suggestions
   */
  private parseReplySuggestions(responseText: string): string[] {
    const lines = responseText.split('\n').filter((line) => line.trim());
    const suggestions: string[] = [];

    for (const line of lines) {
      // Match lines starting with "1. ", "2. ", "3. " or similar patterns
      const match = line.match(/^\d+\.\s+(.+)$/);
      if (match && match[1]) {
        suggestions.push(match[1].trim());
        if (suggestions.length === 3) break;
      }
    }

    // If we couldn't parse 3 suggestions, return fallbacks
    if (suggestions.length < 3) {
      return this.getFallbackReplies();
    }

    return suggestions;
  }

  /**
   * Fallback replies when AI provider fails or returns unexpected format
   */
  private getFallbackReplies(): string[] {
    return [
      'Thank you for reporting this issue. We will investigate and get back to you within 24 hours.',
      'We appreciate your patience. Our maintenance team has been notified and will address this shortly.',
      'Thank you for bringing this to our attention. A manager will review your request and follow up with you soon.',
    ];
  }
}

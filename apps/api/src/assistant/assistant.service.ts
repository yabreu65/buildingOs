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
import {
  mapYoryiToCanonical,
  type GatewayOutcome,
} from './yoryi-bridge.mapper';

// Re-export types for backward compatibility
export type { SuggestedActionType, SuggestedAction, ChatResponse, AiProvider };

export interface ChatRequest {
  message: string;
  page: string;
  buildingId?: string;
  unitId?: string;
  context?: {
    extra?: {
      sessionId?: string;
      choiceId?: string;
      [key: string]: unknown;
    };
  };
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
  responseType?: 'answer' | 'clarification' | 'error' | 'no_data';
  options?: Array<{ id: string; label: string; index: number }>;
}

type YoryiReadOnlyResolution =
  | { kind: 'response'; response: ChatResponse }
  | { kind: 'fallback_allowed' }
  | { kind: 'blocked'; response: ChatResponse; family?: 'P0' | 'P2' | 'P3' };

type RouteFamily = 'P0' | 'P2' | 'P3';

interface YoryiAssistantChatResponse {
  answer?: string;
  answerSource?: 'live_data' | 'knowledge' | 'fallback' | string;
  actions?: YoryiAssistantAction[];
  responseType?: 'answer' | 'clarification' | 'error' | 'no_data';
  options?: Array<{ id: string; label: string; index: number }>;
  toolName?: string;
  routeFamily?: RouteFamily;
  auditId?: string;
  provenance?: {
    sources?: Array<{
      metadata?: Record<string, unknown>;
    }>;
  };
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

    let answer: string = `Entiendo que me preguntás sobre "${message.substring(0, 50)}...". Para obtener información precisa sobre cobranzas, necesitas acceso al sistema de facturación. ¿Querés que te muestre las opciones disponibles?`;
    if (message.toLowerCase().includes('cobranza') || message.toLowerCase().includes('deuda')) {
      answer = 'Para consultar cobranzas y deuda, necesito acceso al sistema deBilling. ¿Tenés acceso habilitado?';
    } else if (message.toLowerCase().includes('ticket')) {
      answer = 'Tenés 3 tickets abiertos. ¿Querés que los liste para gestionar las solicitudes de mantenimiento?';
    } else if (message.toLowerCase().includes('payment') || message.toLowerCase().includes('pago')) {
      answer = 'El saldo actual es $1,250. Los pagos pendientes vencen a fin de mes.';
    } else if (message.toLowerCase().includes('occupant') || message.toLowerCase().includes('residente')) {
      answer = 'Tenés 8 ocupantes asignados. ¿Querés ver el listado completo?';
    }

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

    const nodeEnv = process.env.NODE_ENV || 'development';
    const envEnabled = process.env.ASSISTANT_YORYI_ENGINE_ENABLED;
    const effectiveEnabled = envEnabled !== undefined
      ? envEnabled === 'true'
      : nodeEnv !== 'production';

    const canaryTenants = this.parseCsvEnv(process.env.ASSISTANT_YORYI_CANARY_TENANTS);
    const baseUrl = process.env.YORYI_ASSISTANT_API_BASE_URL || '';

    this.logger.log({
      msg: '[ASSISTANT] Startup config',
      NODE_ENV: nodeEnv,
      ASSISTANT_YORYI_ENGINE_ENABLED_SET: envEnabled ?? '(not set)',
      ASSISTANT_YORYI_ENGINE_ENABLED_EFFECTIVE: effectiveEnabled,
      ASSISTANT_YORYI_CANARY_TENANTS: canaryTenants,
      YORYI_ASSISTANT_API_BASE_URL: baseUrl ? baseUrl.replace(/\/\/.+@/, '//***@') : '(not set)',
      ASSISTANT_YORYI_TIMEOUT_MS: process.env.ASSISTANT_YORYI_TIMEOUT_MS ?? '(default 1800)',
      ASSISTANT_P0_ENFORCEMENT_ENABLED: process.env.ASSISTANT_P0_ENFORCEMENT_ENABLED ?? '(not set)',
      ASSISTANT_P3_ENABLED: process.env.ASSISTANT_P3_ENABLED ?? '(default false)',
    });
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

    console.log('[DEBUG] about to validate context');
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
      const normalizedCachedResponse = this.normalizeResponseContract(cachedResponse);
      // Cache hit! Log interaction and return cached response
      const interactionId = await this.logInteraction(
        tenantId,
        userId,
        membershipId,
        request,
        normalizedCachedResponse,
        true,
        'CACHE',
      );
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
            actionCount: normalizedCachedResponse.suggestedActions.length,
          },
        });

      return {
        ...normalizedCachedResponse,
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
      const yoryiResolution = await this.tryYoryiReadOnlyResponse({
        tenantId,
        userId,
        membershipId,
        userRoles,
        request,
      });

      if (yoryiResolution.kind === 'response') {
        response = yoryiResolution.response;
        resolvedModelForLog = 'YORYI_CORE';
      } else if (yoryiResolution.kind === 'blocked') {
        response = yoryiResolution.response;
        resolvedModelForLog = 'YORYI_CORE_BLOCKED';
      } else {
        // Local fallback only when yoryi is disabled/unavailable/timeout.
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

    response = this.normalizeResponseContract(response);

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
  }): Promise<YoryiReadOnlyResolution> {
    if (!this.shouldUseYoryiEngine(params.tenantId, params.userRoles)) {
      this.logger.log({ msg: '[FLOW] operational-first: FALLBACK (yoryi disabled or not allowed)', tenantId: params.tenantId });
      return { kind: 'fallback_allowed' };
    }

    const baseUrl = process.env.YORYI_ASSISTANT_API_BASE_URL;
    if (!baseUrl) {
      this.logger.log({ msg: '[FLOW] operational-first: FALLBACK (no baseUrl)', tenantId: params.tenantId });
      return { kind: 'fallback_allowed' };
    }

    const role = this.resolvePrimaryAdminRole(params.userRoles);
    if (!role) {
      this.logger.log({ msg: '[FLOW] operational-first: FALLBACK (no admin role)', tenantId: params.tenantId, userRoles: params.userRoles });
      return { kind: 'fallback_allowed' };
    }

    const configuredTimeout = Number(process.env.ASSISTANT_YORYI_TIMEOUT_MS ?? '1800');
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 1800;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const currentModule = this.resolveModuleFromPage(params.request.page, params.request.message);
      // this.logger.log({
      //   msg: '[FLOW] operational-first: sending to yoryi',
      //   tenantId: params.tenantId,
      //   page: params.request.page,
      //   currentModule,
      //   uiPage: params.request.context?.extra?.uiPage,
      // });

      const response = await fetch(new URL('/assistant/chat', baseUrl).toString(), {
        method: 'POST',
        signal: controller.signal,
        headers: this.buildYoryiHeaders({
          tenantId: params.tenantId,
          userId: params.userId,
          role,
          p3Enabled: this.isP3EnabledForTenant(params.tenantId),
        }),
        body: JSON.stringify({
          message: params.request.message,
          sessionId: params.request.context?.extra?.sessionId 
            ?? `buildingos:${params.tenantId}:${params.membershipId}`,
          choiceId: params.request.context?.extra?.choiceId,
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
            extra: params.request.context?.extra,
          },
        }),
      });

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        const requestId = `${params.tenantId}-${params.membershipId}-${Date.now()}`;
        this.logger.warn({
          msg: '[BRIDGE] YORYI response not OK',
          tenantId: params.tenantId,
          status: response.status,
          statusText: response.statusText,
        });
        return {
          kind: 'blocked',
          response: this.buildYoryiControlledResponse('unavailable', 'P0', requestId),
          family: 'P0',
        };
      }

      const payload = (await response.json()) as YoryiAssistantChatResponse;
      const canonical = mapYoryiToCanonical(payload);
      const routeFamily = this.detectRouteFamily(payload.toolName);
      const p3EnabledForTenant = this.isP3EnabledForTenant(params.tenantId);
      const uiPage = params.request.context?.extra?.uiPage;
      this.logger.debug({
        msg: '[BRIDGE] routing response diagnostics',
        tenantId: params.tenantId,
        answerSource: payload.answerSource,
        responseType: payload.responseType,
        toolName: payload.toolName,
        routeFamily,
        p3EnabledForTenant,
        uiPage,
      });

      if (routeFamily === 'P3' && !p3EnabledForTenant) {
        const requestId = `${params.tenantId}-${params.membershipId}-${Date.now()}`;
        this.logger.warn({
          msg: '[BRIDGE] P3 blocked by feature flag/canary policy',
          tenantId: params.tenantId,
          routeFamily,
          ASSISTANT_P3_ENABLED: process.env.ASSISTANT_P3_ENABLED ?? '(not set)',
          canaryTenants: this.parseCsvEnv(process.env.ASSISTANT_YORYI_CANARY_TENANTS),
        });
        return {
          kind: 'blocked',
          response: this.buildYoryiControlledResponse('unavailable', 'P3', requestId),
          family: 'P3',
        };
      }

      if (!canonical) {
        this.logger.warn({
          msg: '[BRIDGE] routing response INVALID',
          tenantId: params.tenantId,
          answerSource: payload?.answerSource,
          responseType: payload?.responseType,
          routeFamily,
          hasAnswer: !!payload?.answer,
        });
        const requestId = `${params.tenantId}-${params.membershipId}-${Date.now()}`;
        this.logger.warn({
          msg: `[BRIDGE] routeMatched family=${routeFamily}, blocking fallback to knowledge`,
          tenantId: params.tenantId,
          answerSource: payload?.answerSource,
          reason: 'invalid_payload',
        });
        return {
          kind: 'blocked',
          response: this.buildYoryiControlledResponse('invalid_payload', routeFamily, requestId),
          family: routeFamily,
        };
      }

      const operational = this.isOperationalQuery(params.request.page, params.request.message);
      if ((operational && canonical.answerSource !== 'live_data') || !this.isAllowedYoryiAnswerSource(canonical.answerSource, routeFamily)) {
        const requestId = `${params.tenantId}-${params.membershipId}-${Date.now()}`;
        const reason = operational && canonical.answerSource !== 'live_data'
          ? 'denied'
          : 'contract_mismatch';
        return {
          kind: 'blocked',
          response: this.buildYoryiControlledResponse(reason, routeFamily, requestId),
          family: routeFamily,
        };
      }

      this.logger.debug({
        msg: '[BRIDGE] routing response OK',
        tenantId: params.tenantId,
        answerSource: payload.answerSource,
        responseType: payload.responseType,
        routeFamily,
      });

      //       this.logger.log({
      //   msg: '[FLOW] operational-first: yoryi result',
      //   tenantId: params.tenantId,
      //   routeFamily,
      //   answerSource: payload.answerSource,
      //   responseType: payload.responseType,
      //   toolName: payload.toolName,
      // });

      const finalAnswer = this.shouldOverrideGenericUnitLookupMenu(
        params.request.message,
        canonical.answer,
      )
        ? 'No encontré una coincidencia única para la unidad indicada. Verificá unidad y torre exactas.'
        : canonical.answer;

      const suggestedActions = canonical.suggestedActions.length > 0
        ? canonical.suggestedActions.map((action) => ({
            ...action,
            payload: {
              ...(action.payload ?? {}),
              buildingId: params.request.buildingId,
              unitId: params.request.unitId,
            },
          }))
        : this.mapYoryiActionsToBuildingOsActions(payload.actions, params.request);

      return {
        kind: 'response',
        response: {
          answer: finalAnswer,
          answerSource: canonical.answerSource,
          suggestedActions,
          responseType: canonical.responseType,
          options: payload.options,
          metadata: {
            gatewayOutcome: 'success',
            rawAnswerSource: canonical.metadata.rawAnswerSource,
            auditId: canonical.metadata.auditId,
            intentCode: canonical.metadata.intentCode,
            traceId: canonical.metadata.traceId,
          },
        },
      };
    } catch (error) {
      clearTimeout(timeoutHandle);
      const requestId = `${params.tenantId}-${params.membershipId}-${Date.now()}`;
      const outcome: GatewayOutcome =
        error instanceof Error && error.name === 'AbortError'
          ? 'timeout'
          : 'unavailable';
      this.logger.warn({
        msg: `[BRIDGE] Yoryi error, routeMatched family=${this.detectRouteFamily(undefined)}: ${String(error)}`,
        tenantId: params.tenantId,
        gatewayOutcome: outcome,
      });
      return {
        kind: 'blocked',
        response: this.buildYoryiControlledResponse(outcome, 'P0', requestId),
        family: 'P0',
      };
    }
  }

  private detectRouteFamily(toolName?: string): RouteFamily {
    if (!toolName) return 'P0';
    if (toolName.includes('trend') || toolName.includes('snapshot') || toolName.includes('debt') || toolName.includes('collection')) {
      return 'P2';
    }
    if (toolName.includes('dashboard') || toolName.includes('TPL') || toolName.includes('executive') || toolName.includes('cross_query')) {
      return 'P3';
    }
    return 'P0';
  }

  private generateTraceId(): string {
    try {
      return crypto.randomUUID().slice(0, 8).toUpperCase();
    } catch {
      return `T${Date.now().toString(36).toUpperCase()}`;
    }
  }

  private shouldUseYoryiEngine(tenantId: string, userRoles: string[]): boolean {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const envEnabledRaw = process.env.ASSISTANT_YORYI_ENGINE_ENABLED;
    const enabled = envEnabledRaw !== undefined
      ? envEnabledRaw === 'true'
      : nodeEnv !== 'production';

    const canaryTenantsList = this.parseCsvEnv(process.env.ASSISTANT_YORYI_CANARY_TENANTS);
    const role = this.resolvePrimaryAdminRole(userRoles);
    const hasWildcard = canaryTenantsList.includes('*');

    if (!enabled) {
      this.logger.warn({
        msg: '[BRIDGE] routing=FALLBACK (yoryi disabled)',
        ASSISTANT_YORYI_ENGINE_ENABLED: envEnabledRaw ?? '(not set)',
        NODE_ENV: nodeEnv,
        defaultEnableApplied: envEnabledRaw === undefined,
      });
      return false;
    }

    if (!role) {
      this.logger.warn({ msg: '[BRIDGE] routing=FALLBACK (no admin role)', userRoles, tenantId });
      return false;
    }

    const baseUrl = process.env.YORYI_ASSISTANT_API_BASE_URL || '';
    if (!baseUrl) {
      this.logger.warn({ msg: '[BRIDGE] routing=FALLBACK (no baseUrl)', tenantId });
      return false;
    }

    if (hasWildcard) {
      this.logger.debug({ msg: '[BRIDGE] routing=YORYI_CORE (canary wildcard)', tenantId, role, canaryTenantsList });
      return true;
    }

    if (canaryTenantsList.length === 0) {
      this.logger.debug({ msg: '[BRIDGE] routing=YORYI_CORE (no canary filter)', tenantId, role });
      return true;
    }

    if (!canaryTenantsList.includes(tenantId)) {
      this.logger.warn({
        msg: '[BRIDGE] routing=FALLBACK (canary miss)',
        tenantId,
        canaryTenants: canaryTenantsList,
        reason: 'tenant_not_in_canary_list',
      });
      return false;
    }

    this.logger.debug({ msg: '[BRIDGE] routing=YORYI_CORE', tenantId, role, canaryMatch: true });
    return true;
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

  private isAllowedYoryiAnswerSource(answerSource?: string, family: RouteFamily = 'P0'): boolean {
    const p0Enforced = process.env.ASSISTANT_P0_ENFORCEMENT_ENABLED === 'true';
    if (p0Enforced) {
      if (family === 'P0') {
        return answerSource === 'live_data';
      }
      return answerSource === 'live_data' || answerSource === 'snapshot';
    }
    return answerSource === 'live_data' || answerSource === 'snapshot' || answerSource === 'knowledge';
  }

  private buildYoryiControlledResponse(
    reason: GatewayOutcome,
    family: RouteFamily,
    requestId?: string,
  ): ChatResponse {
    const traceId = requestId ?? this.generateTraceId();
    const familyMessages: Record<RouteFamily, { detail: string; hint: string }> = {
      P0: {
        detail: 'El engine primario respondió con error o payload inválido para consultas P0.',
        hint: 'No puedo confirmar una respuesta operativa segura en este momento.',
      },
      P2: {
        detail: 'El engine primario respondió con error o payload inválido para snapshots P2.',
        hint: 'No pude obtener datos de tendencias y métricas en este momento.',
      },
      P3: {
        detail: 'El engine primario respondió con error o payload inválido para dashboard P3.',
        hint: 'No pude obtener el dashboard ejecutivo en este momento.',
      },
    };
    const { detail, hint } = familyMessages[family];
    const reasonHint: Record<GatewayOutcome, string> = {
      success: hint,
      timeout: 'El engine primario excedio el tiempo de respuesta.',
      unavailable: 'El engine primario no esta disponible temporalmente.',
      invalid_payload: 'El engine primario respondio con payload invalido.',
      contract_mismatch: 'La respuesta no cumple el contrato esperado por el bridge.',
      denied:
        'Para confirmar un dato operativo necesito respuesta live_data. Reformula con unidad y torre exactas o revisa Pagos.',
    };
    const finalHint = reasonHint[reason] ?? hint;
    return {
      answer: `${detail} ${finalHint} Referencia: ${traceId}. Intenta reformular la consulta o reintenta en unos minutos.`,
      answerSource: 'fallback',
      responseType: 'clarification',
      suggestedActions: [],
      metadata: { traceId, gatewayOutcome: reason, routeFamily: family },
    };
  }

  private isOperationalQuery(page: string, message: string): boolean {
    const normalizedPage = this.normalizeText(page);
    const normalizedMessage = this.normalizeText(message);
    const pageSuggestsOperational =
      normalizedPage.includes('payment') ||
      normalizedPage.includes('charge') ||
      normalizedPage.includes('unit') ||
      normalizedPage.includes('finanza');
    const messageSuggestsOperational =
      normalizedMessage.includes('deuda') ||
      normalizedMessage.includes('cuanto debe') ||
      normalizedMessage.includes('saldo') ||
      normalizedMessage.includes('expensa') ||
      normalizedMessage.includes('adeuda');
    return pageSuggestsOperational || messageSuggestsOperational;
  }

  private buildYoryiHeaders(context: {
    tenantId: string;
    userId: string;
    role: string;
    p3Enabled: boolean;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-app-id': 'buildingos',
      'x-tenant-id': context.tenantId,
      'x-user-id': context.userId,
      'x-user-role': context.role,
      'x-assistant-p3-enabled': context.p3Enabled ? 'true' : 'false',
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

  private resolveModuleFromMessage(message: string): string {
    const normalized = this.normalizeText(message);

    if (normalized.includes('cobranza') || normalized.includes('deuda') ||
        normalized.includes('pago') || normalized.includes('moros')) {
      return 'payments';
    }
    if (normalized.includes('charge') || normalized.includes('expensa') ||
        normalized.includes('gasto')) {
      return 'charges';
    }
    if (normalized.includes('ticket') || normalized.includes('mantenimiento')) {
      return 'tickets';
    }
    return 'general';
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
        answerSource: 'live_data',
        responseType: 'clarification',
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
        answerSource: 'live_data',
        responseType: 'summary',
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const primaryOccupants = occupants.filter((o) => o.isPrimary);
    if (primaryOccupants.length > 1) {
      return {
        answer: `Hay mas de un ocupante primario en ${building.name} unidad ${unit.label || unit.code}. Necesito que revises la asignacion antes de confirmar un nombre.`,
        answerSource: 'live_data',
        responseType: 'clarification',
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
        answerSource: 'live_data',
        responseType: 'summary',
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const roleLabel =
      selected.role === UnitOccupantRole.OWNER ? 'propietario/a' : 'residente';

    return {
      answer: `En ${building.name}, la unidad ${unit.label || unit.code} tiene como ${roleLabel} principal a ${selected.member.name}.`,
      answerSource: 'live_data',
      responseType: 'exact',
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

    if (this.isMutationLikeStrictQuery(normalizedMessage)) {
      return {
        answer:
          'Estoy en modo solo consulta. No puedo ejecutar cambios (crear cargos, registrar pagos o modificar residentes).',
        answerSource: 'live_data',
        responseType: 'clarification',
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: {} }],
      };
    }

    if (this.isAggregateDebtQuery(normalizedMessage)) {
      return this.tryResolveAggregateDebtQuestion(tenantId, normalizedMessage);
    }

    const isDebtQuery =
      normalizedMessage.includes('debe') ||
      normalizedMessage.includes('cuanto debe') ||
      normalizedMessage.includes('deuda') ||
      normalizedMessage.includes('saldo') ||
      normalizedMessage.includes('uf') ||
      normalizedMessage.includes('expensa') ||
      normalizedMessage.includes('moros') ||
      normalizedMessage.includes('saldo pendiente') ||
      normalizedMessage.includes('adeuda') ||
      normalizedMessage.includes('al dia');

    if (!isDebtQuery) {
      return null;
    }

    const unitToken = this.extractUnitToken(normalizedMessage);
    const towerToken = this.extractTowerToken(normalizedMessage);

    if (!unitToken || !towerToken) {
      if (unitToken && !towerToken) {
        return {
          answer:
            'Para responder con precision necesito la torre/edificio exacto. Ejemplo: "Cuanto debe la unidad 123 de Torre A".',
          answerSource: 'live_data',
          responseType: 'clarification',
          suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: {} }],
        };
      }
      if (!unitToken && towerToken) {
        return {
          answer:
            'Para responder con precision necesito la unidad exacta dentro de la torre/edificio. Ejemplo: "Cuanto debe la unidad 123 de Torre A".',
          answerSource: 'live_data',
          responseType: 'clarification',
          suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: {} }],
        };
      }
      return {
        answer:
          'Para responder con precision necesito ambos datos exactos: unidad y torre. Ejemplo: "Cuanto debe la unidad 123 de Torre A".',
        answerSource: 'live_data',
        responseType: 'clarification',
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
      answerSource: 'live_data',
      responseType: 'exact',
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
    const pisoDeptoMatch = message.match(/(?:depto|departamento)\s+(\d{1,2})\s+piso\s+(\d{1,2})/i);
    if (pisoDeptoMatch?.[1] && pisoDeptoMatch?.[2]) {
      const depto = pisoDeptoMatch[1].padStart(2, '0');
      const piso = pisoDeptoMatch[2].padStart(2, '0');
      return `${piso}-${depto}`;
    }

    const pisoDeptoInverseMatch = message.match(/piso\s+(\d{1,2})\s+(?:depto|departamento)\s+(\d{1,2})/i);
    if (pisoDeptoInverseMatch?.[1] && pisoDeptoInverseMatch?.[2]) {
      const piso = pisoDeptoInverseMatch[1].padStart(2, '0');
      const depto = pisoDeptoInverseMatch[2].padStart(2, '0');
      return `${piso}-${depto}`;
    }

    const explicitMatch = message.match(/(?:unidad|apartamento|depto|depar?tamento|apto|uf)\s+([a-z0-9-]+)/i);
    if (explicitMatch?.[1]) {
      const token = explicitMatch[1].toLowerCase();
      const floorDeptMatch = token.match(/^(\d{1,2})-(\d{1,2})$/);
      if (floorDeptMatch?.[1] && floorDeptMatch?.[2]) {
        const floor = floorDeptMatch[1].padStart(2, '0');
        const dept = floorDeptMatch[2].padStart(2, '0');
        return `${floor}-${dept}`;
      }
      return token;
    }

    return null;
  }

  private extractTowerToken(message: string): string | null {
    const match = message.match(/(?:torre|edificio|bloque)\s+([a-z0-9]+)/i);
    return match?.[1] || null;
  }

  private matchesTowerToken(buildingName: string, towerToken: string): boolean {
    const normalizedName = this.normalizeText(buildingName);
    const token = this.normalizeText(towerToken);
    const candidates = [`torre ${token}`, `edificio ${token}`, `bloque ${token}`];
    return candidates.some(
      (candidate) => normalizedName === candidate || normalizedName.includes(candidate),
    );
  }

  private matchesUnitToken(unit: { code: string; label: string | null }, unitToken: string): boolean {
    const token = this.normalizeText(unitToken);
    const compactToken = token.replace(/[^a-z0-9]/g, '');
    const code = this.normalizeText(unit.code);
    const compactCode = code.replace(/[^a-z0-9]/g, '');
    const label = this.normalizeText(unit.label || '');
    const floorDeptMatch = token.match(/^(\d{1,2})-(\d{1,2})$/);
    const floorPart = floorDeptMatch?.[1];
    const deptPart = floorDeptMatch?.[2];
    const derivedCode =
      floorPart && deptPart
        ? `${floorPart.padStart(2, '0')}${deptPart.padStart(2, '0')}`
        : null;
    const derivedCodeV2 =
      floorPart && deptPart
        ? `${String(parseInt(floorPart, 10))}${deptPart.padStart(2, '0')}`
        : null;
    return (
      code === token ||
      label === token ||
      compactCode === compactToken ||
      (/^\d{3,4}$/.test(compactToken) && compactCode.endsWith(compactToken)) ||
      (derivedCode !== null && compactCode.endsWith(derivedCode)) ||
      (derivedCodeV2 !== null && compactCode.endsWith(derivedCodeV2))
    );
  }

  private isAggregateDebtQuery(normalizedMessage: string): boolean {
    const aggregateKeywords = [
      'top',
      'ranking',
      'morosos',
      'morosidad',
      'aging',
      'antiguedad',
      'por torre',
      'que torres',
      'resumen',
      'unidades con deuda',
      'listame',
    ];
    return aggregateKeywords.some((keyword) => normalizedMessage.includes(keyword));
  }

  private shouldOverrideGenericUnitLookupMenu(message: string, answer: string): boolean {
    const normalizedMessage = this.normalizeText(message);
    const normalizedAnswer = this.normalizeText(answer);
    const looksGenericMenu =
      normalizedAnswer.includes('elegi una opcion') ||
      normalizedAnswer.includes('decime si queres');
    if (!looksGenericMenu) {
      return false;
    }

    const hasUnitAndBuilding =
      /(?:unidad|apartamento|depto|departamento|apto|uf)\s+[a-z0-9-]+/.test(normalizedMessage) &&
      /(?:torre|edificio|bloque)\s+[a-z0-9]+/.test(normalizedMessage);
    const isResidentLookup =
      normalizedMessage.includes('residente') ||
      normalizedMessage.includes('telefono');

    return hasUnitAndBuilding && isResidentLookup;
  }

  private isMutationLikeStrictQuery(normalizedMessage: string): boolean {
    return (
      normalizedMessage.includes('crea un cargo') ||
      normalizedMessage.includes('crear cargo') ||
      normalizedMessage.includes('registra un pago') ||
      normalizedMessage.includes('registrar pago') ||
      normalizedMessage.includes('cambia el residente') ||
      normalizedMessage.includes('cambiar residente') ||
      normalizedMessage.includes('modifica residente')
    );
  }

  private async tryResolveAggregateDebtQuestion(
    tenantId: string,
    normalizedMessage: string,
  ): Promise<ChatResponse> {
    const towerToken = this.extractTowerToken(normalizedMessage);

    const buildings = await this.prisma.building.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    });

    const scopedBuildings = towerToken
      ? buildings.filter((building) => this.matchesTowerToken(building.name, towerToken))
      : buildings;

    if (towerToken && scopedBuildings.length === 0) {
      return {
        answer: `No encontré la torre "${towerToken.toUpperCase()}". Indicame otra torre/edificio o querés el resumen general del tenant.`,
        answerSource: 'live_data',
        responseType: 'clarification',
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    if (scopedBuildings.length === 0) {
      return {
        answer:
          'Necesito scope mínimo para el agregado: indicame torre/edificio o si querés el resumen general del tenant (con período opcional).',
        answerSource: 'live_data',
        responseType: 'clarification',
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    const buildingIds = scopedBuildings.map((building) => building.id);
    const [tenant, charges] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      }),
      this.prisma.charge.findMany({
        where: {
          tenantId,
          buildingId: { in: buildingIds },
          canceledAt: null,
        },
        select: {
          amount: true,
          buildingId: true,
          paymentAllocations: {
            select: {
              amount: true,
              payment: { select: { status: true } },
            },
          },
        },
      }),
    ]);

    const outstandingByBuilding = new Map<string, number>();
    for (const building of scopedBuildings) {
      outstandingByBuilding.set(building.id, 0);
    }

    for (const charge of charges) {
      const approvedAllocated = charge.paymentAllocations.reduce((allocSum, allocation) => {
        const status = allocation.payment?.status;
        if (status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) {
          return allocSum + allocation.amount;
        }
        return allocSum;
      }, 0);
      const outstanding = Math.max(0, charge.amount - approvedAllocated);
      outstandingByBuilding.set(
        charge.buildingId,
        (outstandingByBuilding.get(charge.buildingId) || 0) + outstanding,
      );
    }

    const ranking = scopedBuildings
      .map((building) => ({
        building,
        outstanding: outstandingByBuilding.get(building.id) || 0,
      }))
      .sort((a, b) => b.outstanding - a.outstanding);

    const asksRanking =
      normalizedMessage.includes('top') ||
      normalizedMessage.includes('ranking') ||
      normalizedMessage.includes('morosos') ||
      normalizedMessage.includes('que torres') ||
      normalizedMessage.includes('por torre');

    if (asksRanking) {
      const top = ranking.slice(0, 3);
      const lines = top.map((item, index) =>
        `${index + 1}. ${item.building.name}: ${this.formatMoney(item.outstanding, tenant.currency)}`,
      );
      return {
        answer:
          lines.length > 0
            ? `Top deuda por torre/edificio:\n${lines.join('\n')}`
            : 'No hay deuda pendiente para el scope consultado.',
        answerSource: 'live_data',
        responseType: 'list',
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    const totalOutstanding = ranking.reduce((sum, item) => sum + item.outstanding, 0);
    return {
      answer: `Resumen de deuda agregada (${towerToken ? `scope: ${towerToken.toUpperCase()}` : 'scope: tenant'}): total pendiente ${this.formatMoney(totalOutstanding, tenant.currency)} en ${ranking.length} torre(s)/edificio(s).`,
      answerSource: 'live_data',
      responseType: 'summary',
      suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
    };
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
          answerSource: 'live_data',
          responseType: 'clarification',
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
          answerSource: 'live_data',
          responseType: 'clarification',
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
          answerSource: 'live_data',
          responseType: 'clarification',
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
          answerSource: 'live_data',
          responseType: 'clarification',
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

  private isP3EnabledForTenant(tenantId: string): boolean {
    if (process.env.ASSISTANT_P3_ENABLED !== 'true') {
      return false;
    }

    const canaryTenants = this.parseCsvEnv(process.env.ASSISTANT_YORYI_CANARY_TENANTS);
    if (canaryTenants.includes('*')) {
      return true;
    }
    if (canaryTenants.length === 0) {
      return true;
    }
    return canaryTenants.includes(tenantId);
  }

  private normalizeResponseContract(response: ChatResponse): ChatResponse {
    const answerSource = this.normalizeAnswerSource(response.answerSource);
    const responseType = this.normalizeResponseType(response.responseType, response.answer);
    return {
      ...response,
      answerSource,
      responseType,
    };
  }

  private normalizeAnswerSource(answerSource?: string): 'live_data' | 'knowledge' | 'fallback' {
    if (answerSource === 'live_data' || answerSource === 'knowledge' || answerSource === 'fallback') {
      return answerSource;
    }
    return 'fallback';
  }

  private normalizeResponseType(
    responseType: string | undefined,
    answer: string,
  ): 'exact' | 'summary' | 'list' | 'clarification' {
    switch ((responseType || '').toLowerCase()) {
      case 'exact':
      case 'summary':
      case 'list':
      case 'clarification':
        return responseType!.toLowerCase() as 'exact' | 'summary' | 'list' | 'clarification';
      case 'metric':
        return 'exact';
      case 'answer':
        return 'summary';
      case 'error':
      case 'no_data':
        return 'clarification';
      default:
        return this.looksLikeClarification(answer) ? 'clarification' : 'summary';
    }
  }

  private looksLikeClarification(answer: string): boolean {
    const normalized = this.normalizeText(answer || '');
    return (
      normalized.includes('necesito') ||
      normalized.includes('aclaracion') ||
      normalized.includes('aclara') ||
      normalized.includes('reformula') ||
      normalized.includes('modo solo consulta') ||
      normalized.includes('no puedo ejecutar cambios')
    );
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

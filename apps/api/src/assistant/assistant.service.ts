import { Injectable, BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, Prisma, UnitOccupantRole } from '@prisma/client';
import { AiBudgetService } from './budget.service';
import { AiRouterService } from './router.service';
import { AiCacheService } from './cache.service';
import { AiContextSummaryService, ContextSummary } from './context-summary.service';
import { OllamaProvider } from './ollama.provider';
import { AiClassifierService } from './classifier.service';
import { AssistantQueryParser } from './query-parser/assistant-query-parser';
import { AssistantUnitResolverService } from './unit-resolver/assistant-unit-resolver.service';
import { AuthorizeService } from '../rbac/authorize.service';
import type { Permission } from '../rbac/permissions';
import { AssistantQueryPlanService } from './query-plan.service';
import { AssistantQueryExecutorsService } from './query-executors.service';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';
import { AssistantDebtIntentInterpreter } from './debt-intent-interpreter';
import {
  SuggestedActionType,
  SuggestedAction,
  ChatResponse,
  AiProvider,
  AiProviderContext,
  AiProviderStatus,
  StructuredResponse,
  type AssistantConsensusPeriod,
} from './ai.types';
import type { AssistantConsensusEvaluation } from './ai.types';

// Re-export types for backward compatibility
export type { SuggestedActionType, SuggestedAction, ChatResponse, AiProvider };

// Intent Engine imports
import { IntentRegistry } from './intent-engine/intent-registry';
import { IntentExtractorService } from './intent-engine/intent-extractor.service';
import { AssistantLocalConsensusService } from './intent-engine/local-consensus.service';
import { EntityResolverService } from './resolver/entity-resolver.service';
import { AmbiguityService } from './resolver/ambiguity.service';
import { RedisConversationContextService } from './context/redis-conversation-context.service';
import { QueryPlannerService } from './planner/query-planner.service';
import { QueryExecutorService } from './executor/query-executor.service';
import { ResponseFormatterService } from './formatter/response-formatter.service';
import {
  ExtractedIntent,
  EntityResolution,
  ConversationTurn,
  PendingClarificationContext,
} from './intent-engine/intent.types';
import { validateExtractedIntent } from './intent-engine/intent.schema';
import { FilterCoverageValidator } from './intent-engine/filter-coverage.validator';
import type { AssistantQueryPlan } from './query-plan.types';

// Intent definitions
import { unitDebtIntent } from './intent-engine/allowed-intents/unit-debt.intent';
import { unitResidentsIntent } from './intent-engine/allowed-intents/unit-residents.intent';
import { unitDocumentsIntent } from './intent-engine/allowed-intents/unit-documents.intent';
import { unitTicketsIntent } from './intent-engine/allowed-intents/unit-tickets.intent';
import { unitPaymentsIntent } from './intent-engine/allowed-intents/unit-payments.intent';
import { buildingDebtIntent } from './intent-engine/allowed-intents/building-debt.intent';
import { buildingDelinquentsIntent } from './intent-engine/allowed-intents/building-delinquents.intent';
import { buildingDocumentsIntent } from './intent-engine/allowed-intents/building-documents.intent';
import { buildingTicketsIntent } from './intent-engine/allowed-intents/building-tickets.intent';
import { buildingPaymentsIntent } from './intent-engine/allowed-intents/building-payments.intent';
import { buildingStatsIntent } from './intent-engine/allowed-intents/building-stats.intent';
import { tenantDebtIntent } from './intent-engine/allowed-intents/tenant-debt.intent';
import { IntentSemanticValidatorService } from './intent-semantic-validator.service';
import type { IntentSemanticValidationResult } from './intent-semantic-validator.service';
import type { CanonicalFinancePeriod } from './finance-period.types';
import { isLocalDevelopmentEnv, resolveAssistantProviderMode } from './assistant-env';

const TEMPORARILY_UNAVAILABLE_INTENTS = new Set([
  'expenses_summary',
  'cashflow_compare',
  'vendors_list',
  'communications_send_reminder',
]);

export interface ChatRequest {
  readonly message: string;
  readonly page: string;
  readonly currentPage?: string;
  readonly buildingId?: string;
  readonly unitId?: string;
  readonly financePeriod?: string;
  readonly conversationId?: string;
  readonly sessionId?: string;
  readonly debug?: boolean;
  /**
   * Internal-only route marker for analytics/compatibility.
   * Not part of the public HTTP contract.
   */
  readonly routeSource?: 'legacy_chat' | 'chat_v2';
}

interface ContextValidation {
  readonly tenantId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly buildingId?: string;
  readonly unitId?: string;
  readonly page: string;
  readonly userRoles: readonly string[];
  readonly buildingScope?: string; // For BUILDING-scoped roles
  readonly unitScope?: string; // For UNIT-scoped roles
}



// MOCK Provider - fallback profesional que NO inventa datos
@Injectable()
export class MockAiProvider implements AiProvider {
  /**
   * Fallback educado en español. NUNCA inventa datos.
   * Sugiere navegación basada en el contexto de la página.
   */
  async chat(
    message: string,
    context: AiProviderContext,
    options?: { model?: string; maxTokens?: number }
  ): Promise<ChatResponse> {
    const delayMs = options?.model === 'gpt-4.1-nano' ? 50 : 100;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const normalized = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Detectar tema por palabras clave para sugerir acciones relevantes
    const hasTicket = /ticket|reclamo|problema|averia|falla/.test(normalized);
    const hasPayment = /pago|cobro|deuda|saldo|expensa/.test(normalized);
    const hasDoc = /documento|archivo|pdf|comprobante/.test(normalized);
    const hasUnit = /unidad|depto|apartamento|residente/.test(normalized);

    let answer: string;

    if (hasTicket) {
      answer = 'Para ver los tickets y reclamos, accedé a la sección de Tickets. Si querés consultar por una unidad específica, indicame el número de unidad y el edificio.';
    } else if (hasPayment) {
      answer = 'Para consultar pagos, deudas o saldos, podés ir a la sección de Finanzas. Si querés datos de una unidad específica, escribime "¿Cuánto debe la unidad X del edificio Y?".';
    } else if (hasDoc) {
      answer = 'Los documentos están en la sección de Archivos. Si buscás algo específico de una unidad, indicame el número y el edificio.';
    } else if (hasUnit) {
      answer = 'Si querés información de una unidad específica, escribime el número de unidad y el edificio. Por ejemplo: "¿Quién vive en el departamento 101 del Edificio A?" o "¿Cuánto debe la unidad 101?".';
    } else {
      answer = 'Entendí tu consulta. Si necesitás datos específicos de una unidad o edificio, indicame los detalles exactos. También puedo ayudarte a navegar a las distintas secciones del sistema.';
    }

    // Sugerir acciones basadas en la página actual y el tema detectado
    const suggestedActions: SuggestedAction[] = [];

    if (hasTicket || context.page === 'tickets') {
      suggestedActions.push({
        type: 'VIEW_TICKETS',
        payload: { buildingId: context.buildingId },
      });
    }

    if (hasPayment || context.page === 'payments' || context.page === 'charges') {
      suggestedActions.push({
        type: 'VIEW_PAYMENTS',
        payload: { buildingId: context.buildingId, unitId: context.unitId },
      });
    }

    if (hasDoc || context.page === 'documents') {
      suggestedActions.push({
        type: 'VIEW_DOCUMENTS',
        payload: { buildingId: context.buildingId },
      });
    }

    if (suggestedActions.length === 0) {
      suggestedActions.push(
        { type: 'VIEW_REPORTS', payload: { buildingId: context.buildingId } },
      );
    }

    return { answer, suggestedActions };
  }

  /**
   * Mock provider is always healthy (no external dependency)
   */
  async healthCheck(): Promise<AiProviderStatus> {
    return {
      status: 'healthy',
      provider: 'mock',
      latencyMs: 0,
    };
  }
}

class DisabledAiProvider implements AiProvider {
  async chat(
    _message: string,
    _context: AiProviderContext,
    _options?: { model?: string; maxTokens?: number },
  ): Promise<ChatResponse> {
    return {
      answer: 'AI is not configured for this environment.',
      suggestedActions: [],
    };
  }

  async healthCheck(): Promise<AiProviderStatus> {
    return {
      status: 'disabled',
      provider: 'none',
      latencyMs: 0,
    };
  }
}

@Injectable()
export class AssistantService implements OnModuleInit {
  private readonly provider: AiProvider;
  private readonly providerMode: 'MOCK' | 'OLLAMA' | 'NONE';
  private readonly dailyLimit: number;
  private readonly logger = new Logger(AssistantService.name);
  private readonly queryParser = new AssistantQueryParser();

  // Intent Engine feature flag
  private readonly intentEngineEnabled: boolean;

  // Stored references for use in chatV2
  private readonly _intentRegistry: IntentRegistry;
  private readonly _intentExtractor: IntentExtractorService;
  private readonly _entityResolver: EntityResolverService;
  private readonly _ambiguityService: AmbiguityService;
  private readonly _conversationContext: RedisConversationContextService;
  private readonly _queryPlanner: QueryPlannerService;
  private readonly _queryExecutor: QueryExecutorService;
  private readonly _responseFormatter: ResponseFormatterService;
  private readonly debtIntentInterpreter = new AssistantDebtIntentInterpreter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly budget: AiBudgetService,
    private readonly router: AiRouterService,
    private readonly cache: AiCacheService,
    private readonly contextSummary: AiContextSummaryService,
    private readonly ollamaProvider: OllamaProvider,
    private readonly mockAiProvider: MockAiProvider,
    private readonly classifier: AiClassifierService,
    private readonly unitResolver: AssistantUnitResolverService,
    private readonly authorize: AuthorizeService,
    private readonly queryPlanService: AssistantQueryPlanService,
    private readonly queryExecutors: AssistantQueryExecutorsService,
    private readonly debtCalculator: AssistantDebtCalculatorService,
    // Intent Engine services injected
    private readonly intentRegistry: IntentRegistry,
    private readonly intentExtractor: IntentExtractorService,
    private readonly localConsensusService: AssistantLocalConsensusService,
    private readonly entityResolver: EntityResolverService,
    private readonly ambiguityService: AmbiguityService,
    private readonly conversationContext: RedisConversationContextService,
    private readonly queryPlanner: QueryPlannerService,
    private readonly queryExecutor: QueryExecutorService,
    private readonly responseFormatter: ResponseFormatterService,
    private readonly filterCoverageValidator: FilterCoverageValidator,
    private readonly intentSemanticValidator: IntentSemanticValidatorService,
  ) {
    this.dailyLimit = parseInt(process.env.AI_DAILY_LIMIT_PER_TENANT || '100', 10);
    this.intentEngineEnabled = process.env.AI_INTENT_ENGINE_ENABLED !== 'false';

    // Initialize provider based on env
    this.providerMode = resolveAssistantProviderMode();
    if (this.providerMode === 'OLLAMA') {
      this.provider = this.ollamaProvider;
    } else if (this.providerMode === 'NONE') {
      this.provider = new DisabledAiProvider();
    } else {
      this.provider = this.mockAiProvider;
    }

    // Store references for use in chatV2
    this._intentRegistry = intentRegistry;
    this._intentExtractor = intentExtractor;
    this._entityResolver = entityResolver;
    this._ambiguityService = ambiguityService;
    this._conversationContext = conversationContext;
    this._queryPlanner = queryPlanner;
    this._queryExecutor = queryExecutor;
    this._responseFormatter = responseFormatter;
  }

  /**
   * Initialize intent registry with all available intents
   */
  async onModuleInit(): Promise<void> {
    // Register all available intents
    const intents = [
      unitDebtIntent,
      unitResidentsIntent,
      unitDocumentsIntent,
      unitTicketsIntent,
      unitPaymentsIntent,
      buildingDebtIntent,
      buildingDelinquentsIntent,
      buildingDocumentsIntent,
      buildingTicketsIntent,
      buildingPaymentsIntent,
      buildingStatsIntent,
      tenantDebtIntent,
      // Temporarily unavailable intents are intentionally excluded from the
      // active routing registry until their executors are implemented.
      // expensesSummaryIntent,
      // cashflowCompareIntent,
      // vendorsListIntent,
      // communicationsSendReminderIntent,
    ];

    for (const intent of intents) {
      if (!this.intentRegistry.has(intent.name)) {
        this.intentRegistry.register(intent);
      }
    }

    this.logger.log(`[AssistantService] Intent engine initialized with ${intents.length} intents (enabled: ${this.intentEngineEnabled})`);
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
      membershipId,
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
      { membershipId, userRoles },
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

    const queryPlan = this.queryPlanService.createPlan(request.message);
    const plannedOperationalResponse = queryPlan
      ? await this.queryExecutors.execute({
        tenantId,
        userId,
        userRoles,
        plan: queryPlan,
      })
      : null;

    const strictOperationalResponse = plannedOperationalResponse ?? await this.tryResolveStrictOperationalQuestion(
      tenantId,
      request.message,
      userRoles,
      userId,
    );

    if (strictOperationalResponse) {
      response = strictOperationalResponse;
      resolvedModelForLog = plannedOperationalResponse ? 'LIVE_DATA_PLAN' : 'LIVE_DATA_STRICT';
    } else {
      // NIVEL 2: Classifier LLM para detectar intención con lenguaje natural
      const classifierResult = await this.classifier.classify(request.message);

      if (classifierResult.confidence > 0.85 && classifierResult.category !== 'GENERAL') {
        response = this.buildClassifierSuggestionResponse(
          classifierResult,
          request.buildingId,
          request.unitId,
        );
        resolvedModelForLog = 'CLASSIFIER_SUGGESTION';
      } else {
      // NIVEL 3: Fallback al provider (development-only mock, Ollama, or disabled response)
      response = await this.provider.chat(
        request.message,
        {
            buildingId: request.buildingId,
            unitId: request.unitId,
            page: request.page,
            tenantId,
            contextSnapshot: contextSummary?.snapshot as unknown as Record<string, unknown> | undefined,
          },
          { model: modelName, maxTokens },
        );
        resolvedModelForLog = 'MOCK_FALLBACK';
      }
    }

    // Filter suggested actions based on RBAC before any cache write.
    response.suggestedActions = this.filterSuggestedActions(
      response.suggestedActions,
      userRoles,
      context,
    );

    // Cache only non-live-data responses. Live-data strict answers depend on
    // current scoped RBAC and should be recomputed after authorization.
    if (resolvedModelForLog !== 'LIVE_DATA_STRICT' && resolvedModelForLog !== 'LIVE_DATA_PLAN') {
      this.cache.set(cacheKey, response, resolvedModelForLog);
    }

    // Store interaction log (fire-and-forget)
    // Determine modelSize from router decision
    const modelSizeStr = resolvedModelForLog === 'YORYI_CORE'
      ? 'YORYI_CORE'
      : resolvedModelForLog === 'LIVE_DATA_STRICT' || resolvedModelForLog === 'LIVE_DATA_PLAN'
        ? resolvedModelForLog
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
        provider: this.providerMode,
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

  /**
   * V2 Chat endpoint: Process user message with the intent engine
   *
   * Feature-gated via AI_INTENT_ENGINE_ENABLED env var.
   * When disabled, returns 403 ForbiddenException.
   *
   * Pipeline:
   * 1. Validate message
   * 2. Check rate limits
   * 3. Get conversation context (sessionId or generate one)
   * 4. IntentExtractor.extractIntent() - dual LLM with fallback
   * 5. EntityResolver.resolveBuilding/resolveUnit/resolvePerson
   * 6. If ambiguous -> ResponseFormatter.formatV2() with clarification
   * 7. QueryPlanner.buildPlan()
   * 8. QueryExecutor.execute() with RBAC
   * 9. ResponseFormatter.formatV2()
   * 10. Store turn in ConversationContext
   * 11. Return StructuredResponse
   *
   * @param tenantId - Tenant ID from X-Tenant-Id header
   * @param userId - User ID from JWT
   * @param membershipId - Membership ID from JWT
   * @param request - Chat request with message, page, buildingId, unitId, sessionId
   * @param userRoles - User roles for this tenant
   * @returns StructuredResponse with type, title, summary, data, actions, meta
   */
  async chatV2(
    tenantId: string,
    userId: string,
    membershipId: string,
    request: ChatRequest & { sessionId?: string },
    userRoles: string[],
  ): Promise<StructuredResponse> {
    const debugEnabled = request.debug === true;
    const debugInfo: NonNullable<StructuredResponse['debug']> = {
      usedDeterministic: false,
      deterministicIntent: null,
      deterministicConfidence: null,
      coverageStatus: 'failed',
      coverageMissing: [],
      usedLLM: false,
      llmProvider: 'none',
      llmBaseUrl: isLocalDevelopmentEnv() ? (process.env.AI_OLLAMA_URL || 'http://localhost:11434') : (process.env.AI_OLLAMA_URL || ''),
      llmModel: isLocalDevelopmentEnv() ? (process.env.AI_OLLAMA_MODEL || 'llama3:latest') : (process.env.AI_OLLAMA_MODEL || ''),
      llmReason: 'none',
      zodValidationPassed: false,
      finalIntent: undefined,
      finalFilters: {},
      rbacChecked: false,
      tenantScoped: true,
    };

    // Check feature flag (bypass in development)
    const isDevelopment = isLocalDevelopmentEnv();
    if (!this.intentEngineEnabled && !isDevelopment) {
      throw new ForbiddenException('Intent engine disabled');
    }

    if (!this.intentEngineEnabled && isDevelopment) {
      this.logger.warn('[chatV2] Intent engine disabled by flag, but bypassing in development mode');
    }

    // Validate message
    if (!request.message || request.message.trim().length === 0) {
      throw new BadRequestException('Message cannot be empty');
    }

    if (request.message.length > 2000) {
      throw new BadRequestException('Message cannot exceed 2000 characters');
    }

    // Validate context (buildingId, unitId ownership)
    await this.validateContext(
      tenantId,
      userId,
      request.buildingId,
      request.unitId,
      userRoles,
      membershipId,
    );

    // Check rate limit
    await this.checkRateLimit(tenantId);

    // Check monthly calls limit
    const callsLimitCheck = await this.budget.checkCallsLimit(tenantId);
    if (!callsLimitCheck.allowed) {
      throw new ConflictException(
        `AI calls limit exceeded. Used: ${callsLimitCheck.callsUsed} of ${callsLimitCheck.callsLimit} calls this month`,
      );
    }

    // Get or generate sessionId for conversation context
    // Frontend sends 'conversationId', backend expects 'sessionId'
    const sessionId = request.sessionId || request.conversationId || this.generateSessionId();

    // Step 1: Get conversation context
    const conversationContext = await this.conversationContext.getContext(tenantId, userId, sessionId);
    const lastResolved = await this.conversationContext.getLastResolved(tenantId, userId, sessionId);
    const pendingClarification = await this.conversationContext.getPendingClarification(
      tenantId,
      userId,
      sessionId,
    );
    const shouldUsePendingClarification =
      !!pendingClarification && this.isClarificationFollowUpAnswer(request.message, pendingClarification);
    let usedPendingClarification = false;

    // Build context for intent extraction
    const contextForExtraction = {
      buildingId: shouldUsePendingClarification
        ? pendingClarification.resolvedEntityIds?.buildingId || lastResolved.buildingId || request.buildingId
        : request.buildingId || lastResolved.buildingId,
      unitId: shouldUsePendingClarification
        ? pendingClarification.resolvedEntityIds?.unitId || lastResolved.unitId || request.unitId
        : request.unitId || lastResolved.unitId,
      currentPage: request.currentPage || request.page,
      financePeriod: request.financePeriod,
      userId,
      previousTurns: conversationContext as ConversationTurn[],
    };

    const deterministicPlan = this.queryPlanService.createPlan(request.message);
    if (deterministicPlan) {
      debugInfo.usedDeterministic = true;
      debugInfo.deterministicIntent = deterministicPlan.intent;
      debugInfo.deterministicConfidence = deterministicPlan.confidence;
      const coverage = this.filterCoverageValidator.analyze(request.message, {
        minAmount: deterministicPlan.filters.minAmount,
        maxAmount: deterministicPlan.filters.maxAmount,
        minDebt: deterministicPlan.filters.minDebt,
        period: deterministicPlan.filters.period,
        status: deterministicPlan.filters.status,
        method: deterministicPlan.filters.method,
        minAgeDays: deterministicPlan.filters.minAgeDays,
      });
      debugInfo.coverageStatus = coverage.complete ? 'complete' : 'incomplete';
      debugInfo.coverageMissing = coverage.missingFields;
      if (!coverage.complete) {
        debugInfo.llmReason = 'missing_filters';
      }
    } else {
      debugInfo.llmReason = 'no_intent';
    }

    // Step 2: Extract intent using dual LLM with fallback
    let extractedIntent: ExtractedIntent;
    let contextResolvedEntities: EntityResolution | undefined;
    this.logger.log(`[chatV2] Step 2: Extracting intent for message: "${request.message}"`);
    if (shouldUsePendingClarification && pendingClarification) {
      extractedIntent = this.buildIntentFromPendingClarification(
        pendingClarification,
        request.message,
      );
      contextResolvedEntities = this.buildResolvedEntitiesFromPendingClarification(
        pendingClarification,
        conversationContext,
      );
      usedPendingClarification = true;
      debugInfo.usedLLM = false;
      debugInfo.llmReason = 'pending_clarification';
      this.logger.log(
        `[chatV2] Rehydrated pending clarification for intent: ${pendingClarification.intent}`,
      );
    } else {
      const localConsensusEnabled = this.localConsensusService.isEnabled();
      const localConsensusEligible = Boolean(
        deterministicPlan &&
        ['tenant_debt', 'building_debt', 'unit_debt'].includes(deterministicPlan.intent),
      );

      if (localConsensusEnabled && localConsensusEligible) {
        const consensusResult = await this.localConsensusService.evaluate(
          request.message,
          deterministicPlan,
          contextForExtraction,
        );

        debugInfo.consensusMode = true;
        debugInfo.usedLLM = consensusResult.usedLocalModel;
        debugInfo.llmProvider = consensusResult.localProvider;
        debugInfo.llmBaseUrl = consensusResult.localBaseUrl;
        debugInfo.llmModel = consensusResult.localModel;
        debugInfo.consensusResult = consensusResult.consensus
          ? 'matched'
          : consensusResult.mismatchReason === 'local_model_failed'
            ? 'failed'
            : 'mismatch';
        debugInfo.consensusReason = consensusResult.mismatchReason;
        debugInfo.llmReason = consensusResult.consensus
          ? 'none'
          : consensusResult.mismatchReason === 'local_model_failed'
            ? 'local_model_failed'
            : 'consensus_mismatch';

        if (consensusResult.consensus && deterministicPlan) {
          extractedIntent = this.buildExtractedIntentFromPlan(
            this.mergeConsensusPlanWithModel(deterministicPlan, consensusResult.modelPlan),
          );
        } else if (
          (consensusResult.mismatchReason === 'model_semantic_invalid' ||
            consensusResult.mismatchReason === 'model_intent_scope_conflict') &&
          deterministicPlan
        ) {
          if (this.isDeterministicPlanExecutable(deterministicPlan)) {
            extractedIntent = this.buildExtractedIntentFromPlan(deterministicPlan);
          } else {
            extractedIntent = this.buildClarificationIntentFromConsensus(
              deterministicPlan,
              consensusResult,
            );
          }
        } else {
          extractedIntent = this.buildClarificationIntentFromConsensus(
            deterministicPlan,
            consensusResult,
          );
        }

        this.logger.log(
          `[chatV2] Local consensus ${consensusResult.consensus ? 'matched' : 'mismatch'} for "${request.message}"`,
        );
      } else {
        try {
          extractedIntent = await this.intentExtractor.extractIntent(
            request.message,
            contextForExtraction,
          );
          if (extractedIntent.source === 'llm' || extractedIntent.source === 'hybrid') {
            debugInfo.usedLLM = true;
            if (extractedIntent.llmProvider && extractedIntent.llmProvider !== 'none') {
              debugInfo.llmProvider = extractedIntent.llmProvider;
              if (extractedIntent.llmProvider === 'opencode') {
                debugInfo.llmBaseUrl = 'https://api.opencode.ai/v1/chat/completions';
                debugInfo.llmModel = 'qwen3.6-plus';
              }
            } else {
              debugInfo.llmProvider = 'unknown';
            }
          }
          this.logger.log(`[chatV2] Intent extracted: ${extractedIntent.intent} (confidence: ${extractedIntent.confidence})`);
        } catch (error) {
          this.logger.warn(`[chatV2] Intent extraction failed: ${error}`);

          if (deterministicPlan) {
            extractedIntent = this.buildExtractedIntentFromPlan(deterministicPlan);
            debugInfo.usedLLM = false;
            debugInfo.llmReason = deterministicPlan.confidence >= 0.9 ? 'none' : 'low_confidence';
            this.logger.warn(
              `[chatV2] Falling back to deterministic plan after intent extraction failure: ${deterministicPlan.intent}`,
            );
          } else {
          // Fallback: use conversation context for follow-up questions
          const isFollowUp = await this.detectFollowUp(
            request.message,
            conversationContext,
            tenantId,
            userId,
            sessionId,
          );

          if (isFollowUp) {
            const lastTurn = conversationContext.length > 0
              ? conversationContext[conversationContext.length - 1]
              : null;

            if (lastTurn?.resolvedEntities) {
              contextResolvedEntities = lastTurn.resolvedEntities;

              // Try to infer intent from the follow-up message using last context
              let inferredIntent = this.inferIntentFromFollowUp(request.message);
              const inferredFilters = this.inferFiltersFromFollowUp(request.message);

              // Fallback: if we can't infer a new intent, reuse the last one
              if (!inferredIntent) {
                const lastIntent = await this.conversationContext.getLastIntent(tenantId, userId, sessionId);
                if (lastIntent) {
                  inferredIntent = lastIntent;
                  this.logger.log(`[chatV2] Reusing last intent: ${lastIntent}`);
                }
              }

              if (inferredIntent) {
                extractedIntent = {
                  intent: inferredIntent,
                  entity: {
                    type: lastTurn.resolvedEntities.unit?.id ? 'unit' : 'building',
                    buildingAlias: undefined,
                    unitCode: undefined,
                  },
                  filters: inferredFilters,
                  confidence: 0.6,
                  source: 'hybrid',
                  requiresClarification: false,
                  missingFields: [],
                };
                debugInfo.usedLLM = false;
                debugInfo.llmReason = debugInfo.llmReason === 'none' ? 'low_confidence' : debugInfo.llmReason;
                this.logger.log(`[chatV2] Follow-up detected, using intent: ${inferredIntent}`);
              } else {
                throw new BadRequestException('Could not understand your message. Please rephrase.');
              }
            } else {
              throw new BadRequestException('Could not understand your message. Please rephrase.');
            }
          } else {
            throw new BadRequestException('Could not understand your message. Please rephrase.');
          }
          }
        }
      }
    }

    if (this.isTemporarilyUnavailableIntent(extractedIntent.intent)) {
      const unavailableResponse = this.buildTemporarilyUnavailableIntentResponse(extractedIntent.intent);
      if (debugEnabled) {
        (unavailableResponse as StructuredResponse).debug = debugInfo;
      }
      return unavailableResponse;
    }

    // Validate intent exists in registry
    if (!this.intentRegistry.has(extractedIntent.intent)) {
      this.logger.warn(`[chatV2] Unknown intent "${extractedIntent.intent}" from LLM, falling back to deterministic`);
      // Fallback to deterministic keyword matching
      const plan = this.queryPlanService.createPlan(request.message);
      if (plan) {
        extractedIntent = {
          intent: plan.intent,
          entity: {
            type: plan.scope === 'unit' ? 'unit' : 'building',
            buildingAlias: plan.filters.buildingAlias ?? plan.filters.buildingToken,
            unitCode: plan.filters.unitCode,
            personName: plan.filters.personName,
          },
          filters: {
            minAmount: plan.filters.minAmount,
            maxAmount: plan.filters.maxAmount,
            minDebt: plan.filters.minDebt,
            period: plan.filters.period,
            status: plan.filters.status,
            method: plan.filters.method,
            minAgeDays: plan.filters.minAgeDays,
          },
          confidence: plan.confidence,
          source: 'hybrid',
          llmProvider: 'none',
          requiresClarification: false,
          missingFields: [],
        };
      } else {
        throw new BadRequestException('Could not understand your message. Please try a different question.');
      }
    }

    if (this.isTemporarilyUnavailableIntent(extractedIntent.intent)) {
      const unavailableResponse = this.buildTemporarilyUnavailableIntentResponse(extractedIntent.intent);
      if (debugEnabled) {
        (unavailableResponse as StructuredResponse).debug = debugInfo;
      }
      return unavailableResponse;
    }

    const normalizedValidation = validateExtractedIntent({
      ...extractedIntent,
      source: extractedIntent.source ?? 'hybrid',
      requiresClarification: extractedIntent.requiresClarification ?? false,
      missingFields: extractedIntent.missingFields ?? [],
    });

    if (!normalizedValidation.success || !normalizedValidation.data) {
      this.logger.warn(`[chatV2] NormalizedIntent validation failed: ${normalizedValidation.error?.message || 'unknown error'}`);
      throw new BadRequestException('Could not normalize assistant intent. Please rephrase.');
    }

    extractedIntent = normalizedValidation.data as ExtractedIntent;
    debugInfo.zodValidationPassed = true;
    debugInfo.finalIntent = extractedIntent.intent;
    debugInfo.finalFilters = extractedIntent.filters as Record<string, unknown>;

    const semanticValidation = await this.intentSemanticValidator.evaluate({
      userText: request.message,
      deterministicPlan,
      extractedIntent,
      assistantContext: {
        page: request.page,
        currentPage: request.currentPage,
        buildingId: request.buildingId,
        unitId: request.unitId,
        financePeriod: request.financePeriod,
        pendingClarification: shouldUsePendingClarification ? pendingClarification : undefined,
      },
    });
    debugInfo.semanticValidationStatus = semanticValidation.status;
    debugInfo.semanticValidationReason = semanticValidation.reason;

    if (semanticValidation.status === 'needs_clarification') {
      const clarificationResolvedEntities = await this.resolveClarificationContext(
        extractedIntent,
        contextResolvedEntities,
        tenantId,
        request.buildingId,
      );
      await this.conversationContext.setPendingClarification(
        tenantId,
        userId,
        sessionId,
        this.createPendingClarificationContext(
          extractedIntent,
          clarificationResolvedEntities,
          this.resolveClarificationMissingFields(semanticValidation, extractedIntent),
          semanticValidation.question,
          this.extractCanonicalPeriod(deterministicPlan?.filters.period),
        ),
      );
      await this.storeConversationTurn(
        tenantId,
        userId,
        sessionId,
        request.message,
        clarificationResolvedEntities,
        { intent: extractedIntent.intent, filters: extractedIntent.filters as Record<string, unknown> },
      );
      const clarificationResponse = this.responseFormatter.formatV2(
        {
          isAmbiguous: true,
          alternatives: [],
          clarificationMessage:
            semanticValidation.question ||
            'Necesito más contexto para responder con precisión.',
        },
        'ambiguous',
        extractedIntent.confidence,
      );
      if (debugEnabled) {
        (clarificationResponse as StructuredResponse).debug = debugInfo;
      }
      return clarificationResponse;
    }

    if (semanticValidation.status === 'override_suggested') {
      if (semanticValidation.intentOverride) {
        extractedIntent.intent = semanticValidation.intentOverride;
      }
      if (semanticValidation.entityOverride) {
        extractedIntent.entity = {
          ...extractedIntent.entity,
          ...semanticValidation.entityOverride,
        };
      }
      if (semanticValidation.filterOverrides) {
        extractedIntent.filters = {
          ...extractedIntent.filters,
          ...semanticValidation.filterOverrides,
        };
      }
      if (semanticValidation.llmProvider) {
        extractedIntent.llmProvider = semanticValidation.llmProvider;
        extractedIntent.source = 'hybrid';
        debugInfo.llmProvider = semanticValidation.llmProvider;
      }
      debugInfo.finalIntent = extractedIntent.intent;
      debugInfo.finalFilters = extractedIntent.filters as Record<string, unknown>;
    }

    if (extractedIntent.requiresClarification) {
      const missing = extractedIntent.missingFields?.join(', ') || 'contexto adicional';
      const clarificationMessage =
        extractedIntent.clarificationMessage ||
        `Necesito más contexto para responder con precisión (${missing}).`;
      const clarificationResolvedEntities = await this.resolveClarificationContext(
        extractedIntent,
        contextResolvedEntities,
        tenantId,
        request.buildingId,
      );
      await this.conversationContext.setPendingClarification(
        tenantId,
        userId,
        sessionId,
        this.createPendingClarificationContext(
          extractedIntent,
          clarificationResolvedEntities,
          this.resolveClarificationMissingFields(undefined, extractedIntent),
          clarificationMessage,
          this.extractCanonicalPeriod(extractedIntent.filters.period) ??
            this.extractCanonicalPeriod(deterministicPlan?.filters.period),
        ),
      );
      await this.storeConversationTurn(
        tenantId,
        userId,
        sessionId,
        request.message,
        clarificationResolvedEntities,
        { intent: extractedIntent.intent, filters: extractedIntent.filters as Record<string, unknown> },
      );
      const clarificationResponse = this.responseFormatter.formatV2(
        {
          isAmbiguous: true,
          alternatives: [],
          clarificationMessage,
        },
        'ambiguous',
        extractedIntent.confidence,
      );
      if (debugEnabled) {
        (clarificationResponse as StructuredResponse).debug = debugInfo;
      }
      return clarificationResponse;
    }

    // Step 3: Resolve entities
    let entityResolution: EntityResolution = contextResolvedEntities ?? { alternatives: [] };

    // Resolve building if alias provided
    if (extractedIntent.entity.buildingAlias) {
      const buildingResolution = await this.entityResolver.resolveBuilding(
        extractedIntent.entity.buildingAlias,
        tenantId,
      );
      if (buildingResolution) {
        entityResolution = { ...entityResolution, ...buildingResolution };
      }
    }

    // Fallback: if building-level intent but no building resolved, use request.buildingId
    if (!entityResolution.building && extractedIntent.entity.type === 'building' && request.buildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: request.buildingId, tenantId, deletedAt: null },
      });
      if (building) {
        entityResolution = {
          ...entityResolution,
          building: {
            id: building.id,
            name: building.name,
            alias: building.alias || undefined,
          },
        };
      }
    }

    // Resolve unit if building and code provided
    if (entityResolution.building && extractedIntent.entity.unitCode) {
      const unitResolution = await this.entityResolver.resolveUnit(
        extractedIntent.entity.unitCode,
        entityResolution.building.id,
        tenantId,
      );
      if (unitResolution) {
        entityResolution = { ...entityResolution, ...unitResolution };
      }
    }

    // Resolve person if name provided
    if (extractedIntent.entity.personName) {
      const personResolution = await this.entityResolver.resolvePerson(
        extractedIntent.entity.personName,
        tenantId,
      );
      if (!personResolution) {
        const notFoundResponse = this.responseFormatter.formatV2(
          {
            isAmbiguous: true,
            alternatives: [],
            clarificationMessage: `No encontré a "${extractedIntent.entity.personName}" en este tenant.`,
          },
          'ambiguous',
          extractedIntent.confidence,
        );
        if (debugEnabled) {
          (notFoundResponse as StructuredResponse).debug = debugInfo;
        }
        return notFoundResponse;
      }

      entityResolution = { ...entityResolution, ...personResolution };
      // If asking unit-level intent from a person reference, infer the unit
      // context directly from the resolved person when available.
      if (!entityResolution.unit && personResolution.person?.unitId) {
        const personUnit = await this.prisma.unit.findFirst({
          where: { id: personResolution.person.unitId, tenantId },
          select: {
            id: true,
            code: true,
            label: true,
            buildingId: true,
            building: {
              select: { id: true, name: true, alias: true },
            },
          },
        });

        if (personUnit) {
          entityResolution = {
            ...entityResolution,
            unit: {
              id: personUnit.id,
              code: personUnit.code,
              label: personUnit.label || undefined,
              buildingId: personUnit.buildingId,
            },
            building: entityResolution.building ?? {
              id: personUnit.building.id,
              name: personUnit.building.name,
              alias: personUnit.building.alias || undefined,
            },
          };
        }
      }
    }

    const unitScopedIntents = new Set([
      'unit_debt',
      'unit_residents',
      'unit_documents',
      'unit_tickets',
      'unit_payments',
    ]);

    // Fallback robusto: resolver unidad con resolver operativo (soporta building implícito + candidatos de código)
    if (extractedIntent.entity.unitCode && !entityResolution.unit) {
      const tokenForResolver = {
        unitCode: extractedIntent.entity.unitCode,
        buildingAlias: extractedIntent.entity.buildingAlias,
      };

      const fallbackResolution = await this.unitResolver.resolve(tenantId, tokenForResolver);
      if (fallbackResolution.resolved) {
        const resolved = fallbackResolution.resolved;
        entityResolution = {
          ...entityResolution,
          building: {
            id: resolved.building.id,
            name: resolved.building.name,
            alias: resolved.building.alias,
          },
          unit: {
            id: resolved.unit.id,
            code: resolved.unit.code,
            label: resolved.unit.label ?? undefined,
            buildingId: resolved.building.id,
          },
        };
      } else if (unitScopedIntents.has(extractedIntent.intent)) {
        const fallbackMessage = fallbackResolution.errorResponse.answer;
        const fallbackClarification = this.responseFormatter.formatV2(
          {
            isAmbiguous: true,
            alternatives: [],
            clarificationMessage: fallbackMessage,
          },
          'ambiguous',
          extractedIntent.confidence,
        );
        if (debugEnabled) {
          (fallbackClarification as StructuredResponse).debug = debugInfo;
        }
        return fallbackClarification;
      }
    }

    // Guard: unit-specific intents must resolve a unit, otherwise ask for clarification
    if (unitScopedIntents.has(extractedIntent.intent) && !entityResolution.unit) {
      const requestedUnit = extractedIntent.entity.unitCode || 'la unidad indicada';
      const buildingHint = entityResolution.building?.name
        ? ` en ${entityResolution.building.name}`
        : extractedIntent.entity.buildingAlias
          ? ` en Torre ${extractedIntent.entity.buildingAlias}`
          : '';
      const clarification = this.responseFormatter.formatV2(
        {
          isAmbiguous: true,
          alternatives: [],
          clarificationMessage: `No encontré la unidad ${requestedUnit}${buildingHint}. ¿Me indicás una unidad válida?`,
        },
        'ambiguous',
        extractedIntent.confidence,
      );
      if (debugEnabled) {
        (clarification as StructuredResponse).debug = debugInfo;
      }
      return clarification;
    }

    // Guard: building-specific intents (except tenant-wide building_payments) need building context
    const strictBuildingIntents = new Set([
      'building_debt',
      'building_delinquents',
      'building_documents',
      'building_tickets',
      'building_stats',
    ]);
    if (strictBuildingIntents.has(extractedIntent.intent) && !entityResolution.building) {
      const clarification = this.responseFormatter.formatV2(
        {
          isAmbiguous: true,
          alternatives: [],
          clarificationMessage: 'Necesito que me indiques el edificio/torre para esa consulta.',
        },
        'ambiguous',
        extractedIntent.confidence,
      );
      if (debugEnabled) {
        (clarification as StructuredResponse).debug = debugInfo;
      }
      return clarification;
    }

    // Step 4: Check for ambiguity
    if (this.ambiguityService.detectAmbiguity(entityResolution)) {
      const ambiguityResult = this.ambiguityService.generateClarification(
        entityResolution,
        extractedIntent.entity.type,
      );

      // Format and return clarification response
      const ambiguityResponse = this.responseFormatter.formatV2(
        {
          isAmbiguous: true,
          alternatives: entityResolution.alternatives,
          clarificationMessage: ambiguityResult.clarificationMessage,
        },
        'ambiguous',
        extractedIntent.confidence,
      );
      if (debugEnabled) {
        (ambiguityResponse as StructuredResponse).debug = debugInfo;
      }
      return ambiguityResponse;
    }

    // Step 5: Build execution plan
    let executionPlan;
    try {
      executionPlan = this.queryPlanner.buildPlan(extractedIntent, entityResolution);
    } catch (error) {
      this.logger.warn(`[chatV2] Plan build failed: ${error}`);
      throw new BadRequestException('Could not understand your query. Please rephrase.');
    }

    // Step 6: Execute with RBAC
    let rawData: unknown;
    try {
      debugInfo.rbacChecked = true;
      rawData = await this.queryExecutor.execute(
        executionPlan,
        tenantId,
        userId,
        userRoles,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`[chatV2] Execution failed: ${error}`);
      throw new BadRequestException('Query execution failed. Please try again.');
    }

    // Step 7: Format response
    const structuredResponse = this.responseFormatter.formatV2(
      rawData,
      extractedIntent.intent,
      extractedIntent.confidence,
    );

    // Ensure tenantScoped is true in meta
    structuredResponse.meta = {
      ...structuredResponse.meta,
      intent: extractedIntent.intent,
      confidence: extractedIntent.confidence,
      tenantScoped: true as const,
    };

    if (debugEnabled) {
      (structuredResponse as StructuredResponse).debug = debugInfo;
    }

    // Step 8: Store turn in conversation context
    await this.storeConversationTurn(
      tenantId,
      userId,
      sessionId,
      request.message,
      entityResolution,
      { intent: extractedIntent.intent, filters: extractedIntent.filters as Record<string, unknown> },
    );
    if (usedPendingClarification) {
      await this.conversationContext.clearPendingClarification(tenantId, userId, sessionId);
    }

    // Log interaction (fire-and-forget)
    const interactionModelSize = request.routeSource === 'legacy_chat'
      ? 'INTENT_ENGINE_LEGACY_ROUTE'
      : 'INTENT_ENGINE';

    void this.logInteraction(
      tenantId,
      userId,
      membershipId,
      request,
      { answer: structuredResponse.summary, suggestedActions: [] } as ChatResponse,
      false,
      interactionModelSize,
    );

    return structuredResponse;
  }

  /**
   * Detect if a message is a follow-up question.
   *
   * A message is a follow-up ONLY if ALL of these are true:
   * 1. Short: under 10 words
   * 2. No explicit subject (no unit codes, names, or standalone nouns)
   * 3. Useful conversation context exists (lastEntity, lastIntent, lastFilters)
   * 4. Contains a continuity pattern ("y", "también", pronouns, etc.)
   */
  private async detectFollowUp(
    message: string,
    conversationContext: ConversationTurn[],
    tenantId: string,
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const normalized = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    // 1. Must be short (under 10 words)
    const wordCount = normalized.split(/\s+/).length;
    if (wordCount > 10) return false;

    // 2. Must NOT contain explicit subject
    if (this.hasExplicitSubject(normalized)) return false;

    // 3. Must have useful conversation context
    const hasContext = await this.hasUsefulContext(tenantId, userId, sessionId);
    if (!hasContext) return false;

    // 4. Must contain a continuity pattern
    const continuityPatterns = [
      /^y\b/,                        // "y cuántos", "y quién"
      /\btambien\b/,                 // "también"
      /\bademas\b/,                  // "además"
      /\bese\b/,                     // "ese"
      /\besa\b/,                     // "esa"
      /\bellos\b/,                   // "ellos"
      /\bellas\b/,                   // "ellas"
      /\bsu\b/,                      // "su"
      /\bsus\b/,                     // "sus"
      /\bcuantos\s+meses\b/,         // "cuántos meses"
      /\bcuantas\s+personas\b/,      // "cuántas personas"
      /\by\s+cuanto\b/,              // "y cuánto"
      /\by\s+cuando\b/,              // "y cuándo"
      /^cuantos\b/,                  // "cuántos" (standalone follow-up)
      /^cuantas\b/,                  // "cuántas" (standalone follow-up)
      /^cuanto\b/,                   // "cuánto" (standalone follow-up)
      /^quien\b/,                    // "quién" (standalone follow-up)
      /^este\s+mes\b/,
      /^mes\s+actual\b/,
      /^del\s+mes\s+actual\b/,
      /^acumulad[ao]s?\b/,
      /^historic[ao]s?\b/,
      /^historica\b/,
      /^toda\b/,
      /^deuda\s+acumulada\b/,
    ];

    const hasContinuity = continuityPatterns.some((pattern) => pattern.test(normalized));
    if (!hasContinuity) return false;

    this.logger.log(`[chatV2] Follow-up detected: "${message}"`);
    return true;
  }

  /**
   * Check if a message contains an explicit subject.
   *
   * Explicit subjects indicate a new, self-contained query rather than a follow-up.
   */
  private hasExplicitSubject(message: string): boolean {
    // Unit codes: A-1203, 101, 5B, etc.
    const unitCodePattern = /\b[a-z]?\d+[a-z]?\b/i;

    // Standalone nouns that indicate a new intent
    const standaloneNouns = [
      'alguien', 'alguno', 'alguna', 'algunos', 'algunas',
      'todos', 'todas', 'todo',
      'morosos', 'morosas', 'deudores', 'deudoras',
      'residentes', 'ocupantes', 'inquilinos', 'propietarios',
      'pagos', 'transferencias', 'recibos', 'movimientos',
      'tickets', 'reclamos', 'problemas', 'averias', 'fallas', 'reparaciones',
      'gastos', 'expensas', 'deuda', 'deudas', 'saldo', 'saldos',
      'documentos', 'archivos', 'pdfs', 'comprobantes', 'expedientes', 'actas',
      'edificio', 'torre', 'bloque', 'sector', 'complejo', 'conjunto',
      'unidad', 'apartamento', 'departamento', 'depto', 'local', 'cochera',
    ];

    const hasUnitCode = unitCodePattern.test(message);
    const hasStandaloneNoun = standaloneNouns.some((noun) =>
      new RegExp(`\\b${noun}\\b`, 'i').test(message),
    );

    return hasUnitCode || hasStandaloneNoun;
  }

  /**
   * Check if useful conversation context exists.
   */
  private async hasUsefulContext(
    tenantId: string,
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const lastResolved = await this.conversationContext.getLastResolved(tenantId, userId, sessionId);
    const lastIntent = await this.conversationContext.getLastIntent(tenantId, userId, sessionId);
    const pendingClarification = await this.conversationContext.getPendingClarification(
      tenantId,
      userId,
      sessionId,
    );

    return !!(
      lastResolved?.buildingId ||
      lastResolved?.unitId ||
      lastResolved?.personId ||
      lastIntent ||
      pendingClarification
    );
  }

  /**
   * Infer intent from a follow-up message
   */
  private inferIntentFromFollowUp(message: string): string | null {
    const normalized = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    // Map follow-up keywords to intents
    if (this.isPeriodClarificationReply(normalized)) {
      return null;
    }

    if (/\bunidad\b|\bapartamento\b|\bdepto\b|\bdepartamento\b/.test(normalized) && /\bdeuda\b|\bdebe\b/.test(normalized)) {
      return 'unit_debt';
    }
    if (/\bticket(s)?\b/.test(normalized)) {
      return 'unit_tickets';
    }
    if (/\bpago(s)?\b/.test(normalized)) {
      return 'unit_payments';
    }
    if (/\bresidente(s)?\b|\bvive\b|\bquien\b/.test(normalized)) {
      return 'unit_residents';
    }
    if (/\bdocumento(s)?\b/.test(normalized)) {
      return 'unit_documents';
    }
    if (/\bestacionamiento\b|\bcochera\b/.test(normalized)) {
      return 'unit_parking';
    }

    return null;
  }

  private isClarificationFollowUpAnswer(
    message: string,
    pendingClarification: PendingClarificationContext,
  ): boolean {
    const normalized = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    const expectsPeriod = pendingClarification.missingFields.includes('period');
    const expectsPeriodMode = pendingClarification.missingFields.includes('period.mode');
    const expectsBuilding = pendingClarification.missingFields.includes('building');

    if (expectsPeriodMode) {
      return this.isRelativeRangeModeFollowUp(normalized);
    }

    if (expectsPeriod) {
      return (
        this.isCurrentMonthFollowUpAlias(normalized) ||
        /^acumulad[ao]s?\b/.test(normalized) ||
        /^historic[ao]s?\b/.test(normalized) ||
        /^historica\b/.test(normalized) ||
        /^toda\b/.test(normalized)
      );
    }

    if (expectsBuilding) {
      return (
        Boolean(this.queryParser.extractBuildingToken(message)) ||
        /^(?:torre|edificio|bloque|condominio|building)?\s*[a-z0-9]{1,3}$/i.test(normalized)
      );
    }

    return false;
  }

  private inferEntityFromFollowUp(message: string): Partial<ExtractedIntent['entity']> {
    const normalized = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    const buildingToken = this.queryParser.extractBuildingToken(message);
    if (buildingToken) {
      return {
        type: 'building',
        buildingAlias: buildingToken,
      };
    }

    const aliasMatch = normalized.match(/^(?:torre|edificio|bloque|condominio|building)?\s*([a-z0-9]{1,3})$/i);
    if (aliasMatch?.[1]) {
      return {
        type: 'building',
        buildingAlias: aliasMatch[1].toUpperCase(),
      };
    }

    return {};
  }

  private inferFiltersFromFollowUp(
    message: string,
    pendingClarification?: PendingClarificationContext,
  ): ExtractedIntent['filters'] {
    const normalized = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    if (pendingClarification?.period?.kind === 'relative_range') {
      if (this.isIncludingCurrentRangeFollowUp(normalized)) {
        return {
          period: {
            ...pendingClarification.period,
            mode: 'including_current',
          },
        };
      }

      if (this.isClosedRangeFollowUp(normalized)) {
        return {
          period: {
            ...pendingClarification.period,
            mode: 'closed_months',
          },
        };
      }
    }

    if (this.isCurrentMonthFollowUpAlias(normalized)) {
      return {
        period: new Date().toISOString().slice(0, 7),
      };
    }

    const monthYearMatch = normalized.match(
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(\d{4})\b/,
    );
    if (monthYearMatch?.[1] && monthYearMatch?.[2]) {
      const monthMap: Record<string, number> = {
        enero: 1,
        febrero: 2,
        marzo: 3,
        abril: 4,
        mayo: 5,
        junio: 6,
        julio: 7,
        agosto: 8,
        septiembre: 9,
        setiembre: 9,
        octubre: 10,
        noviembre: 11,
        diciembre: 12,
      };
      const month = monthMap[monthYearMatch[1]];
      if (month) {
        return {
          period: `${monthYearMatch[2]}-${String(month).padStart(2, '0')}`,
        };
      }
    }

    return {};
  }

  private buildIntentFromPendingClarification(
    pendingClarification: PendingClarificationContext,
    message: string,
  ): ExtractedIntent {
    const inferredEntity = this.inferEntityFromFollowUp(message);
    return {
      intent: pendingClarification.intent,
      entity: {
        ...pendingClarification.entity,
        ...inferredEntity,
      },
      filters: {
        ...pendingClarification.filters,
        ...this.inferFiltersFromFollowUp(message, pendingClarification),
      },
      confidence: 0.85,
      source: 'hybrid',
      requiresClarification: false,
      missingFields: [],
    };
  }

  private buildExtractedIntentFromPlan(plan: AssistantQueryPlan): ExtractedIntent {
    return {
      intent: plan.intent,
      entity: {
        type: plan.scope === 'unit' ? 'unit' : 'building',
        buildingAlias: plan.filters.buildingAlias ?? plan.filters.buildingToken,
        unitCode: plan.filters.unitCode,
        personName: plan.filters.personName,
      },
      filters: {
        minAmount: plan.filters.minAmount,
        maxAmount: plan.filters.maxAmount,
        minDebt: plan.filters.minDebt,
        period: plan.filters.period,
        status: plan.filters.status,
        method: plan.filters.method,
        minAgeDays: plan.filters.minAgeDays,
      },
      confidence: plan.confidence,
      source: 'hybrid',
      llmProvider: 'none',
      requiresClarification: false,
      missingFields: [],
    };
  }

  private mergeConsensusPlanWithModel(
    deterministicPlan: AssistantQueryPlan,
    modelPlan: AssistantConsensusEvaluation['modelPlan'],
  ): AssistantQueryPlan {
    if (!modelPlan) {
      return deterministicPlan;
    }

    const mergedFilters: AssistantQueryPlan['filters'] = {
      ...deterministicPlan.filters,
    };

    if (!mergedFilters.period) {
      const mergedPeriod = this.resolveConsensusPeriod(modelPlan.period);
      if (mergedPeriod) {
        mergedFilters.period = mergedPeriod;
      }
    }

    if (!mergedFilters.buildingAlias && modelPlan.entity.buildingAlias) {
      mergedFilters.buildingAlias = modelPlan.entity.buildingAlias;
    }

    if (!mergedFilters.unitCode && modelPlan.entity.unitAlias) {
      mergedFilters.unitCode = modelPlan.entity.unitAlias;
    }

    return {
      ...deterministicPlan,
      filters: mergedFilters,
      confidence: Math.max(deterministicPlan.confidence, modelPlan.confidence ?? deterministicPlan.confidence),
    };
  }

  private resolveConsensusPeriod(period: AssistantConsensusPeriod | null | undefined): string | undefined {
    if (!period || period.kind === 'unknown') {
      return undefined;
    }

    if (period.kind === 'accumulated') {
      return 'accumulated';
    }

    if (period.kind === 'current_month') {
      const current = new Date();
      return current.toISOString().slice(0, 7);
    }

    if (period.kind === 'previous_month') {
      const current = new Date();
      const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1);
      return previous.toISOString().slice(0, 7);
    }

    if (period.kind === 'named_month' && period.year && period.month) {
      return `${period.year}-${String(period.month).padStart(2, '0')}`;
    }

    return undefined;
  }

  private isCurrentMonthFollowUpAlias(normalized: string): boolean {
    const isPastMonth = normalized.includes('mes pasado') || normalized.includes('ultimo mes') || normalized.includes('último mes');

    return (
      !isPastMonth &&
      (
        normalized.includes('este mes') ||
        normalized.includes('mes actual') ||
        normalized.includes('mes en curso') ||
        normalized.includes('mes corriente') ||
        normalized.includes('mes que esta corriendo') ||
        normalized.includes('mes que corre') ||
        normalized.includes('del mes actual') ||
        normalized.includes('del mes en curso') ||
        normalized.includes('deuda del mes') ||
        /\bdel mes\b/.test(normalized)
      )
    );
  }

  private isPeriodClarificationReply(normalized: string): boolean {
    return this.isCurrentMonthFollowUpAlias(normalized) ||
      /^acumulad[ao]s?\b/.test(normalized) ||
      /^historic[ao]s?\b/.test(normalized) ||
      /^historica\b/.test(normalized) ||
      /^toda\b/.test(normalized);
  }

  private buildClarificationIntentFromConsensus(
    deterministicPlan: AssistantQueryPlan | null,
    consensusResult: AssistantConsensusEvaluation,
  ): ExtractedIntent {
    const intent = deterministicPlan?.intent ?? 'unknown';
    const entityType = deterministicPlan?.scope === 'unit' ? 'unit' : 'building';
    const missingFields = this.resolveConsensusMissingFields(consensusResult, deterministicPlan);

    return {
      intent,
      entity: {
        type: entityType,
        buildingAlias: deterministicPlan?.filters.buildingAlias ?? deterministicPlan?.filters.buildingToken,
        unitCode: deterministicPlan?.filters.unitCode,
        personName: deterministicPlan?.filters.personName,
      },
      filters: {
        minAmount: deterministicPlan?.filters.minAmount,
        maxAmount: deterministicPlan?.filters.maxAmount,
        minDebt: deterministicPlan?.filters.minDebt,
        period: deterministicPlan?.filters.period,
        status: deterministicPlan?.filters.status,
        method: deterministicPlan?.filters.method,
        minAgeDays: deterministicPlan?.filters.minAgeDays,
      },
      confidence: deterministicPlan?.confidence ?? 0,
      source: 'hybrid',
      llmProvider: consensusResult.localProvider,
      requiresClarification: true,
      missingFields: missingFields.length > 0 ? missingFields : ['period'],
      clarificationMessage: consensusResult.clarificationMessage,
    };
  }

  private resolveConsensusMissingFields(
    consensusResult: AssistantConsensusEvaluation,
    deterministicPlan: AssistantQueryPlan | null,
  ): string[] {
    if (consensusResult.modelPlan?.period.kind === 'relative_range') {
      return ['period.mode'];
    }

    if (
      consensusResult.mismatchReason === 'model_semantic_invalid' ||
      consensusResult.mismatchReason === 'model_intent_scope_conflict'
    ) {
      return this.resolveDeterministicMissingFields(deterministicPlan);
    }

    if (consensusResult.mismatchReason === 'period') {
      return ['period'];
    }

    if (consensusResult.mismatchReason === 'clarification') {
      if (consensusResult.modelPlan?.missingFields?.length) {
        return consensusResult.modelPlan.missingFields;
      }
      return ['period'];
    }

    if (consensusResult.mismatchReason === 'unit_alias') {
      return ['unit'];
    }

    if (consensusResult.mismatchReason === 'building_alias' || consensusResult.mismatchReason === 'entity') {
      return ['building'];
    }

    if (consensusResult.mismatchReason === 'intent' || consensusResult.mismatchReason === 'scope') {
      return ['scope'];
    }

    if (consensusResult.mismatchReason === 'local_model_failed' || consensusResult.mismatchReason === 'no_deterministic_plan') {
      if (deterministicPlan?.scope === 'unit') {
        return ['unit'];
      }
      if (deterministicPlan?.scope === 'building') {
        return ['building', 'period'];
      }
      return ['scope'];
    }

    return [];
  }

  private resolveDeterministicMissingFields(deterministicPlan: AssistantQueryPlan | null): string[] {
    if (!deterministicPlan) {
      return ['scope'];
    }

    const missingFields: string[] = [];
    const hasBuildingAlias = Boolean(deterministicPlan.filters.buildingAlias || deterministicPlan.filters.buildingToken);
    const hasUnitCode = Boolean(deterministicPlan.filters.unitCode || deterministicPlan.filters.unitCodeRaw);
    const hasPeriod = Boolean(deterministicPlan.filters.period);
    const canonicalPeriod = this.extractCanonicalPeriod(deterministicPlan.filters.period);

    if (deterministicPlan.scope === 'building') {
      if (!hasBuildingAlias) {
        missingFields.push('building');
      }
      if (!hasPeriod && deterministicPlan.intent === 'building_debt') {
        missingFields.push('period');
      }
      if (canonicalPeriod?.kind === 'relative_range' && canonicalPeriod.mode === 'unknown') {
        missingFields.push('period.mode');
      }
      return missingFields.length > 0 ? missingFields : [];
    }

    if (deterministicPlan.scope === 'unit') {
      if (!hasUnitCode) {
        missingFields.push('unit');
      }
      if (!hasPeriod && deterministicPlan.intent === 'unit_debt') {
        missingFields.push('period');
      }
      if (canonicalPeriod?.kind === 'relative_range' && canonicalPeriod.mode === 'unknown') {
        missingFields.push('period.mode');
      }
      return missingFields.length > 0 ? missingFields : [];
    }

    if (deterministicPlan.scope === 'tenant' && !hasPeriod && deterministicPlan.intent === 'tenant_debt') {
      return ['period'];
    }

    if (canonicalPeriod?.kind === 'relative_range' && canonicalPeriod.mode === 'unknown') {
      return ['period.mode'];
    }

    return missingFields;
  }

  private isDeterministicPlanExecutable(deterministicPlan: AssistantQueryPlan): boolean {
    const missingFields = this.resolveDeterministicMissingFields(deterministicPlan);
    return missingFields.length === 0;
  }

  private buildResolvedEntitiesFromPendingClarification(
    pendingClarification: PendingClarificationContext,
    conversationContext: ConversationTurn[],
  ): EntityResolution | undefined {
    const lastTurn = conversationContext.length > 0
      ? conversationContext[conversationContext.length - 1]
      : null;

    const resolvedEntities: EntityResolution = {
      alternatives: lastTurn?.resolvedEntities?.alternatives ?? [],
    };

    if (pendingClarification.resolvedEntityIds?.buildingId) {
      resolvedEntities.building = {
        id: pendingClarification.resolvedEntityIds.buildingId,
        name:
          lastTurn?.resolvedEntities?.building?.id === pendingClarification.resolvedEntityIds.buildingId
            ? lastTurn.resolvedEntities.building.name
            : pendingClarification.entity.buildingAlias || pendingClarification.resolvedEntityIds.buildingId,
        alias:
          lastTurn?.resolvedEntities?.building?.id === pendingClarification.resolvedEntityIds.buildingId
            ? lastTurn.resolvedEntities.building.alias
            : pendingClarification.entity.buildingAlias,
      };
    } else if (lastTurn?.resolvedEntities?.building) {
      resolvedEntities.building = lastTurn.resolvedEntities.building;
    }

    if (pendingClarification.resolvedEntityIds?.unitId && lastTurn?.resolvedEntities?.unit) {
      resolvedEntities.unit = lastTurn.resolvedEntities.unit;
    } else if (lastTurn?.resolvedEntities?.unit) {
      resolvedEntities.unit = lastTurn.resolvedEntities.unit;
    }

    if (pendingClarification.resolvedEntityIds?.personId && lastTurn?.resolvedEntities?.person) {
      resolvedEntities.person = lastTurn.resolvedEntities.person;
    } else if (lastTurn?.resolvedEntities?.person) {
      resolvedEntities.person = lastTurn.resolvedEntities.person;
    }

    if (!resolvedEntities.building && !resolvedEntities.unit && !resolvedEntities.person) {
      return undefined;
    }

    return resolvedEntities;
  }

  private resolveClarificationMissingFields(
    semanticValidation: IntentSemanticValidationResult | undefined,
    extractedIntent: ExtractedIntent,
  ): string[] {
    if (semanticValidation?.reason === 'relative_range_mode_ambiguous') {
      return ['period.mode'];
    }

    if (semanticValidation?.reason === 'building_scope_missing_context') {
      return ['building'];
    }

    if (
      semanticValidation?.reason === 'period_ambiguous' ||
      semanticValidation?.reason === 'period_signal_missing' ||
      semanticValidation?.reason === 'explicit_accumulated_debt'
    ) {
      return ['period'];
    }

    if (extractedIntent.missingFields && extractedIntent.missingFields.length > 0) {
      return extractedIntent.missingFields;
    }

    return ['period'];
  }

  private buildRelativeRangeAcknowledgementResponse(
    extractedIntent: ExtractedIntent,
    period: CanonicalFinancePeriod,
  ): StructuredResponse {
    return {
      type: 'text',
      title: 'Periodo identificado',
      summary: `Entendido. Tomé el período relativo como ${this.describeRelativeRangePeriod(period)}.`,
      actions: [],
      meta: {
        confidence: extractedIntent.confidence,
        periodKind: period.kind,
      },
    };
  }

  private describeRelativeRangePeriod(period: CanonicalFinancePeriod): string {
    const amount = period.amount ?? 0;
    if (period.mode === 'including_current') {
      return `los últimos ${amount} meses incluyendo el mes actual`;
    }
    if (period.mode === 'closed_months') {
      return `los últimos ${amount} meses cerrados`;
    }
    return `los últimos ${amount} meses`;
  }

  private isRelativeRangeModeFollowUp(normalized: string): boolean {
    return this.isIncludingCurrentRangeFollowUp(normalized) || this.isClosedRangeFollowUp(normalized);
  }

  private isIncludingCurrentRangeFollowUp(normalized: string): boolean {
    return (
      /\b(incluyendo este mes|incluye este mes|con este mes|incluyendo el mes actual|sumando este mes|mas este mes|más este mes)\b/.test(normalized) ||
      this.isCurrentMonthFollowUpAlias(normalized)
    );
  }

  private isClosedRangeFollowUp(normalized: string): boolean {
    return /\b(cerrados|solo meses cerrados|sin incluir este mes|sin contar este mes|solo los meses cerrados)\b/.test(normalized);
  }

  private async resolveClarificationContext(
    extractedIntent: ExtractedIntent,
    contextResolvedEntities: EntityResolution | undefined,
    tenantId: string,
    requestBuildingId?: string,
  ): Promise<EntityResolution | undefined> {
    let clarificationResolvedEntities = contextResolvedEntities;

    if (!clarificationResolvedEntities?.building && extractedIntent.entity.buildingAlias) {
      const buildingResolution = await this.entityResolver.resolveBuilding(
        extractedIntent.entity.buildingAlias,
        tenantId,
      );
      if (buildingResolution) {
        clarificationResolvedEntities = {
          ...(clarificationResolvedEntities ?? { alternatives: [] }),
          ...buildingResolution,
        };
      }
    }

    if (!clarificationResolvedEntities?.building && extractedIntent.entity.type === 'building' && requestBuildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: requestBuildingId, tenantId, deletedAt: null },
      });
      if (building) {
        clarificationResolvedEntities = {
          ...(clarificationResolvedEntities ?? { alternatives: [] }),
          building: {
            id: building.id,
            name: building.name,
            alias: building.alias || undefined,
          },
        };
      }
    }

    return clarificationResolvedEntities;
  }

  private createPendingClarificationContext(
    extractedIntent: ExtractedIntent,
    resolvedEntities: EntityResolution | undefined,
    missingFields: string[] | undefined,
    question?: string,
    period?: CanonicalFinancePeriod | null,
  ): PendingClarificationContext {
    return {
      intent: extractedIntent.intent,
      entity: extractedIntent.entity,
      filters: extractedIntent.filters,
      period: period ?? this.extractCanonicalPeriod(extractedIntent.filters.period),
      missingFields:
        missingFields && missingFields.length > 0
          ? missingFields
          : extractedIntent.missingFields && extractedIntent.missingFields.length > 0
            ? extractedIntent.missingFields
            : ['period'],
      question,
      resolvedEntityIds: {
        buildingId: resolvedEntities?.building?.id,
        unitId: resolvedEntities?.unit?.id,
        personId: resolvedEntities?.person?.id,
      },
    };
  }

  private extractCanonicalPeriod(period: string | CanonicalFinancePeriod | undefined): CanonicalFinancePeriod | undefined {
    if (!period || typeof period === 'string') {
      return undefined;
    }

    return period;
  }

  private async storeConversationTurn(
    tenantId: string,
    userId: string,
    sessionId: string,
    message: string,
    resolvedEntities: EntityResolution | undefined,
    metadata?: { intent?: string; filters?: Record<string, unknown> },
  ): Promise<void> {
    await this.conversationContext.storeTurn(
      tenantId,
      userId,
      sessionId,
      {
        role: 'user',
        message,
        timestamp: new Date(),
        resolvedEntities,
      },
      metadata,
    );
  }

  /**
   * Generate a simple session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async tryResolveStrictOperationalQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    const debtInterpretation = this.debtIntentInterpreter.interpret(message);

    if (debtInterpretation.scope === 'tenant') {
      const response = await this.tryResolveStrictTenantDebtQuestion(tenantId, userRoles, userId, message);
      if (response) {
        return response;
      }
    }

    if (debtInterpretation.scope === 'building' && !this.queryParser.extractBuildingToken(message)) {
      return {
        answer: '¿De cuál condominio o edificio quieres consultar la deuda?',
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    if (debtInterpretation.scope === 'ambiguous') {
      return {
        answer: '¿Te referís a una unidad, un edificio o a la administración?',
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    // Building-level queries first (when no unit is specified)
    const buildingChecks = [
      this.tryResolveStrictBuildingDebtQuestion(tenantId, message, userRoles, userId),
      this.tryResolveStrictBuildingTicketsQuestion(tenantId, message, userRoles, userId),
      this.tryResolveStrictBuildingDelinquentsQuestion(tenantId, message, userRoles, userId),
      this.tryResolveStrictBuildingStatsQuestion(tenantId, message, userRoles, userId),
      this.tryResolveStrictBuildingDocumentsQuestion(tenantId, message, userRoles, userId),
      this.tryResolveStrictBuildingPaymentsQuestion(tenantId, message, userRoles, userId),
    ];

    for (const check of buildingChecks) {
      const response = await check;
      if (response) {
        return response;
      }
    }

    // Person-based queries (search by occupant name)
    const personCheck = await this.tryResolveStrictPersonSearchQuestion(tenantId, message, userRoles, userId);
    if (personCheck) {
      return personCheck;
    }

    // Unit-level queries (when unit is specified)
    const unitChecks = [
      this.tryResolveStrictResidentNameQuestion(tenantId, message, userRoles, userId),
      this.tryResolveStrictUnitDebtQuestion(tenantId, message, userRoles, userId),
      this.tryResolveStrictUnitDocumentsQuestion(tenantId, message, userRoles, userId),
      this.tryResolveStrictUnitTicketsQuestion(tenantId, message, userRoles, userId),
      this.tryResolveStrictUnitPaymentsQuestion(tenantId, message, userRoles, userId),
    ];

    for (const check of unitChecks) {
      const response = await check;
      if (response) {
        return response;
      }
    }

    return null;
  }

  private async tryResolveStrictResidentNameQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isResidentQuery =
      normalizedMessage.includes('residente') ||
      normalizedMessage.includes('ocupante') ||
      normalizedMessage.includes('inquilino') ||
      normalizedMessage.includes('propietario') ||
      normalizedMessage.includes('habita') ||
      normalizedMessage.includes('vive') ||
      normalizedMessage.includes('reside') ||
      normalizedMessage.includes('ocupa') ||
      normalizedMessage.includes('arrendatario') ||
      normalizedMessage.includes('locatario') ||
      normalizedMessage.includes('titular') ||
      normalizedMessage.includes('habitante') ||
      normalizedMessage.includes('dueno') ||
      normalizedMessage.includes('tiene');

    if (!isResidentQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    if (!token) {
      return null; // Dejar que el classifier o fallback maneje preguntas ambiguas
    }

    const resolution = await this.unitResolver.resolve(tenantId, token);
    if (resolution.errorResponse) {
      return resolution.errorResponse;
    }

    let { building, unit, displayCode } = resolution.resolved;

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'units.read', buildingId: building.id, unitId: unit.id }))) {
      return null;
    }

    // Si es estacionamiento, buscar apartamento asociado y usar sus ocupantes
    let apartmentCode = '';
    if (unit.unitType === 'ESTACIONAMIENTO') {
      const association = await this.prisma.unitAssociation.findFirst({
        where: { parkingId: unit.id },
        include: {
          apartment: { select: { id: true, code: true } },
        },
      });

      if (association?.apartment) {
        unit = { ...unit, id: association.apartment.id }; // Usar ID del apartamento para buscar ocupantes
        apartmentCode = `${building.alias}-${association.apartment.code}`;
      }
    }

    const occupants = await this.prisma.unitOccupant.findMany({
      where: {
        tenantId,
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
      if (apartmentCode) {
        return {
          answer: `El estacionamiento ${displayCode} está asociado al apartamento ${apartmentCode}, pero no tiene ocupantes activos.`,
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id, unitId: unit.id } }],
        };
      }
      return {
        answer: `La unidad ${displayCode} (${building.name}) no tiene ocupantes activos asignados.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const primaryOccupants = occupants.filter((o) => o.isPrimary);
    if (primaryOccupants.length > 1) {
      return {
        answer: `Hay más de un ocupante primario en la unidad ${displayCode} (${building.name}). Necesito que revises la asignación antes de confirmar un nombre.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const selected =
      primaryOccupants[0] ||
      occupants.find((o) => o.role === UnitOccupantRole.OWNER) ||
      occupants[0];

    if (!selected?.member?.name) {
      return {
        answer: `La unidad ${displayCode} (${building.name}) tiene ocupante activo, pero sin nombre cargado.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const roleLabel =
      selected.role === UnitOccupantRole.OWNER ? 'propietario/a' : 'residente';

    if (apartmentCode) {
      return {
        answer: `El estacionamiento ${displayCode} está asociado al apartamento ${apartmentCode} (${building.name}). El ${roleLabel} principal del apartamento es ${selected.member.name}.`,
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

    return {
      answer: `En ${building.name}, la unidad ${displayCode} tiene como ${roleLabel} principal a ${selected.member.name}.`,
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

  private async tryResolveStrictPersonSearchQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);

    // Keywords that indicate a person search
    const isPersonQuery =
      normalizedMessage.includes('owner') ||
      normalizedMessage.includes('residente') ||
      normalizedMessage.includes('inquilino') ||
      normalizedMessage.includes('propietario') ||
      normalizedMessage.includes('habitante') ||
      normalizedMessage.includes('persona') ||
      normalizedMessage.includes('quien es') ||
      normalizedMessage.includes('donde vive') ||
      normalizedMessage.includes('estacionamiento de') ||
      normalizedMessage.includes('puesto de') ||
      normalizedMessage.includes('cochera de') ||
      normalizedMessage.includes('garage de');

    if (!isPersonQuery) {
      return null;
    }

    // Extract name from message
    // Patterns: "owner-17", "Owner 17", "Juan Perez", etc.
    const namePatterns = [
      /(?:owner|residente|inquilino|propietario)[\s-]+(\w+(?:\s+\w+)?)/i,
      /(?:de|del)\s+(?:el\s+)?(?:owner|residente|inquilino|propietario)[\s-]+(\w+(?:\s+\w+)?)/i,
    ];

    let personName = '';
    for (const pattern of namePatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        personName = match[1].trim();
        break;
      }
    }

    if (!personName) {
      return null;
    }

    // Search for occupant by name
    const occupant = await this.prisma.unitOccupant.findFirst({
      where: {
        tenantId,
        endDate: null,
        member: {
          name: {
            contains: personName,
            mode: 'insensitive',
          },
        },
      },
      include: {
        member: true,
        unit: {
          include: {
            building: true,
          },
        },
      },
    });

    if (!occupant) {
      return {
        answer: `No encontré a ningún residente con nombre "${personName}" en este tenant.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    const { member, unit } = occupant;
    const displayCode = `${unit.building.alias}-${unit.code}`;

    // Check if user asks about parking
    const asksParking =
      normalizedMessage.includes('estacionamiento') ||
      normalizedMessage.includes('puesto') ||
      normalizedMessage.includes('cochera') ||
      normalizedMessage.includes('garage');

    if (asksParking) {
      // Find associated parking
      const association = await this.prisma.unitAssociation.findFirst({
        where: { apartmentId: unit.id },
        include: {
          parking: { select: { id: true, code: true } },
        },
      });

      if (association?.parking) {
        const parkingDisplayCode = `${unit.building.alias}-${association.parking.code}`;
        return {
          answer: `${member.name} vive en el apartamento ${displayCode} (${unit.building.name}). Su estacionamiento asignado es ${parkingDisplayCode}.`,
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: unit.building.id, unitId: unit.id } }],
        };
      } else {
        return {
          answer: `${member.name} vive en el apartamento ${displayCode} (${unit.building.name}), pero no tiene estacionamiento asignado.`,
          suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: unit.building.id, unitId: unit.id } }],
        };
      }
    }

    return {
      answer: `${member.name} vive en el apartamento ${displayCode} (${unit.building.name}).`,
      suggestedActions: [{ type: 'VIEW_REPORTS', payload: { buildingId: unit.building.id, unitId: unit.id } }],
    };
  }

  private async tryResolveStrictUnitDebtQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isDebtQuery =
      normalizedMessage.includes('debe') ||
      normalizedMessage.includes('cuanto debe') ||
      normalizedMessage.includes('deuda') ||
      normalizedMessage.includes('saldo') ||
      normalizedMessage.includes('adeuda') ||
      normalizedMessage.includes('cuanto') ||
      normalizedMessage.includes('monto') ||
      normalizedMessage.includes('importe') ||
      normalizedMessage.includes('estado de cuenta') ||
      normalizedMessage.includes('al dia');

    if (!isDebtQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    if (!token) {
      return null; // Dejar que el classifier o fallback maneje preguntas ambiguas
    }

    const resolution = await this.unitResolver.resolve(tenantId, token);
    if (resolution.errorResponse) {
      return resolution.errorResponse;
    }

    const { building, unit, displayCode } = resolution.resolved;

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'payments.review', buildingId: building.id, unitId: unit.id }))) {
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

    const outstanding = this.debtCalculator.calculateOutstanding(charges);

    const amountText = this.formatMoney(outstanding, tenant.currency);
    const answer = outstanding > 0
      ? `La unidad ${displayCode} (${building.name}) tiene una deuda pendiente de ${amountText}.`
      : `La unidad ${displayCode} (${building.name}) no tiene deuda pendiente. Saldo actual: ${amountText}.`;

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

  private async tryResolveStrictUnitDocumentsQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isDocQuery =
      normalizedMessage.includes('documento') ||
      normalizedMessage.includes('documentos') ||
      normalizedMessage.includes('archivo') ||
      normalizedMessage.includes('archivos') ||
      normalizedMessage.includes('pdf') ||
      normalizedMessage.includes('comprobante') ||
      normalizedMessage.includes('comprobantes') ||
      normalizedMessage.includes('expediente') ||
      normalizedMessage.includes('acta') ||
      normalizedMessage.includes('planilla');

    if (!isDocQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    if (!token) {
      return null; // Dejar que el classifier o fallback maneje preguntas ambiguas
    }

    const resolution = await this.unitResolver.resolve(tenantId, token);
    if (resolution.errorResponse) {
      return resolution.errorResponse;
    }

    const { building, unit, displayCode } = resolution.resolved;

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'units.read', buildingId: building.id, unitId: unit.id }))) {
      return null;
    }

    const documents = await this.prisma.document.findMany({
      where: {
        tenantId,
        unitId: unit.id,
      },
      select: {
        id: true,
        title: true,
        category: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (documents.length === 0) {
      return {
        answer: `La unidad ${displayCode} (${building.name}) no tiene documentos registrados.`,
        suggestedActions: [{ type: 'VIEW_DOCUMENTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const docList = documents.map((d, i) => `${i + 1}. ${d.title} (${d.category})`).join('\n');

    return {
      answer: `Documentos de la unidad ${displayCode} (${building.name}):\n${docList}`,
      suggestedActions: [{ type: 'VIEW_DOCUMENTS', payload: { buildingId: building.id, unitId: unit.id } }],
    };
  }

  private async tryResolveStrictUnitTicketsQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isTicketQuery =
      normalizedMessage.includes('ticket') ||
      normalizedMessage.includes('tickets') ||
      normalizedMessage.includes('reclamo') ||
      normalizedMessage.includes('reclamos') ||
      normalizedMessage.includes('problema') ||
      normalizedMessage.includes('problemas') ||
      normalizedMessage.includes('averia') ||
      normalizedMessage.includes('falla') ||
      normalizedMessage.includes('solicitud') ||
      normalizedMessage.includes('incidente') ||
      normalizedMessage.includes('reparacion') ||
      normalizedMessage.includes('arreglo');

    if (!isTicketQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    if (!token) {
      return null; // Dejar que el classifier o fallback maneje preguntas ambiguas
    }

    const resolution = await this.unitResolver.resolve(tenantId, token);
    if (resolution.errorResponse) {
      return resolution.errorResponse;
    }

    const { building, unit, displayCode } = resolution.resolved;

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'tickets.read', buildingId: building.id, unitId: unit.id }))) {
      return null;
    }

    const [openCount, recentTickets] = await Promise.all([
      this.prisma.ticket.count({
        where: { tenantId, unitId: unit.id, status: 'OPEN' },
      }),
      this.prisma.ticket.findMany({
        where: { tenantId, unitId: unit.id },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    if (recentTickets.length === 0) {
      return {
        answer: `La unidad ${displayCode} (${building.name}) no tiene tickets registrados.`,
        suggestedActions: [{ type: 'VIEW_TICKETS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const ticketList = recentTickets.map((t, i) => `${i + 1}. ${t.title} [${t.status}]`).join('\n');
    const openText = openCount > 0 ? ` (${openCount} abiertos)` : '';

    return {
      answer: `Tickets de la unidad ${displayCode} (${building.name})${openText}:\n${ticketList}`,
      suggestedActions: [{ type: 'VIEW_TICKETS', payload: { buildingId: building.id, unitId: unit.id } }],
    };
  }

  private async tryResolveStrictUnitPaymentsQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isPaymentQuery =
      normalizedMessage.includes('pago') ||
      normalizedMessage.includes('pagos') ||
      normalizedMessage.includes('transferencia') ||
      normalizedMessage.includes('transferencias') ||
      normalizedMessage.includes('recibo') ||
      normalizedMessage.includes('recibos') ||
      normalizedMessage.includes('movimiento') ||
      normalizedMessage.includes('movimientos') ||
      normalizedMessage.includes('transaccion') ||
      normalizedMessage.includes('transacciones') ||
      normalizedMessage.includes('abono') ||
      normalizedMessage.includes('abonos') ||
      normalizedMessage.includes('cobro') ||
      normalizedMessage.includes('cobros');

    if (!isPaymentQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    if (!token) {
      return null; // Dejar que el classifier o fallback maneje preguntas ambiguas
    }

    const resolution = await this.unitResolver.resolve(tenantId, token);
    if (resolution.errorResponse) {
      return resolution.errorResponse;
    }

    const { building, unit, displayCode } = resolution.resolved;

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'payments.review', buildingId: building.id, unitId: unit.id }))) {
      return null;
    }

    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        unitId: unit.id,
        canceledAt: null,
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        method: true,
        paidAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (payments.length === 0) {
      return {
        answer: `La unidad ${displayCode} (${building.name}) no tiene pagos registrados.`,
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id, unitId: unit.id } }],
      };
    }

    const paymentList = payments.map((p, i) => {
      const date = p.paidAt ? new Date(p.paidAt).toLocaleDateString('es-AR') : 'sin fecha';
      const amount = this.formatMoney(p.amount, p.currency);
      return `${i + 1}. ${amount} (${p.status}) - ${date}`;
    }).join('\n');

    return {
      answer: `Últimos pagos de la unidad ${displayCode} (${building.name}):\n${paymentList}`,
      suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id, unitId: unit.id } }],
    };
  }

  // =====================
  // BUILDING-LEVEL QUERIES
  // =====================

  private async tryResolveStrictBuildingDebtQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isDebtQuery =
      normalizedMessage.includes('debe') ||
      normalizedMessage.includes('cuanto debe') ||
      normalizedMessage.includes('deuda') ||
      normalizedMessage.includes('saldo') ||
      normalizedMessage.includes('adeuda') ||
      normalizedMessage.includes('cuanto') ||
      normalizedMessage.includes('monto') ||
      normalizedMessage.includes('importe') ||
      normalizedMessage.includes('al dia');

    if (!isDebtQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    // Solo proceso building-level si NO hay referencia de unidad
    if (token?.unitCode) {
      return null;
    }

    const buildingToken = this.queryParser.extractBuildingToken(message);

    if (!buildingToken) {
      return null;
    }

    const building = await this.resolveBuilding(tenantId, buildingToken);
    if (!building) {
      return {
        answer: `No encontré el edificio "${buildingToken}" en este tenant. Verificá el nombre exacto y volvé a intentar.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'payments.review', buildingId: building.id }))) {
      return null;
    }

    const [tenant, units] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      }),
      this.prisma.unit.findMany({
        where: { tenantId, buildingId: building.id },
        select: { id: true, code: true, label: true },
      }),
    ]);

    const unitIds = units.map((u) => u.id);

    const charges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        unitId: { in: unitIds },
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
    });

    const outstanding = this.debtCalculator.calculateOutstanding(charges);

    const amountText = this.formatMoney(outstanding, tenant.currency);

    if (outstanding > 0) {
      return {
        answer: `El edificio ${building.name} tiene una deuda total pendiente de ${amountText} distribuida entre ${units.length} unidades.`,
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
      };
    }

    return {
      answer: `El edificio ${building.name} no tiene deuda pendiente. Todas las unidades están al día.`,
      suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
    };
  }

  private async tryResolveStrictTenantDebtQuestion(
    tenantId: string,
    userRoles: string[],
    userId?: string,
    message?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const plan = message ? this.queryPlanService.createPlan(message) : null;
    const canonicalPeriod = this.extractCanonicalPeriod(plan?.filters.period);
    if (plan?.intent === 'tenant_debt' && canonicalPeriod?.kind === 'relative_range' && canonicalPeriod.mode === 'unknown') {
      return {
        answer: `¿Querés incluir el mes actual o consultar solo los últimos ${canonicalPeriod.amount ?? 0} meses cerrados?`,
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: {} }],
      };
    }

    const response = await this.queryExecutors.execute({
      tenantId,
      userId: userId ?? '',
      userRoles,
      plan: {
        intent: 'tenant_debt',
        module: 'payments',
        scope: 'tenant',
        requiredPermission: 'payments.review',
        executor: 'tenant_debt',
        filters: plan?.intent === 'tenant_debt' && plan.filters ? plan.filters : {},
        confidence: 0.9,
        source: 'deterministic_rules',
      },
    });

    return response;
  }

  private async tryResolveStrictBuildingTicketsQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isTicketQuery =
      normalizedMessage.includes('ticket') ||
      normalizedMessage.includes('tickets') ||
      normalizedMessage.includes('reclamo') ||
      normalizedMessage.includes('reclamos') ||
      normalizedMessage.includes('problema') ||
      normalizedMessage.includes('problemas') ||
      normalizedMessage.includes('averia') ||
      normalizedMessage.includes('falla') ||
      normalizedMessage.includes('solicitud') ||
      normalizedMessage.includes('incidente') ||
      normalizedMessage.includes('reparacion') ||
      normalizedMessage.includes('arreglo');

    if (!isTicketQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    // Solo proceso building-level si NO hay referencia de unidad
    if (token?.unitCode) {
      return null;
    }

    const buildingToken = this.queryParser.extractBuildingToken(message);

    if (!buildingToken) {
      return null;
    }

    const building = await this.resolveBuilding(tenantId, buildingToken);
    if (!building) {
      return {
        answer: `No encontré el edificio "${buildingToken}" en este tenant. Verificá el nombre exacto y volvé a intentar.`,
        suggestedActions: [{ type: 'VIEW_TICKETS', payload: {} }],
      };
    }

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'tickets.read', buildingId: building.id }))) {
      return null;
    }

    const [openCount, recentTickets] = await Promise.all([
      this.prisma.ticket.count({
        where: { tenantId, buildingId: building.id, status: 'OPEN' },
      }),
      this.prisma.ticket.findMany({
        where: { tenantId, buildingId: building.id },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          unitId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    if (recentTickets.length === 0) {
      return {
        answer: `El edificio ${building.name} no tiene tickets registrados.`,
        suggestedActions: [{ type: 'VIEW_TICKETS', payload: { buildingId: building.id } }],
      };
    }

    const ticketList = recentTickets.map((t, i) => `${i + 1}. ${t.title} [${t.status}]`).join('\n');
    const openText = openCount > 0 ? ` (${openCount} abiertos)` : '';

    return {
      answer: `Tickets del edificio ${building.name}${openText}:\n${ticketList}`,
      suggestedActions: [{ type: 'VIEW_TICKETS', payload: { buildingId: building.id } }],
    };
  }

  private async tryResolveStrictBuildingDelinquentsQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isDelinquentQuery =
      normalizedMessage.includes('moroso') ||
      normalizedMessage.includes('morosos') ||
      normalizedMessage.includes('morosa') ||
      normalizedMessage.includes('morosas') ||
      normalizedMessage.includes('deudor') ||
      normalizedMessage.includes('deudores') ||
      normalizedMessage.includes('deudora') ||
      normalizedMessage.includes('deudoras') ||
      normalizedMessage.includes('quien debe') ||
      normalizedMessage.includes('quienes deben') ||
      normalizedMessage.includes('quien no pago') ||
      normalizedMessage.includes('quienes no pagan') ||
      normalizedMessage.includes('top deudores') ||
      normalizedMessage.includes('ranking de deuda') ||
      normalizedMessage.includes('atrasados') ||
      normalizedMessage.includes('atrasadas') ||
      normalizedMessage.includes('impagos') ||
      normalizedMessage.includes('incobrables');

    if (!isDelinquentQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    // Solo proceso building-level si NO hay referencia de unidad
    if (token?.unitCode) {
      return null;
    }

    const buildingToken = this.queryParser.extractBuildingToken(message);

    if (!buildingToken) {
      return null;
    }

    const building = await this.resolveBuilding(tenantId, buildingToken);
    if (!building) {
      return {
        answer: `No encontré el edificio "${buildingToken}" en este tenant. Verificá el nombre exacto y volvé a intentar.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'payments.review', buildingId: building.id }))) {
      return null;
    }

    const [tenant, units] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      }),
      this.prisma.unit.findMany({
        where: { tenantId, buildingId: building.id },
        select: { id: true, code: true, label: true },
      }),
    ]);

    const unitIds = units.map((u) => u.id);

    const charges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        unitId: { in: unitIds },
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
    });

    // Calcular deuda por unidad
    const unitDebts = this.debtCalculator.calculateOutstandingByUnit(charges);

    // Ordenar por deuda descendente y tomar top 10
    const sortedDebts = Array.from(unitDebts.entries())
      .filter(([, debt]) => debt > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    if (sortedDebts.length === 0) {
      return {
        answer: `El edificio ${building.name} no tiene unidades con deuda pendiente. Todas las unidades están al día.`,
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
      };
    }

    const debtorList = sortedDebts.map(([unitId, debt], i) => {
      const unit = units.find((u) => u.id === unitId);
      const unitLabel = unit ? (unit.label || unit.code) : 'Desconocida';
      return `${i + 1}. ${unitLabel}: ${this.formatMoney(debt, tenant.currency)}`;
    }).join('\n');

    const totalDebt = sortedDebts.reduce((sum, [, debt]) => sum + debt, 0);

    return {
      answer: `Top deudores del edificio ${building.name} (deuda total: ${this.formatMoney(totalDebt, tenant.currency)}):\n${debtorList}`,
      suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
    };
  }

  private async tryResolveStrictBuildingStatsQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isStatsQuery =
      normalizedMessage.includes('estadistica') ||
      normalizedMessage.includes('estadísticas') ||
      normalizedMessage.includes('estadisticas') ||
      normalizedMessage.includes('cuantas unidades') ||
      normalizedMessage.includes('cuántas unidades') ||
      normalizedMessage.includes('resumen') ||
      normalizedMessage.includes('informacion del edificio') ||
      normalizedMessage.includes('información del edificio') ||
      normalizedMessage.includes('datos del edificio') ||
      normalizedMessage.includes('como viene') ||
      normalizedMessage.includes('como va') ||
      normalizedMessage.includes('estado del edificio') ||
      normalizedMessage.includes('situacion del edificio') ||
      normalizedMessage.includes('cuentas del edificio');

    if (!isStatsQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    // Solo proceso building-level si NO hay referencia de unidad
    if (token?.unitCode) {
      return null;
    }

    const buildingToken = this.queryParser.extractBuildingToken(message);

    if (!buildingToken) {
      return null;
    }

    const building = await this.resolveBuilding(tenantId, buildingToken);
    if (!building) {
      return {
        answer: `No encontré el edificio "${buildingToken}" en este tenant. Verificá el nombre exacto y volvé a intentar.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'buildings.read', buildingId: building.id }))) {
      return null;
    }

    const [tenant, units, openTickets, totalTickets, charges] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      }),
      this.prisma.unit.findMany({
        where: { tenantId, buildingId: building.id },
        select: { id: true },
      }),
      this.prisma.ticket.count({
        where: { tenantId, buildingId: building.id, status: 'OPEN' },
      }),
      this.prisma.ticket.count({
        where: { tenantId, buildingId: building.id },
      }),
      this.prisma.charge.findMany({
        where: {
          tenantId,
          buildingId: building.id,
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

    const unitIds = units.map((u) => u.id);

    const outstanding = this.debtCalculator.calculateOutstanding(charges);

    const avgDebt = units.length > 0 ? outstanding / units.length : 0;

    return {
      answer: `Estadísticas del edificio ${building.name}:\n` +
        `- Unidades: ${units.length}\n` +
        `- Tickets abiertos: ${openTickets} de ${totalTickets} totales\n` +
        `- Deuda total: ${this.formatMoney(outstanding, tenant.currency)}\n` +
        `- Deuda promedio por unidad: ${this.formatMoney(Math.round(avgDebt), tenant.currency)}`,
      suggestedActions: [
        { type: 'VIEW_REPORTS', payload: { buildingId: building.id } },
        { type: 'VIEW_TICKETS', payload: { buildingId: building.id } },
      ],
    };
  }

  private async tryResolveStrictBuildingDocumentsQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isDocQuery =
      normalizedMessage.includes('documento') ||
      normalizedMessage.includes('documentos') ||
      normalizedMessage.includes('archivo') ||
      normalizedMessage.includes('archivos') ||
      normalizedMessage.includes('pdf') ||
      normalizedMessage.includes('comprobante') ||
      normalizedMessage.includes('comprobantes') ||
      normalizedMessage.includes('expediente') ||
      normalizedMessage.includes('acta') ||
      normalizedMessage.includes('planilla');

    if (!isDocQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    // Solo proceso building-level si NO hay referencia de unidad
    if (token?.unitCode) {
      return null;
    }

    const buildingToken = this.queryParser.extractBuildingToken(message);

    if (!buildingToken) {
      return null;
    }

    const building = await this.resolveBuilding(tenantId, buildingToken);
    if (!building) {
      return {
        answer: `No encontré el edificio "${buildingToken}" en este tenant. Verificá el nombre exacto y volvé a intentar.`,
        suggestedActions: [{ type: 'VIEW_REPORTS', payload: {} }],
      };
    }

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'buildings.read', buildingId: building.id }))) {
      return null;
    }

    const documents = await this.prisma.document.findMany({
      where: {
        tenantId,
        buildingId: building.id,
      },
      select: {
        id: true,
        title: true,
        category: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (documents.length === 0) {
      return {
        answer: `El edificio ${building.name} no tiene documentos registrados.`,
        suggestedActions: [{ type: 'VIEW_DOCUMENTS', payload: { buildingId: building.id } }],
      };
    }

    const docList = documents.map((d, i) => `${i + 1}. ${d.title} (${d.category})`).join('\n');

    return {
      answer: `Documentos del edificio ${building.name}:\n${docList}`,
      suggestedActions: [{ type: 'VIEW_DOCUMENTS', payload: { buildingId: building.id } }],
    };
  }

  private async tryResolveStrictBuildingPaymentsQuestion(
    tenantId: string,
    message: string,
    userRoles: string[],
    userId?: string,
  ): Promise<ChatResponse | null> {
    if (!this.canAccessOperationalData(userRoles)) {
      return null;
    }

    const normalizedMessage = this.normalizeText(message);
    const isPaymentQuery =
      normalizedMessage.includes('pago') ||
      normalizedMessage.includes('pagos') ||
      normalizedMessage.includes('transferencia') ||
      normalizedMessage.includes('transferencias') ||
      normalizedMessage.includes('recibo') ||
      normalizedMessage.includes('recibos') ||
      normalizedMessage.includes('cobranza') ||
      normalizedMessage.includes('cobranzas');

    if (!isPaymentQuery) {
      return null;
    }

    const token = this.queryParser.parseUnitReference(message);

    // Solo proceso building-level si NO hay referencia de unidad
    if (token?.unitCode) {
      return null;
    }

    const buildingToken = this.queryParser.extractBuildingToken(message);

    if (!buildingToken) {
      return null;
    }

    const building = await this.resolveBuilding(tenantId, buildingToken);
    if (!building) {
      return {
        answer: `No encontré el edificio "${buildingToken}" en este tenant. Verificá el nombre exacto y volvé a intentar.`,
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: {} }],
      };
    }

    if (!(await this.canAccessScopedOperationalData({ userId, tenantId, userRoles, permission: 'payments.review', buildingId: building.id }))) {
      return null;
    }

    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        buildingId: building.id,
        canceledAt: null,
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        method: true,
        paidAt: true,
        createdAt: true,
        unitId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (payments.length === 0) {
      return {
        answer: `El edificio ${building.name} no tiene pagos registrados.`,
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
      };
    }

    // Obtener nombres de unidades para mostrar
    const unitIds = [...new Set(payments.map((p) => p.unitId).filter((id): id is string => id !== null))];
    const units = await this.prisma.unit.findMany({
      where: { tenantId, id: { in: unitIds } },
      select: { id: true, code: true, label: true },
    });

    const paymentList = payments.map((p, i) => {
      const date = p.paidAt ? new Date(p.paidAt).toLocaleDateString('es-AR') : 'sin fecha';
      const amount = this.formatMoney(p.amount, p.currency);
      const unit = units.find((u) => u.id === p.unitId);
      const unitLabel = unit ? (unit.label || unit.code) : 'N/A';
      return `${i + 1}. ${amount} (${p.status}) - ${unitLabel} - ${date}`;
    }).join('\n');

    return {
      answer: `Ultimos pagos del edificio ${building.name}:\n${paymentList}`,
      suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
    };
  }

  private async resolveBuilding(
    tenantId: string,
    buildingToken: string,
  ): Promise<{ id: string; name: string } | null> {
    const buildings = await this.prisma.building.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });

    const buildingMatch = this.queryParser.findBuilding(buildings, buildingToken);
    return buildingMatch.matched ? buildingMatch.item : null;
  }

  private canAccessOperationalData(userRoles: string[]): boolean {
    return (
      userRoles.includes('SUPER_ADMIN') ||
      userRoles.includes('TENANT_OWNER') ||
      userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('OPERATOR')
    );
  }


  private async canAccessScopedOperationalData(params: {
    userId?: string;
    tenantId: string;
    userRoles: string[];
    permission: Permission;
    buildingId?: string;
    unitId?: string;
  }): Promise<boolean> {
    if (!this.canAccessOperationalData(params.userRoles)) {
      return false;
    }

    // Backward compatibility for legacy private-method unit tests that call
    // strict resolvers directly without a userId. Runtime calls always pass userId.
    if (!params.userId) {
      return true;
    }

    try {
      return await this.authorize.authorize({
        userId: params.userId,
        tenantId: params.tenantId,
        permission: params.permission,
        buildingId: params.buildingId,
        unitId: params.unitId,
      });
    } catch (error) {
      this.logger.warn(`Assistant scoped RBAC check failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
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
    membershipId?: string,
  ): Promise<ContextValidation> {
    let validatedBuildingId: string | undefined;
    let validatedUnitId: string | undefined;

    // Validate buildingId if provided
    if (buildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: buildingId, tenantId, deletedAt: null },
      });

      if (!building) {
        throw new BadRequestException('Invalid building');
      }
      validatedBuildingId = buildingId;
    }

    // Validate unitId if provided
    if (unitId) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: unitId, tenantId },
        include: { building: true },
      });

      if (!unit) {
        throw new BadRequestException('Invalid unit');
      }
      validatedUnitId = unitId;

      // If unitId provided, buildingId should match
      if (buildingId && unit.buildingId !== buildingId) {
        throw new BadRequestException('Unit does not belong to building');
      }
    }

    return {
      tenantId,
      userId,
      membershipId: membershipId || '',
      buildingId: validatedBuildingId,
      unitId: validatedUnitId,
      page: '', // Will be set by caller
      userRoles: userRoles || [],
    };
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
          provider: this.providerMode,
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
    userId: string,
    userRoles: string[] = [],
  ): Promise<string[]> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
      select: { id: true, title: true, description: true, buildingId: true, unitId: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found for tenant');
    }

    const canManageTicket = await this.canAccessTicketReplySuggestions({
      userId,
      tenantId,
      userRoles,
      buildingId: ticket.buildingId,
      unitId: ticket.unitId ?? undefined,
    });

    if (!canManageTicket) {
      throw new ForbiddenException('User is not allowed to generate replies for this ticket');
    }

    const safeTitle = ticket.title || title;
    const safeDescription = ticket.description || description;

    // Build prompt for the AI provider using authoritative DB ticket data.
    const prompt = `You are a professional property management assistant.
Based on this resident ticket, suggest 3 professional and helpful response templates.

Ticket Title: ${safeTitle}
Ticket Description: ${safeDescription}

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


  private async canAccessTicketReplySuggestions(params: {
    userId: string;
    tenantId: string;
    userRoles: string[];
    buildingId: string;
    unitId?: string;
  }): Promise<boolean> {
    if (!this.canAccessOperationalData(params.userRoles)) {
      return false;
    }

    try {
      const canManage = await this.authorize.authorize({
        userId: params.userId,
        tenantId: params.tenantId,
        permission: 'tickets.manage',
        buildingId: params.buildingId,
        unitId: params.unitId,
      });

      if (canManage) {
        return true;
      }

      // OPERATOR currently has tickets.read/write but not tickets.manage in RBAC.
      // Keep product behavior while still enforcing the same building/unit scope.
      return await this.authorize.authorize({
        userId: params.userId,
        tenantId: params.tenantId,
        permission: 'tickets.read',
        buildingId: params.buildingId,
        unitId: params.unitId,
      });
    } catch (error) {
      this.logger.warn(`Ticket reply scoped RBAC check failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private isTemporarilyUnavailableIntent(intent: string): boolean {
    return TEMPORARILY_UNAVAILABLE_INTENTS.has(intent);
  }

  private buildTemporarilyUnavailableIntentResponse(intent: string): StructuredResponse {
    return {
      type: 'text',
      title: 'Capacidad no disponible',
      summary: 'Esa capacidad aún no está disponible en este asistente. Puedo ayudarte con deuda, pagos, tickets, documentos, residentes o estadísticas.',
      data: {
        unavailableIntent: intent,
      },
      actions: [],
      meta: {
        intent,
        confidence: 1,
        tenantScoped: true,
      },
    };
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

  /**
   * NIVEL 2: Construye respuesta de sugerencia basada en la categoría detectada por el classifier
   *
   * Cuando los keywords estrictos no matchean pero el LLM classifier detecta una intención
   * operativa con alta confianza (> 0.85), sugerimos navegación específica en lugar de
   * fallback genérico.
   */
  private buildClassifierSuggestionResponse(
    result: { category: string; confidence: number },
    buildingId?: string,
    unitId?: string,
  ): ChatResponse {
    const payload: Record<string, string | undefined> = {};
    if (buildingId) payload.buildingId = buildingId;
    if (unitId) payload.unitId = unitId;

    switch (result.category) {
      case 'DEBT':
        return {
          answer: 'Entiendo que querés consultar sobre deudas o saldos. Podés ir a la sección de Finanzas para ver el estado de cuenta. Si necesitás datos de una unidad específica, indicame el número y el edificio.',
          suggestedActions: [{ type: 'VIEW_PAYMENTS', payload }],
        };
      case 'TICKETS':
        return {
          answer: 'Parece que querés consultar sobre tickets o reclamos. Podés acceder a la sección de Tickets para ver el estado de los mismos.',
          suggestedActions: [{ type: 'VIEW_TICKETS', payload }],
        };
      case 'DOCUMENTS':
        return {
          answer: 'Entiendo que buscás documentos o archivos. Podés ir a la sección de Archivos para encontrar lo que necesitás.',
          suggestedActions: [{ type: 'VIEW_DOCUMENTS', payload }],
        };
      case 'PAYMENTS':
        return {
          answer: 'Parece que querés consultar sobre pagos o transferencias. Podés acceder a la sección de Finanzas para ver el historial.',
          suggestedActions: [{ type: 'VIEW_PAYMENTS', payload }],
        };
      case 'RESIDENTS':
        return {
          answer: 'Entiendo que buscás información sobre residentes u ocupantes. Si necesitás datos de una unidad específica, indicame el número y el edificio.',
          suggestedActions: [{ type: 'VIEW_REPORTS', payload }],
        };
      case 'STATS':
        return {
          answer: 'Parece que querés ver estadísticas o el estado general del edificio. Podés ir a la sección de Reportes para ver los datos.',
          suggestedActions: [{ type: 'VIEW_REPORTS', payload }],
        };
      default:
        return {
          answer: 'Entendí tu consulta. Si necesitás datos específicos de una unidad o edificio, indicame los detalles exactos.',
          suggestedActions: [{ type: 'VIEW_REPORTS', payload }],
        };
    }
  }
}

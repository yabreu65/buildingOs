import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { AiBudgetService } from './budget.service';
import { AiRouterService } from './router.service';
import { AiCacheService } from './cache.service';
import { AiContextSummaryService } from './context-summary.service';

// Types
export type SuggestedActionType =
  | 'VIEW_TICKETS'
  | 'VIEW_PAYMENTS'
  | 'VIEW_REPORTS'
  | 'SEARCH_DOCS'
  | 'DRAFT_COMMUNICATION'
  | 'CREATE_TICKET';

export interface SuggestedAction {
  type: SuggestedActionType;
  payload: Record<string, any>;
}

export interface ChatResponse {
  answer: string;
  suggestedActions: SuggestedAction[];
  interactionId?: string; // PHASE 12: For frontend action event tracking
}

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

// Provider interface
interface AiProvider {
  chat(message: string, context: any, options?: { model?: string; maxTokens?: number }): Promise<ChatResponse>;
}

// MOCK Provider - always works, good for development
class MockProvider implements AiProvider {
  async chat(
    message: string,
    context: any,
    options?: { model?: string; maxTokens?: number }
  ): Promise<ChatResponse> {
    // Simulate thinking (less time for small model)
    const delayMs = options?.model === 'gpt-4.1-nano' ? 50 : 100;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const mockAnswers: Record<string, string> = {
      tickets: 'You have 3 open tickets. View them to manage maintenance requests.',
      payments:
        'Current balance is $1,250. Outstanding payments are due by end of month.',
      occupants:
        "You have 8 occupants assigned. Recent activity shows good compliance.",
      default: `I understand you're asking about "${message.substring(0, 50)}...". Let me help you find the right information.`,
    };

    let answer = mockAnswers.default;
    if (message.toLowerCase().includes('ticket'))
      answer = mockAnswers.tickets;
    else if (message.toLowerCase().includes('payment'))
      answer = mockAnswers.payments;
    else if (message.toLowerCase().includes('occupant'))
      answer = mockAnswers.occupants;

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
  private provider: AiProvider;
  private readonly dailyLimit: number;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private budget: AiBudgetService,
    private router: AiRouterService,
    private cache: AiCacheService,
    private contextSummary: AiContextSummaryService,
  ) {
    this.dailyLimit = parseInt(process.env.AI_DAILY_LIMIT_PER_TENANT || '100', 10);
    // Initialize provider based on env
    const providerName = process.env.AI_PROVIDER || 'MOCK';
    if (providerName === 'OPENAI') {
      // OPENAI provider will be implemented later
      // For now, fallback to MOCK
      this.provider = new MockProvider();
    } else {
      this.provider = new MockProvider();
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
    let contextSummary: any = null;
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
      console.error('Failed to enrich context:', error);
    }

    // Step 3: Check budget (and enforce hard stop or soft degrade)
    const budgetCheck = await this.budget.checkBudget(tenantId);
    let response: ChatResponse;

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
          contextSnapshot: contextSummary?.snapshot,
        },
        { model: 'gpt-4.1-nano', maxTokens: 150 } // Use small model for degraded
      );

      // Log degraded response
      void this.budget.logDegradedResponse(tenantId, 'Monthly budget exceeded');
    } else {
      // Budget OK - get response from provider with routed model
      response = await this.provider.chat(
        request.message,
        {
          buildingId: request.buildingId,
          unitId: request.unitId,
          page: request.page,
          tenantId,
          contextSnapshot: contextSummary?.snapshot,
        },
        { model: modelName, maxTokens }
      );

      // Track usage (fire-and-forget)
      void this.budget.trackUsage(tenantId, {
        model: modelName,
        inputTokens: 0, // MOCK provider doesn't return tokens yet
        outputTokens: 0,
      });
    }

    // Step 4: Cache the response for future similar requests
    this.cache.set(cacheKey, response, modelName);

    // Filter suggested actions based on RBAC
    response.suggestedActions = this.filterSuggestedActions(
      response.suggestedActions,
      userRoles,
      context,
    );

    // Store interaction log (fire-and-forget)
    // Determine modelSize from router decision
    const modelSizeStr = routerDecision?.model === 'BIG' ? 'BIG' : (routerDecision?.model === 'SMALL' ? 'SMALL' : 'MOCK');
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
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

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
    context: ContextValidation,
  ): SuggestedAction[] {
    const canViewBuilding = userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('TENANT_OWNER') ||
      userRoles.includes('OPERATOR');
    const canViewPayments = userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('TENANT_OWNER');
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
          } as any,
          prompt: request.message,
          response: {
            answer: response.answer,
            suggestedActions: response.suggestedActions,
          } as any,
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
      console.error('Failed to log AI interaction:', error);
    }
  }
}

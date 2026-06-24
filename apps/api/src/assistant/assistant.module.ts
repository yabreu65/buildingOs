import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { FinanzasModule } from '../finanzas/finanzas.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RedisModule } from '../redis/redis.module';
import { AssistantService, MockAiProvider } from './assistant.service';
import { AssistantToolsService } from './tools.service';
import { AssistantController, SuperAdminAiController } from './assistant.controller';
import { AssistantToolsController } from './tools.controller';
import { AiUnitsController } from './ai-units.controller';
import { AiBudgetService } from './budget.service';
import { AiBudgetController } from './ai-budget.controller';
import { AiRouterService } from './router.service';
import { AiCacheService } from './cache.service';
import { AiContextSummaryService } from './context-summary.service';
import { AiTemplateService } from './template.service';
import { AiTemplateController } from './template.controller';
import { AiAnalyticsService } from './analytics.service';
import { AiActionEventsService } from './action-events.service';
import { AiNudgesService } from './ai-nudges.service';
import { AiNudgesController } from './ai-nudges.controller';
import { AiTicketCategoryService } from './ai-ticket-category.service';
import { OllamaProvider } from './ollama.provider';
import { AiClassifierService } from './classifier.service';
import { AssistantUnitResolverService } from './unit-resolver/assistant-unit-resolver.service';
import { AssistantReadOnlyQueryController } from './read-only-query.controller';
import { AssistantReadOnlyQueryService } from './read-only-query.service';
import { AssistantSemanticLayerService } from './semantic-layer.service';
import { AssistantQueryPlanService } from './query-plan.service';
import { AssistantPolicyEnforcerService } from './policy-enforcer.service';
import { AssistantQueryExecutorsService } from './query-executors.service';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';
import { CircuitBreaker } from './providers/circuit-breaker';
import { AiProviderModule, AI_PROVIDER_TOKEN } from './providers/ai-provider.module';
import { resolveAiProvider } from './providers/ai-provider.resolver';

const aiOptions = resolveAiProvider();

// Intent Engine services
import { IntentRegistry } from './intent-engine/intent-registry';
import { IntentExtractorService } from './intent-engine/intent-extractor.service';
import { AssistantLocalConsensusService } from './intent-engine/local-consensus.service';
import { FilterCoverageValidator } from './intent-engine/filter-coverage.validator';
import { EntityResolverService } from './resolver/entity-resolver.service';
import { AmbiguityService } from './resolver/ambiguity.service';
import { RedisConversationContextService } from './context/redis-conversation-context.service';
import { QueryPlannerService } from './planner/query-planner.service';
import { QueryExecutorService } from './executor/query-executor.service';
import { ResponseFormatterService } from './formatter/response-formatter.service';
import { AssistantFeedbackService } from './feedback/assistant-feedback.service';
import { AssistantLlmHealthController } from './llm-health.controller';
import { AssistantLlmHealthService } from './llm-health.service';
import { IntentSemanticValidatorService } from './intent-semantic-validator.service';

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
import { AssistantTenantDebtService } from './tenant-debt.service';

/**
 * AssistantModule: AI Assistant with intelligent routing, caching, and context enrichment
 *
 * Features:
 * - MOCK provider (always works)
 * - OPENAI provider (optional, behind feature flag)
 * - Rate limiting: 100 calls per tenant per day
 * - Budget enforcement: Monthly budget per tenant (hard stop or soft degrade)
 * - Context injection: Validates buildingId/unitId ownership
 * - RBAC filtering: Only suggests actions user can execute
 * - Fire-and-forget logging: Never fails main operation
 * - Warning at 80% of budget
 * - Audit trail for budget changes
 * - INTELLIGENT ROUTER: Uses cheap model (nano) by default, scales to better model for complex queries
 * - RESPONSE CACHING: Caches repeated queries by tenant+context+message hash (1h TTL)
 * - CONTEXT ENRICHMENT (Lite): Injects minimal real data (top 5 tickets, payments, delinquents, 3 docs)
 * - Cost optimization: 3x-10x savings through model routing + caching
 *
 * Configuration (ENV):
 * - AI_PROVIDER: "MOCK" or "OPENAI" (default: MOCK)
 * - AI_SMALL_MODEL: Cheap model for simple queries (default: gpt-4.1-nano)
 * - AI_BIG_MODEL: Better model for complex queries (default: gpt-4o-mini)
 * - AI_MAX_TOKENS_SMALL: Max tokens for small model (default: 150)
 * - AI_MAX_TOKENS_BIG: Max tokens for big model (default: 400)
 * - AI_DAILY_LIMIT_PER_TENANT: Daily call limit (default: 100)
 * - AI_DEFAULT_TENANT_BUDGET_CENTS: Default monthly budget (default: 500 = $5)
 * - AI_BUDGET_WARN_THRESHOLD: Warning at % (default: 0.8 = 80%)
 * - AI_SOFT_DEGRADE_ON_EXCEEDED: Use mock if budget exceeded (default: false)
 * - AI_CACHE_TTL_SECONDS: Cache entry TTL (default: 3600 = 1 hour)
 * - OPENAI_API_KEY: Required if AI_PROVIDER=OPENAI
 *
 * Models:
 * - AiInteractionLog: All AI interactions (for audit/debugging)
 * - TenantDailyAiUsage: Daily call tracking (rate limiting)
 * - TenantAiBudget: Monthly budget per tenant
 * - TenantMonthlyAiUsage: Monthly usage tracking (calls, tokens, cost)
 *
 * Services:
 * - AssistantService: Main chat endpoint with router + cache + context enrichment
 * - AiBudgetService: Budget tracking and enforcement
 * - AiRouterService: Request classification for model selection
 * - AiCacheService: In-memory LRU response caching
 * - AiContextSummaryService: Real-world context enrichment (minimal snapshots)
 *
 * Dependencies:
 * - PrismaModule: Database access
 * - TenancyModule: TenantAccessGuard for multi-tenant isolation
 * - BillingModule: RequireFeatureGuard for canUseAI check
 * - AuditModule: Audit logging
 */
@Module({
  imports: [PrismaModule, TenancyModule, BillingModule, FinanzasModule, AuditModule, RedisModule, AiProviderModule.register(aiOptions)],
  controllers: [
    AssistantController,
    AiBudgetController,
    AiTemplateController,
    SuperAdminAiController,
    AiNudgesController,
    AiUnitsController,
    AssistantReadOnlyQueryController,
    AssistantToolsController,
    AssistantLlmHealthController,
  ],
  providers: [
    AssistantService,
    AssistantReadOnlyQueryService,
    AiBudgetService,
    AiRouterService,
    AiCacheService,
    AiContextSummaryService,
    AiTemplateService,
    AiAnalyticsService,
    AiActionEventsService,
    AiNudgesService,
    AiTicketCategoryService,
    OllamaProvider,
    MockAiProvider,
    AiClassifierService,
    AssistantUnitResolverService,
    AssistantToolsService,
    AssistantSemanticLayerService,
    AssistantQueryPlanService,
    AssistantPolicyEnforcerService,
    AssistantQueryExecutorsService,
    AssistantDebtCalculatorService,
    AssistantTenantDebtService,
    // Intent Engine services
    IntentRegistry,
    IntentExtractorService,
    AssistantLocalConsensusService,
    FilterCoverageValidator,
    EntityResolverService,
    AmbiguityService,
    RedisConversationContextService,
    QueryPlannerService,
    QueryExecutorService,
    ResponseFormatterService,
    AssistantFeedbackService,
    IntentSemanticValidatorService,
  ],
  exports: [
    AssistantService,
    AssistantReadOnlyQueryService,
    AiBudgetService,
    AiRouterService,
    AiCacheService,
    AiContextSummaryService,
    AiTemplateService,
    AiAnalyticsService,
    AiActionEventsService,
    AiNudgesService,
    AiTicketCategoryService,
    AssistantUnitResolverService,
    AssistantToolsService,
    AssistantSemanticLayerService,
    AssistantQueryPlanService,
    AssistantPolicyEnforcerService,
    AssistantQueryExecutorsService,
    AssistantDebtCalculatorService,
    AssistantTenantDebtService,
    IntentRegistry,
    IntentExtractorService,
    AssistantLocalConsensusService,
    FilterCoverageValidator,
    EntityResolverService,
    AmbiguityService,
    RedisConversationContextService,
    QueryPlannerService,
    QueryExecutorService,
    ResponseFormatterService,
    AssistantFeedbackService,
    IntentSemanticValidatorService,
  ],
})
export class AssistantModule {}

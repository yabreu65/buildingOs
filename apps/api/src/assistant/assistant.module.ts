import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { AiBudgetService } from './budget.service';
import { AiBudgetController } from './ai-budget.controller';
import { AiRouterService } from './router.service';
import { AiCacheService } from './cache.service';

/**
 * AssistantModule: AI Assistant with intelligent routing & caching for cost optimization
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
 * - AssistantService: Main chat endpoint with router + cache integration
 * - AiBudgetService: Budget tracking and enforcement
 * - AiRouterService: Request classification for model selection
 * - AiCacheService: In-memory LRU response caching
 *
 * Dependencies:
 * - PrismaModule: Database access
 * - TenancyModule: TenantAccessGuard for multi-tenant isolation
 * - BillingModule: RequireFeatureGuard for canUseAI check
 * - AuditModule: Audit logging
 */
@Module({
  imports: [PrismaModule, TenancyModule, BillingModule, AuditModule],
  controllers: [AssistantController, AiBudgetController],
  providers: [AssistantService, AiBudgetService, AiRouterService, AiCacheService],
  exports: [AssistantService, AiBudgetService, AiRouterService, AiCacheService],
})
export class AssistantModule {}

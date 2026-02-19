import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { AiBudgetService } from './budget.service';
import { AiBudgetController } from './ai-budget.controller';

/**
 * AssistantModule: AI Assistant for contextual help with budget control
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
 *
 * Configuration (ENV):
 * - AI_PROVIDER: "MOCK" or "OPENAI" (default: MOCK)
 * - AI_MODEL_DEFAULT: Model to use (default: gpt-4o-mini)
 * - AI_MAX_TOKENS: Max tokens for response (default: 400)
 * - AI_DAILY_LIMIT_PER_TENANT: Daily call limit (default: 100)
 * - AI_DEFAULT_TENANT_BUDGET_CENTS: Default monthly budget (default: 500 = $5)
 * - AI_BUDGET_WARN_THRESHOLD: Warning at % (default: 0.8 = 80%)
 * - AI_SOFT_DEGRADE_ON_EXCEEDED: Use mock if budget exceeded (default: false)
 * - OPENAI_API_KEY: Required if AI_PROVIDER=OPENAI
 *
 * Models:
 * - AiInteractionLog: All AI interactions (for audit/debugging)
 * - TenantDailyAiUsage: Daily call tracking (rate limiting)
 * - TenantAiBudget: Monthly budget per tenant
 * - TenantMonthlyAiUsage: Monthly usage tracking (calls, tokens, cost)
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
  providers: [AssistantService, AiBudgetService],
  exports: [AssistantService, AiBudgetService],
})
export class AssistantModule {}

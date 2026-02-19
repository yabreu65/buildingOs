import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';

/**
 * AssistantModule: AI Assistant for contextual help
 *
 * Features:
 * - MOCK provider (always works)
 * - OPENAI provider (optional, behind feature flag)
 * - Rate limiting: 100 calls per tenant per day
 * - Context injection: Validates buildingId/unitId ownership
 * - RBAC filtering: Only suggests actions user can execute
 * - Fire-and-forget logging: Never fails main operation
 *
 * Configuration (ENV):
 * - AI_PROVIDER: "MOCK" or "OPENAI" (default: MOCK)
 * - AI_MAX_TOKENS: Max tokens for OpenAI response (default: 500)
 * - AI_DAILY_LIMIT_PER_TENANT: Daily call limit (default: 100)
 * - OPENAI_API_KEY: Required if AI_PROVIDER=OPENAI
 *
 * Dependencies:
 * - PrismaModule: Database access (AiInteractionLog, TenantDailyAiUsage)
 * - TenancyModule: TenantAccessGuard for multi-tenant isolation
 * - BillingModule: RequireFeatureGuard for canUseAI check
 * - AuditModule: Audit logging
 */
@Module({
  imports: [PrismaModule, TenancyModule, BillingModule, AuditModule],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}

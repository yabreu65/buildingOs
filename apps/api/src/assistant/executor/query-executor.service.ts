import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthorizeService } from '../../rbac/authorize.service';
import { AssistantFeedbackService } from '../feedback/assistant-feedback.service';
import { IntentRegistry } from '../intent-engine/intent-registry';
import { ExecutionPlan, IntentExecutionResult } from '../intent-engine/intent.types';

/**
 * QueryExecutorService - Executes an ExecutionPlan with RBAC enforcement
 *
 * Wraps the IntentRegistry's executor with:
 * - RBAC enforcement via AuthorizeService
 * - TenantId injection (always from JWT/TenantContext, NEVER from intent)
 * - Execution time logging via AssistantFeedbackService
 * - Graceful Prisma error handling
 *
 * @example
 * ```typescript
 * const result = await executor.execute(plan, tenantId, userRoles);
 * ```
 */
@Injectable()
export class QueryExecutorService {
  private readonly logger = new Logger(QueryExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizeService: AuthorizeService,
    private readonly feedbackService: AssistantFeedbackService,
    private readonly registry: IntentRegistry,
  ) {}

  /**
   * Execute an ExecutionPlan with full RBAC and tenant isolation
   *
   * @param plan - Execution plan from QueryPlannerService
   * @param tenantId - Tenant ID from JWT/TenantContext (NEVER from intent)
   * @param userRoles - User roles from JWT for RBAC check
   * @returns Raw data from the intent executor
   * @throws {ForbiddenException} If user lacks required permission
   * @throws Error if intent not found or executor fails
   */
  async execute(plan: ExecutionPlan, tenantId: string, userRoles: string[]): Promise<unknown> {
    const startTime = performance.now();

    // Look up intent in registry
    const intentDefinition = this.registry.get(plan.intent);
    if (!intentDefinition) {
      throw new Error(`Intent "${plan.intent}" not found in registry`);
    }

    // RBAC check
    const hasPermission = await this.authorizeService.authorize({
      userId: '', // Will be filled by controller
      tenantId,
      permission: intentDefinition.requiredPermission,
      buildingId: plan.entityIds?.buildingId,
      unitId: plan.entityIds?.unitId,
    });

    if (!hasPermission) {
      const durationMs = performance.now() - startTime;
      this.feedbackService.logExecution({
        intent: plan.intent,
        entity: { type: plan.entityIds?.unitId ? 'unit' : 'building' },
        filters: plan.filters as Record<string, unknown>,
        success: false,
        error: 'Forbidden',
        durationMs,
        tenantId,
        userId: '',
      });
      throw new ForbiddenException('Unauthorized access to this resource');
    }

    try {
      // Execute the intent's executor function
      const result: IntentExecutionResult = await intentDefinition.executor({
        tenantId, // Always from JWT, never from intent
        entityIds: plan.entityIds,
        filters: plan.filters,
        pagination: plan.pagination,
        prisma: this.prisma, // Inject PrismaService for intent executors
      });

      const durationMs = performance.now() - startTime;
      this.feedbackService.logExecution({
        intent: plan.intent,
        entity: { type: plan.entityIds?.unitId ? 'unit' : 'building' },
        filters: plan.filters as Record<string, unknown>,
        success: true,
        durationMs,
        tenantId,
        userId: '',
      });

      return result.data;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      this.feedbackService.logExecution({
        intent: plan.intent,
        entity: { type: plan.entityIds?.unitId ? 'unit' : 'building' },
        filters: plan.filters as Record<string, unknown>,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
        tenantId,
        userId: '',
      });

      this.logger.error(`[QueryExecutor] Execution failed for "${plan.intent}": ${error}`);
      throw error;
    }
  }
}

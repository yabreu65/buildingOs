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
  async execute(plan: ExecutionPlan, tenantId: string, userId: string, userRoles: string[]): Promise<unknown> {
    const startTime = performance.now();

    // Look up intent in registry
    const intentDefinition = this.registry.get(plan.intent);
    if (!intentDefinition) {
      throw new Error(`Intent "${plan.intent}" not found in registry`);
    }

    const rbacBypassAllowed = this.isRbacBypassAllowed();
    if (!rbacBypassAllowed) {
      // RBAC check is mandatory unless explicit local bypass is enabled
      const hasPermission = await this.authorizeService.authorize({
        userId,
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
          userId,
        });
        throw new ForbiddenException('Unauthorized access to this resource');
      }
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
        userId,
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
        userId,
      });

      this.logger.error(`[QueryExecutor] Execution failed for "${plan.intent}": ${error}`);
      throw error;
    }
  }

  /**
   * Explicit, local-only RBAC bypass guard.
   *
   * Rules:
   * - Disabled by default (ALLOW_RBAC_BYPASS=false).
   * - Never allowed in staging/production.
   * - Only allowed in local development/test mode.
   * - Requires DATABASE_URL to point to local/docker-local postgres host.
   */
  private isRbacBypassAllowed(): boolean {
    const rawFlag = (process.env.ALLOW_RBAC_BYPASS || '').trim().toLowerCase();
    const wantsBypass = rawFlag === 'true' || rawFlag === '1' || rawFlag === 'yes';
    if (!wantsBypass) {
      return false;
    }

    const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
    if (nodeEnv === 'production' || nodeEnv === 'staging') {
      this.logger.warn('Ignoring ALLOW_RBAC_BYPASS=true in staging/production environment.');
      return false;
    }

    if (!['development', 'dev', 'test', 'local'].includes(nodeEnv)) {
      this.logger.warn(`Ignoring ALLOW_RBAC_BYPASS=true because NODE_ENV=${process.env.NODE_ENV || 'undefined'} is not local.`);
      return false;
    }

    const databaseUrl = process.env.DATABASE_URL || '';
    if (!this.isLocalDatabaseUrl(databaseUrl)) {
      this.logger.warn('Ignoring ALLOW_RBAC_BYPASS=true because DATABASE_URL is not local/docker-local.');
      return false;
    }

    this.logger.warn('RBAC bypass is ENABLED by ALLOW_RBAC_BYPASS=true for local environment.');
    return true;
  }

  private isLocalDatabaseUrl(databaseUrl: string): boolean {
    if (!databaseUrl) {
      return false;
    }

    try {
      const parsed = new URL(databaseUrl);
      const host = (parsed.hostname || '').toLowerCase();
      return (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host === 'db' ||
        host.endsWith('.local') ||
        host === 'host.docker.internal'
      );
    } catch {
      // Support DSN-like strings that may not parse cleanly in URL()
      const value = databaseUrl.toLowerCase();
      return (
        value.includes('localhost') ||
        value.includes('127.0.0.1') ||
        value.includes('@db:') ||
        value.includes('host.docker.internal')
      );
    }
  }
}

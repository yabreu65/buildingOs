import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Parameters for logging an intent execution
 */
export interface LogExecutionParams {
  /** Intent name that was executed */
  intent: string;
  /** Entity reference used */
  entity: {
    type: 'unit' | 'building' | 'person';
    buildingAlias?: string;
    unitCode?: string;
    personName?: string;
  };
  /** Filters applied during execution */
  filters: Record<string, unknown>;
  /** Whether execution was successful */
  success: boolean;
  /** Error message if execution failed */
  error?: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Tenant ID for multi-tenant isolation */
  tenantId: string;
  /** User ID who executed the intent */
  userId: string;
}

/**
 * AssistantFeedbackService - Logs and tracks NLU engine execution feedback
 *
 * Provides execution logging for the intent engine with performance tracking.
 * Currently logs through Nest logger; ready for future database persistence.
 *
 * TODO (PR 4): Persist to database via new AssistantIntentLog model
 * TODO (PR 4): Add query methods for analytics (success rate, avg duration, etc.)
 *
 * @example
 * ```typescript
 * const start = performance.now();
 * try {
 *   const result = await executor.execute(params);
 *   feedback.logExecution({
 *     intent: 'list_payments',
 *     entity: { type: 'building', buildingAlias: 'Torre A' },
 *     filters: { status: 'pending' },
 *     success: true,
 *     durationMs: performance.now() - start,
 *     tenantId: 'tenant-1',
 *     userId: 'user-1',
 *   });
 * } catch (error) {
 *   feedback.logExecution({
 *     intent: 'list_payments',
 *     entity: { type: 'building', buildingAlias: 'Torre A' },
 *     filters: { status: 'pending' },
 *     success: false,
 *     error: error.message,
 *     durationMs: performance.now() - start,
 *     tenantId: 'tenant-1',
 *     userId: 'user-1',
 *   });
 * }
 * ```
 */
@Injectable()
export class AssistantFeedbackService {
  private readonly logger = new Logger(AssistantFeedbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an intent execution with timing and result
   *
   * @param params - Execution parameters including intent, entity, filters, success, error, duration, tenant, user
   *
   * NOTE: Feature flag AI_INTENT_ENGINE_ENABLED will gate this service in PR 4
   */
  logExecution(params: LogExecutionParams): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      intent: params.intent,
      entityType: params.entity.type,
      entityLabel: this.getEntityLabel(params.entity),
      filters: params.filters,
      success: params.success,
      error: params.error,
      durationMs: params.durationMs,
      tenantId: params.tenantId,
      userId: params.userId,
    };

    if (params.success) {
      this.logger.debug(
        `[IntentExecution] ${params.intent} | ${logEntry.entityLabel} | ${params.durationMs.toFixed(2)}ms | tenant=${params.tenantId}`,
      );
    } else {
      this.logger.warn(
        `[IntentExecution] ${params.intent} | ${logEntry.entityLabel} | FAILED | ${params.durationMs.toFixed(2)}ms | error=${params.error} | tenant=${params.tenantId}`,
      );
    }

    // TODO (PR 4): When AssistantIntentLog model is added to Prisma schema:
    // await this.prisma.assistantIntentLog.create({ data: logEntry });

    // Fire-and-forget: never block main operation
    this.persistAsync(logEntry).catch((err) => {
      this.logger.error(`[IntentExecution] Failed to persist log: ${err}`);
    });
  }

  /**
   * Get human-readable label for entity
   */
  private getEntityLabel(entity: LogExecutionParams['entity']): string {
    switch (entity.type) {
      case 'building':
        return entity.buildingAlias ?? 'unknown-building';
      case 'unit':
        return entity.unitCode ?? 'unknown-unit';
      case 'person':
        return entity.personName ?? 'unknown-person';
    }
  }

  /**
   * Async persistence (ready for future database storage)
   * Currently logger-only
   */
  private async persistAsync(entry: Record<string, unknown>): Promise<void> {
    // Placeholder for future database persistence
    // Will be implemented in PR 4 when schema changes are made
    const jsonStr = JSON.stringify(entry, null, 2);
    this.logger.debug(`[AssistantFeedback] Execution log: ${jsonStr}`);
  }
}

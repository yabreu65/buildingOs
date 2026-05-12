import { Injectable, Logger } from '@nestjs/common';
import { IntentDefinition } from './intent.types';

/**
 * Custom error thrown when attempting to register a duplicate intent
 */
export class DuplicateIntentError extends Error {
  constructor(intentName: string) {
    super(`Intent "${intentName}" is already registered`);
    this.name = 'DuplicateIntentError';
  }
}

/**
 * IntentRegistry - Central registry for all available intents
 *
 * Manages registration and lookup of IntentDefinition objects.
 * Provides thread-safe registration with duplicate detection.
 *
 * @example
 * ```typescript
 * const registry = new IntentRegistry();
 * registry.register({
 *   name: 'list_payments',
 *   requiredPermission: 'payments.read',
 *   supportedFilters: ['period', 'status', 'minAmount'],
 *   supportedResponseTypes: ['table', 'kpi'],
 *   executor: async (params) => ({ data: [] }),
 * });
 *
 * const intent = registry.get('list_payments');
 * if (intent) {
 *   console.log('Found intent:', intent.name);
 * }
 * ```
 */
@Injectable()
export class IntentRegistry {
  private readonly logger = new Logger(IntentRegistry.name);
  private readonly intents: Map<string, IntentDefinition> = new Map();

  /**
   * Register a new intent
   *
   * @param intent - Intent definition to register
   * @throws {DuplicateIntentError} If intent name is already registered
   */
  register(intent: IntentDefinition): void {
    if (this.intents.has(intent.name)) {
      throw new DuplicateIntentError(intent.name);
    }

    this.intents.set(intent.name, intent);
    this.logger.debug(`[IntentRegistry] Registered intent: ${intent.name}`);
  }

  /**
   * Get an intent by name
   *
   * @param name - Intent name to look up
   * @returns Intent definition or undefined if not found
   */
  get(name: string): IntentDefinition | undefined {
    return this.intents.get(name);
  }

  /**
   * Check if an intent is registered
   *
   * @param name - Intent name to check
   * @returns True if intent exists
   */
  has(name: string): boolean {
    return this.intents.has(name);
  }

  /**
   * List all registered intents
   *
   * @returns Array of all registered intent definitions
   */
  list(): IntentDefinition[] {
    return Array.from(this.intents.values());
  }
}
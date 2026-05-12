import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { ConversationTurn, EntityResolution } from '../intent-engine/intent.types';

/**
 * Conversation session stored in Redis
 */
interface ConversationSession {
  /** Conversation turns */
  turns: ConversationTurn[];
  /** Last resolved entities */
  lastEntity?: {
    buildingId?: string;
    unitId?: string;
    personId?: string;
  };
  /** Last intent name */
  lastIntent?: string;
  /** Last filters applied */
  lastFilters?: Record<string, unknown>;
}

/**
 * RedisConversationContextService - Redis-backed conversation context
 *
 * Replaces in-memory Map with Redis for distributed conversation context.
 * Stores only IDs (not names or amounts) for security.
 * TTL is configurable between 30 and 120 minutes.
 *
 * @example
 * ```typescript
 * await service.storeTurn(tenantId, userId, conversationId, turn, { intent: 'unit_debt' });
 * const turns = await service.getContext(tenantId, userId, conversationId);
 * ```
 */
@Injectable()
export class RedisConversationContextService {
  private readonly logger = new Logger(RedisConversationContextService.name);
  private readonly ttlSeconds: number;
  private readonly maxTurns: number;
  /** In-memory fallback when Redis is unavailable (development) */
  private readonly memoryStore = new Map<string, ConversationSession>();

  constructor(private readonly redis: RedisService) {
    const envTtl = parseInt(process.env.ASSISTANT_CONTEXT_TTL_MINUTES || '30', 10);
    // Clamp TTL between 30 and 120 minutes
    this.ttlSeconds = Math.min(Math.max(envTtl, 30), 120) * 60;
    this.maxTurns = 5;
  }

  /**
   * Generate Redis key for a conversation session
   */
  private getKey(tenantId: string, userId: string, conversationId: string): string {
    return `assistant:context:${tenantId}:${userId}:${conversationId}`;
  }

  /**
   * Store a conversation turn
   *
   * @param tenantId - Tenant ID
   * @param userId - User ID
   * @param conversationId - Conversation/session ID
   * @param turn - Conversation turn to store
   * @param metadata - Optional metadata (intent, filters)
   */
  async storeTurn(
    tenantId: string,
    userId: string,
    conversationId: string,
    turn: ConversationTurn,
    metadata?: { intent?: string; filters?: Record<string, unknown> },
  ): Promise<void> {
    const key = this.getKey(tenantId, userId, conversationId);
    const session = await this.getSession(key);

    session.turns.push(turn);

    // Keep only last N turns
    if (session.turns.length > this.maxTurns) {
      session.turns = session.turns.slice(-this.maxTurns);
    }

    // Update last resolved entities (only IDs stored)
    if (turn.resolvedEntities) {
      session.lastEntity = {
        buildingId: turn.resolvedEntities.building?.id,
        unitId: turn.resolvedEntities.unit?.id,
        personId: turn.resolvedEntities.person?.id,
      };
    }

    if (metadata?.intent) {
      session.lastIntent = metadata.intent;
    }
    if (metadata?.filters) {
      session.lastFilters = metadata.filters;
    }

    // Write to Redis (best effort) and always keep in memory
    try {
      await this.redis.set(key, JSON.stringify(session), this.ttlSeconds);
    } catch {
      this.logger.debug(`Redis unavailable, using memory fallback for ${key}`);
    }
    this.memoryStore.set(key, session);
  }

  /**
   * Get conversation context (all turns)
   *
   * @param tenantId - Tenant ID
   * @param userId - User ID
   * @param conversationId - Conversation/session ID
   * @returns Array of conversation turns
   */
  async getContext(
    tenantId: string,
    userId: string,
    conversationId: string,
  ): Promise<ConversationTurn[]> {
    const key = this.getKey(tenantId, userId, conversationId);
    const session = await this.getSession(key);
    return session.turns;
  }

  /**
   * Get last resolved entity IDs
   *
   * @param tenantId - Tenant ID
   * @param userId - User ID
   * @param conversationId - Conversation/session ID
   * @returns Object with buildingId, unitId, personId or empty
   */
  async getLastResolved(
    tenantId: string,
    userId: string,
    conversationId: string,
  ): Promise<{ buildingId?: string; unitId?: string; personId?: string }> {
    const key = this.getKey(tenantId, userId, conversationId);
    const session = await this.getSession(key);
    return session.lastEntity || {};
  }

  /**
   * Get last intent name from conversation
   *
   * @param tenantId - Tenant ID
   * @param userId - User ID
   * @param conversationId - Conversation/session ID
   * @returns Last intent name or undefined
   */
  async getLastIntent(
    tenantId: string,
    userId: string,
    conversationId: string,
  ): Promise<string | undefined> {
    const key = this.getKey(tenantId, userId, conversationId);
    const session = await this.getSession(key);
    return session.lastIntent;
  }

  /**
   * Resolve anaphoric references in a message
   *
   * @param tenantId - Tenant ID
   * @param userId - User ID
   * @param conversationId - Conversation/session ID
   * @param message - Message to resolve
   * @returns Message with anaphora resolved
   */
  async resolveAnaphora(
    tenantId: string,
    userId: string,
    conversationId: string,
    message: string,
  ): Promise<string> {
    const lastResolved = await this.getLastResolved(tenantId, userId, conversationId);

    // If no entities resolved, return original
    if (!lastResolved.buildingId && !lastResolved.unitId && !lastResolved.personId) {
      return message;
    }

    // Simple anaphora resolution - no replacements for now
    // The NLU engine will use lastResolved context
    return message;
  }

  /**
   * Load or create a session from Redis
   */
  private async getSession(key: string): Promise<ConversationSession> {
    // Try Redis first
    try {
      const data = await this.redis.get(key);
      if (data) {
        try {
          return JSON.parse(data);
        } catch {
          this.logger.warn(`Failed to parse conversation session: ${key}`);
        }
      }
    } catch {
      this.logger.debug(`Redis unavailable, checking memory fallback for ${key}`);
    }

    // Fallback to in-memory store
    const memory = this.memoryStore.get(key);
    if (memory) {
      return memory;
    }

    return { turns: [] };
  }
}

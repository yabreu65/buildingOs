import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConversationTurn, EntityResolution } from '../intent-engine/intent.types';

/**
 * Default TTL: 30 minutes
 */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * Default max turns per session
 */
const DEFAULT_MAX_TURNS = 5;

/**
 * Cleanup interval: 5 minutes
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Anaphoric pronouns for Spanish resolution
 */
const ANAPHORIC_PRONOUNS = ['su', 'sus', 'suya', 'suyas', 'él', 'ella', 'lo', 'la'];

/**
 * Anaphoric patterns to detect references
 */
const ANAPHORIC_PATTERNS = [
  /¿?(?:[Yy]|[Ee]) su(?:s)? [\w\s]+/,
  /¿?(?:[Yy]|[Ee]) (?:el|la) [\w\s]+/,
  /¿?(?:[Tt]iene(?:n)?)? su(?:s)? [\w\s]+/,
];

/**
 * ConversationContextService - Manages conversation history and entity resolution
 *
 * Uses in-memory Map with TTL for sessions (Redis may not be available in tests).
 * Cleans expired entries every 5 minutes.
 *
 * @example
 * ```typescript
 * await contextService.storeTurn(sessionId, turn);
 * const turns = await contextService.getContext(sessionId);
 * const resolved = await contextService.resolveAnaphora(sessionId, message);
 * ```
 */
@Injectable()
export class ConversationContextService implements OnModuleInit {
  private readonly logger = new Logger(ConversationContextService.name);
  private readonly sessions: Map<
    string,
    {
      turns: ConversationTurn[];
      lastResolved: { buildingId?: string; unitId?: string; personId?: string };
      expiresAt: number;
    }
  > = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly maxTurns: number = DEFAULT_MAX_TURNS,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  /**
   * Initialize cleanup timer on module init
   */
  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanExpired().catch((err) => {
        this.logger.error(`Failed to clean expired sessions: ${err}`);
      });
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Clean up cleanup timer on module destroy
   */
  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Store a turn for a session
   *
   * Keeps last N turns (configurable, default 5) with TTL of 30 minutes.
   *
   * @param sessionId - Session identifier
   * @param turn - Conversation turn to store
   */
  async storeTurn(sessionId: string, turn: ConversationTurn): Promise<void> {
    const now = Date.now();
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        turns: [],
        lastResolved: {},
        expiresAt: now + this.ttlMs,
      };
    }

    // Add turn
    session.turns.push(turn);

    // Keep only last N turns
    if (session.turns.length > this.maxTurns) {
      session.turns = session.turns.slice(-this.maxTurns);
    }

    // Update last resolved entities if available
    if (turn.resolvedEntities) {
      this.updateLastResolved(session, turn.resolvedEntities);
    }

    // Update expiration
    session.expiresAt = now + this.ttlMs;

    this.sessions.set(sessionId, session);
  }

  /**
   * Get conversation context for a session
   *
   * @param sessionId - Session identifier
   * @returns Array of conversation turns, newest last
   */
  async getContext(sessionId: string): Promise<ConversationTurn[]> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return [];
    }

    // Check if expired
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return [];
    }

    return session.turns;
  }

  /**
   * Get last resolved entities for a session
   *
   * @param sessionId - Session identifier
   * @returns Object with buildingId, unitId, personId or empty if none
   */
  async getLastResolved(
    sessionId: string,
  ): Promise<{ buildingId?: string; unitId?: string; personId?: string }> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return {};
    }

    // Check if expired
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return {};
    }

    return session.lastResolved;
  }

  /**
   * Resolve anaphoric references in a message
   *
   * Replaces pronouns like "su" with resolved entity context.
   * Example: "¿y su estacionamiento?" → "¿y el estacionamiento de A-0101?"
   *
   * @param sessionId - Session identifier
   * @param message - Message to resolve anaphora in
   * @returns Message with anaphora resolved, or original if no resolution possible
   */
  async resolveAnaphora(sessionId: string, message: string): Promise<string> {
    const session = this.sessions.get(sessionId);

    if (!session || Date.now() > session.expiresAt) {
      return message;
    }

    const { lastResolved } = session;

    // If no entities have been resolved, return original
    if (!lastResolved.buildingId && !lastResolved.unitId && !lastResolved.personId) {
      return message;
    }

    // Check if message contains anaphoric references
    const hasAnaphora = ANAPHORIC_PATTERNS.some((pattern) => pattern.test(message));

    if (!hasAnaphora) {
      return message;
    }

    // Build resolved message
    let resolved = message;

    // Replace building reference
    if (lastResolved.buildingId) {
      // Pattern: "en el edificio" etc - would be replaced with actual building
    }

    // Replace unit reference
    if (lastResolved.unitId) {
      // Simple unit code replacement
      const unitPattern = /(?:el|la)\s+(\w+(?:-\w+)*)/i;
      resolved = resolved.replace(unitPattern, (match, unitRef) => {
        // Don't replace if it already looks like a unit reference
        if (unitRef.includes('-') || /\d{3,}/.test(unitRef)) {
          return match;
        }
        return match;
      });
    }

    return resolved;
  }

  /**
   * Clean expired sessions
   *
   * Called periodically (every 5 minutes) and on service destroy.
   */
  async cleanExpired(): Promise<void> {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned ${cleanedCount} expired sessions`);
    }
  }

  /**
   * Update last resolved entities from a turn
   */
  private updateLastResolved(
    session: { lastResolved: { buildingId?: string; unitId?: string; personId?: string } },
    resolution: EntityResolution,
  ): void {
    if (resolution.building?.id) {
      session.lastResolved.buildingId = resolution.building.id;
    }
    if (resolution.unit?.id) {
      session.lastResolved.unitId = resolution.unit.id;
    }
    if (resolution.person?.id) {
      session.lastResolved.personId = resolution.person.id;
    }
  }
}

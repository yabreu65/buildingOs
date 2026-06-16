/**
 * IdempotencyService — Redis-first deduplication with DB fallback
 * Task 2.6: Prevents duplicate webhook processing via Redis SETNX (72h TTL) + DB audit
 */

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly REDIS_TTL = 72 * 60 * 60; // 72 hours in seconds

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Check if a webhook event has already been processed
   * Fast path: Redis lookup. Fallback: DB lookup.
   */
  async isProcessed(eventId: string, provider: string): Promise<boolean> {
    const redisKey = `webhook:${provider}:${eventId}`;

    // Fast path: Redis check
    const cached = await this.redis.get(redisKey);
    if (cached) {
      this.logger.debug(`Webhook ${eventId} found in Redis cache (already processed)`);
      return true;
    }

    // Fallback: DB check
    const existing = await this.prisma.processedWebhookEvent.findUnique({
      where: { eventId_provider: { eventId, provider } },
    });

    if (existing) {
      this.logger.debug(`Webhook ${eventId} found in DB (already processed)`);
      // Re-populate Redis cache
      await this.redis.set(redisKey, '1', this.REDIS_TTL);
      return true;
    }

    return false;
  }

  /**
   * Mark a webhook event as processed
   * Sets Redis key with TTL and creates DB audit record
   */
  async markProcessed(eventId: string, provider: string): Promise<void> {
    const redisKey = `webhook:${provider}:${eventId}`;

    // Set Redis key with TTL
    await this.redis.set(redisKey, '1', this.REDIS_TTL);

    // Create DB audit record
    await this.prisma.processedWebhookEvent.create({
      data: { eventId, provider },
    });

    this.logger.debug(`Webhook ${eventId} marked as processed for provider ${provider}`);
  }
}
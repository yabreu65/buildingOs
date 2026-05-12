import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * RedisService - Redis client wrapper for BuildingOS
 *
 * Provides a managed Redis connection with automatic reconnection.
 * Falls back to null client if connection fails (allows app to function without Redis).
 *
 * @example
 * ```typescript
 * const client = redisService.getClient();
 * if (client) {
 *   await client.get('key');
 * }
 * ```
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  async onModuleInit(): Promise<void> {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    try {
      this.client = new Redis({
        host,
        port,
        retryStrategy: (times) => Math.min(times * 50, 2000),
      });

      this.client.on('error', (err) => {
        this.logger.error(`Redis error: ${err.message}`);
      });

      this.client.on('connect', () => {
        this.logger.log(`Redis connected to ${host}:${port}`);
      });

      // Test connection
      await this.client.ping();
      this.logger.log(`Redis connected to ${host}:${port}`);
    } catch (error) {
      this.logger.error(`Redis connection failed: ${error}`);
      this.client = null;
    }
  }

  onModuleDestroy(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }

  /**
   * Get the Redis client instance
   *
   * @returns Redis client or null if not connected
   */
  getClient(): Redis | null {
    return this.client;
  }

  /**
   * Get a value by key
   *
   * @param key - The key to retrieve
   * @returns The value or null if not found/not connected
   */
  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  /**
   * Set a value with optional TTL
   *
   * @param key - The key to set
   * @param value - The value to store
   * @param ttlSeconds - Optional TTL in seconds
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  /**
   * Delete a key
   *
   * @param key - The key to delete
   */
  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }
}

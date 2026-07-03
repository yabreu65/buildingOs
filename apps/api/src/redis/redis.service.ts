import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '../config/config.service';

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

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.configService.getValue('redisUrl');
    const nodeEnv = this.configService.getValue('nodeEnv');
    const isDevelopment = nodeEnv === 'development' || nodeEnv === 'test';
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    if (!redisUrl && !isDevelopment) {
      throw new Error(`REDIS_URL is required outside development (current environment: ${nodeEnv})`);
    }

    try {
      this.client = redisUrl
        ? new Redis(redisUrl, {
            retryStrategy: (times) => Math.min(times * 50, 2000),
            maxRetriesPerRequest: 1,
            enableReadyCheck: true,
          })
        : new Redis({
            host,
            port,
            retryStrategy: (times) => Math.min(times * 50, 2000),
            maxRetriesPerRequest: 1,
            enableReadyCheck: true,
          });

      this.client.on('error', (err) => {
        this.logger.error(`Redis error: ${err.message}`);
      });

      this.client.on('connect', () => {
        this.logger.log(
          `Redis connected to ${redisUrl ?? `${host}:${port}`}`,
        );
      });

      // Test connection
      await this.client.ping();
      this.logger.log(
        `Redis ready for ${redisUrl ?? `${host}:${port}`}`,
      );
    } catch (error) {
      this.logger.error(`Redis connection failed: ${error}`);
      this.client = null;
      if (!isDevelopment) {
        throw error;
      }
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
   * Whether Redis is currently ready to serve requests.
   */
  isReady(): boolean {
    return this.client?.status === 'ready';
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

  /**
   * Atomically increments a counter and ensures the TTL window exists.
   */
  async incrementCounter(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number } | null> {
    if (!this.client) return null;

    const now = Date.now();
    const results = await this.client
      .multi()
      .incr(key)
      .pttl(key)
      .exec();

    if (!results) {
      return null;
    }

    const count = Number(results[0]?.[1] ?? 0);
    let ttlMs = Number(results[1]?.[1] ?? -1);

    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      await this.client.pexpire(key, windowMs);
      ttlMs = windowMs;
    }

    return {
      count,
      resetTime: now + ttlMs,
    };
  }
}

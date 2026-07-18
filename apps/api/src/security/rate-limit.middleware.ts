/**
 * Rate Limiting Middleware for BuildingOS
 * Protects against brute force, enumeration, and abuse
 * Uses Redis when available and falls back to in-memory counters when needed
 */

import { Injectable, NestMiddleware, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '../config/config.service';

interface RateLimitEntry {
  resetTime: number;
  count: number;
}

interface RateLimitConfig {
  readonly max: number;
  readonly windowMs: number;
}

/**
 * Redis-backed rate limiter with in-memory fallback.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);
  private readonly limits = new Map<string, RateLimitEntry>();
  private readonly cleanupInterval = 60000; // 1 minute
  private redisFallbackWarned = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    // Cleanup expired entries
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  /**
   * Apply route-specific rate limits and attach standard RateLimit headers.
   *
   * @param req - Incoming Express request.
   * @param res - Outgoing Express response.
   * @param next - Express continuation callback.
   */
  use(req: Request, res: Response, next: NextFunction): void {
    void this.applyRateLimit(req, res, next).catch((error) => next(error));
  }

  private async applyRateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // Bypass rate limiting in test environment
    if (process.env.NODE_ENV === 'test') {
      next();
      return;
    }

    const key = this.getKey(req);
    const limit = this.getLimitConfig(req);

    if (!limit) {
      // No rate limit for this route
      next();
      return;
    }

    const entry = await this.incrementCounter(key, limit.windowMs);
    const now = Date.now();

    // Set headers
    const remaining = Math.max(0, limit.max - entry.count);
    const resetTime = Math.ceil(entry.resetTime / 1000);

    res.setHeader('RateLimit-Limit', limit.max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetTime);

    // Check limit exceeded
    if (entry.count > limit.max) {
      next(new HttpException(
        {
          statusCode: 429,
          message: 'Too many requests, please try again later',
          code: 'RATE_LIMITED',
          retryAfter: Math.ceil((entry.resetTime - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ));
      return;
    }

    next();
  }

  private async incrementCounter(
    key: string,
    windowMs: number,
  ): Promise<RateLimitEntry> {
    const redisEntry = await this.redisService.incrementCounter(key, windowMs);
    if (redisEntry) {
      return {
        count: redisEntry.count,
        resetTime: redisEntry.resetTime,
      };
    }

    this.warnOnRedisFallback();

    const now = Date.now();
    const entry = this.limits.get(key) || { count: 0, resetTime: now + windowMs };

    if (now > entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + windowMs;
    }

    entry.count++;
    this.limits.set(key, entry);
    return entry;
  }

  private warnOnRedisFallback(): void {
    if (this.redisFallbackWarned) {
      return;
    }

    const nodeEnv = this.configService.getValue('nodeEnv');
    if (nodeEnv === 'production' || nodeEnv === 'staging') {
      this.logger.warn(
        '[RateLimit] Redis unavailable; using in-memory fallback. Horizontal rate limiting is degraded.',
      );
    }
    this.redisFallbackWarned = true;
  }

  /**
   * Generate unique key for rate limiting
   * Combines: IP + path + optional email/tenantId from body
   */
  private getKey(req: Request): string {
    const ip = this.getClientIp(req);
    const path = req.path;

    // Include email if present in body (for auth/invitations)
    let suffix = '';
    if (req.body?.email) {
      suffix += `:${req.body.email.toLowerCase()}`;
    }
    if (req.body?.tenantId) {
      suffix += `:${req.body.tenantId}`;
    }

    return `${ip}:${req.method}:${path}${suffix}`;
  }

  /**
   * Get rate limit config for this endpoint
   */
  private getLimitConfig(req: Request): RateLimitConfig | null {
    const path = req.path;
    const method = req.method;

    // Public invitation validation is intentionally rate limited before the
    // broad GET exemption. req.path excludes the token query string.
    if (path === '/invitations/validate' && method === 'GET') {
      return { max: 10, windowMs: 15 * 60 * 1000 };
    }

    // Exempt other GET requests from rate limiting.
    if (method === 'GET') {
      return null;
    }

    // Auth endpoints - strict limits
    if (path === '/auth/login' && method === 'POST') {
      // Allow more attempts from localhost for E2E testing
      const clientIp = this.getClientIp(req);
      const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
      if (isLocalhost) {
        return { max: 100, windowMs: 60 * 1000 }; // 100 attempts per minute for local dev/tests
      }
      return { max: 5, windowMs: 15 * 60 * 1000 }; // 5 attempts per 15 minutes
    }

    if (path === '/auth/signup' && method === 'POST') {
      return { max: 3, windowMs: 60 * 60 * 1000 }; // 3 attempts per hour
    }

    // Public lead submission - moderate limit
    if (path === '/leads/public' && method === 'POST') {
      return { max: 10, windowMs: 60 * 1000 }; // 10 per minute per IP
    }

    // Invitation endpoints - moderate limits
    if (path.includes('/invitations/accept') && method === 'POST') {
      return { max: 10, windowMs: 15 * 60 * 1000 }; // 10 attempts per 15 minutes
    }

    if (path.includes('/invitations') && method === 'POST') {
      return { max: 5, windowMs: 60 * 60 * 1000 }; // 5 creation attempts per hour
    }

    // Super admin endpoints - very strict for write operations
    if (path.includes('/super-admin/impersonation/start') && method === 'POST') {
      return { max: 10, windowMs: 60 * 60 * 1000 }; // 10 attempts per hour
    }

    // Super-admin write operations (non-GET)
    if (path.startsWith('/super-admin/') && method !== 'GET') {
      return { max: 30, windowMs: 60 * 1000 }; // 30 per minute
    }

    // Global rate limit: all other write operations (POST, PUT, DELETE, PATCH)
    // This provides protection against abuse while allowing read operations
    return { max: 100, windowMs: 60 * 1000 }; // 100 requests per minute per IP
  }

  /**
   * Extract client IP (respects X-Forwarded-For from proxies)
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]!.trim();
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }

  /**
   * Cleanup expired entries to prevent memory leak
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.limits.entries()) {
      if (now > entry.resetTime + this.cleanupInterval) {
        this.limits.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`[RateLimit] Cleaned ${cleaned} expired entries`);
    }
  }
}

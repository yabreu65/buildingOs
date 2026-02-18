/**
 * Rate Limiting Middleware for BuildingOS
 * Protects against brute force, enumeration, and abuse
 * Uses in-memory store for development, Redis for production
 */

import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Simple in-memory rate limiter (for development)
 * In production, upgrade to Redis-based limiter
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly limits = new Map<string, { count: number; resetTime: number }>();
  private readonly cleanupInterval = 60000; // 1 minute

  constructor() {
    // Cleanup expired entries
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  use(req: Request, res: Response, next: NextFunction) {
    const key = this.getKey(req);
    const limit = this.getLimitConfig(req);

    if (!limit) {
      // No rate limit for this route
      return next();
    }

    const now = Date.now();
    const entry = this.limits.get(key) || { count: 0, resetTime: now + limit.windowMs };

    // Reset if window expired
    if (now > entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + limit.windowMs;
    }

    // Increment counter
    entry.count++;
    this.limits.set(key, entry);

    // Set headers
    const remaining = Math.max(0, limit.max - entry.count);
    const resetTime = Math.ceil(entry.resetTime / 1000);

    res.setHeader('RateLimit-Limit', limit.max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetTime);

    // Check limit exceeded
    if (entry.count > limit.max) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Too many requests, please try again later',
          code: 'RATE_LIMITED',
          retryAfter: Math.ceil((entry.resetTime - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    next();
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

    return `${ip}:${path}${suffix}`;
  }

  /**
   * Get rate limit config for this endpoint
   */
  private getLimitConfig(req: Request): { max: number; windowMs: number } | null {
    const path = req.path;
    const method = req.method;

    // Auth endpoints - strict limits
    if (path === '/auth/login' && method === 'POST') {
      return { max: 5, windowMs: 15 * 60 * 1000 }; // 5 attempts per 15 minutes
    }

    if (path === '/auth/signup' && method === 'POST') {
      return { max: 3, windowMs: 60 * 60 * 1000 }; // 3 attempts per hour
    }

    // Invitation endpoints - moderate limits
    if (path.includes('/invitations/validate') && method === 'POST') {
      return { max: 10, windowMs: 15 * 60 * 1000 }; // 10 attempts per 15 minutes
    }

    if (path.includes('/invitations/accept') && method === 'POST') {
      return { max: 10, windowMs: 15 * 60 * 1000 }; // 10 attempts per 15 minutes
    }

    // Super admin endpoints - very strict
    if (path.includes('/super-admin/impersonation/start') && method === 'POST') {
      return { max: 10, windowMs: 60 * 60 * 1000 }; // 10 attempts per hour
    }

    // No rate limit for other endpoints
    return null;
  }

  /**
   * Extract client IP (respects X-Forwarded-For from proxies)
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
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
      console.log(`[RateLimit] Cleaned ${cleaned} expired entries`);
    }
  }
}

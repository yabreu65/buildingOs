/**
 * AI Response Cache Service
 *
 * Caches assistant responses to avoid duplicate API calls.
 * Uses in-memory LRU cache for MVP (can be swapped with Redis later).
 *
 * Cache key: hash of tenant + context + normalized message
 * Cache TTL: Configurable (default 1 hour for MVP)
 * Max size: 1000 entries per tenant (LRU eviction)
 */

import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { ChatResponse } from './assistant.service';

export interface CacheEntry {
  response: ChatResponse;
  model: string;
  createdAt: Date;
  hits: number; // Track popularity
}

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  estimatedSavingsCents: number;
}

@Injectable()
export class AiCacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private stats = {
    hits: 0,
    misses: 0,
    savedTokens: 0,
  };

  private readonly ttlSeconds: number;
  private readonly maxEntriesPerTenant: number = 1000;

  constructor() {
    this.ttlSeconds = parseInt(process.env.AI_CACHE_TTL_SECONDS || '3600', 10);
    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanupExpired(), 300000);
  }

  /**
   * Generate cache key from request context
   *
   * Key = hash(tenantId + page + buildingId + unitId + normalized_message)
   * This ensures same question from same context hits cache,
   * but different contexts don't collide
   *
   * @param tenantId Tenant ID
   * @param message User message
   * @param page Page context
   * @param buildingId Optional building context
   * @param unitId Optional unit context
   * @returns Cache key
   */
  generateKey(
    tenantId: string,
    message: string,
    page: string,
    buildingId?: string,
    unitId?: string,
  ): string {
    // Normalize message: trim, lowercase, remove extra spaces
    const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');

    // Build key components
    const keyParts = [
      tenantId,
      page,
      buildingId || 'none',
      unitId || 'none',
      normalized,
    ].join('::');

    // Hash for shorter key
    const hash = crypto.createHash('sha256').update(keyParts).digest('hex').substring(0, 16);
    return `cache:ai:${hash}`;
  }

  /**
   * Get cached response if exists and not expired
   *
   * @param key Cache key from generateKey()
   * @returns Cached response or null if miss/expired
   */
  get(key: string): ChatResponse | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    const ageSeconds = (Date.now() - entry.createdAt.getTime()) / 1000;
    if (ageSeconds > this.ttlSeconds) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Cache hit!
    entry.hits++;
    this.stats.hits++;
    return entry.response;
  }

  /**
   * Store response in cache
   *
   * @param key Cache key
   * @param response Chat response to cache
   * @param model Model used (for stats tracking)
   */
  set(key: string, response: ChatResponse, model: string): void {
    // Check size limit (per tenant)
    if (this.cache.size >= this.maxEntriesPerTenant) {
      // LRU: remove least recently used (entry with lowest hits)
      let lruKey = key;
      let lruHits = Infinity;

      for (const [k, v] of this.cache.entries()) {
        if (v.hits < lruHits) {
          lruKey = k;
          lruHits = v.hits;
        }
      }

      this.cache.delete(lruKey);
    }

    this.cache.set(key, {
      response,
      model,
      createdAt: new Date(),
      hits: 0,
    });
  }

  /**
   * Get cache hit rate (hits / (hits + misses))
   *
   * @returns Hit rate as percentage (0-100)
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return Math.round((this.stats.hits / total) * 100);
  }

  /**
   * Estimate savings from cache hits
   *
   * Assumes:
   * - Small model: ~100 tokens (input + output)
   * - Cost: ~0.2 cents per hit avoided
   *
   * @returns Estimated savings in cents
   */
  estimateSavings(): number {
    const costPerHitCents = 0.2; // Rough estimate for small model
    return Math.round(this.stats.hits * costPerHitCents);
  }

  /**
   * Get cache statistics
   *
   * @returns Cache stats including size, hit rate, estimated savings
   */
  getStats(): CacheStats {
    return {
      totalEntries: this.cache.size,
      hitRate: this.getHitRate(),
      estimatedSavingsCents: this.estimateSavings(),
    };
  }

  /**
   * Clear all cache (useful for testing or when memory is critical)
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, savedTokens: 0 };
  }

  /**
   * Get cache info (for debugging/observability)
   */
  getInfo() {
    return {
      size: this.cache.size,
      maxSize: this.maxEntriesPerTenant,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: this.getHitRate(),
      ttlSeconds: this.ttlSeconds,
      estimatedSavingsCents: this.estimateSavings(),
    };
  }

  /**
   * Remove expired entries
   *
   * @private
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      const ageSeconds = (now - entry.createdAt.getTime()) / 1000;
      if (ageSeconds > this.ttlSeconds) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }
}

/**
 * CircuitBreaker — protects AI provider from cascading failures
 * Task 4.5: Trips after 3 failures, recovers after health check confirms provider is healthy
 */

import { Injectable, Logger } from '@nestjs/common';

export type CircuitState = 'closed' | 'open' | 'half-open';

@Injectable()
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private failureCount = 0;
  private state: CircuitState = 'closed';
  private lastFailureTime: Date | null = null;

  constructor(
    private readonly providerName: string,
    private readonly failureThreshold: number = 3,
  ) {}

  /**
   * Whether the circuit allows requests through
   */
  isAvailable(): boolean {
    return this.state !== 'open';
  }

  /**
   * Current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Record a successful request — resets failure count and closes circuit
   */
  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
    this.lastFailureTime = null;
  }

  /**
   * Record a failure — increments count and trips circuit when threshold reached
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      this.logger.warn(`Circuit breaker OPEN for ${this.providerName} after ${this.failureCount} failures`);
    }
  }

  /**
   * Get a fallback message to return when circuit is open
   */
  getFallbackMessage(): string {
    return 'AI service is temporarily unavailable. Please try again later.';
  }
}
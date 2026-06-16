/**
 * Tests for CircuitBreaker
 * Task 4.5: Trips after 3 failures, recovers after health check
 */

import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-provider', 3);
  });

  it('starts in closed state', () => {
    expect(breaker.getState()).toBe('closed');
  });

  it('trips to open after 3 consecutive failures', () => {
    breaker.recordFailure();
    expect(breaker.getState()).toBe('closed');

    breaker.recordFailure();
    expect(breaker.getState()).toBe('closed');

    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');
  });

  it('returns true for isAvailable when closed', () => {
    expect(breaker.isAvailable()).toBe(true);
  });

  it('returns false for isAvailable when open', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isAvailable()).toBe(false);
  });

  it('resets to closed after successful health check', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');

    breaker.recordSuccess();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.isAvailable()).toBe(true);
  });

  it('resets failure count on success', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('closed');

    // Should need 3 more failures to trip again
    breaker.recordFailure();
    expect(breaker.getState()).toBe('closed');
  });

  it('returns fallback message when open', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    const message = breaker.getFallbackMessage();
    expect(message).toContain('temporarily unavailable');
  });
});
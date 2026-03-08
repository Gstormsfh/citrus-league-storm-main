import { logger } from '@citrus/shared';

/**
 * Circuit Breaker — Resilience pattern for external service calls.
 *
 * Prevents cascading failures when Supabase or other services are down.
 * Three states: CLOSED (normal), OPEN (rejecting), HALF_OPEN (testing).
 *
 * Usage:
 *   const breaker = new CircuitBreaker('supabase', { failureThreshold: 5 });
 *   const result = await breaker.execute(() => supabase.from('leagues').select('*'));
 */

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms to wait before trying again (default: 30000 = 30s) */
  resetTimeoutMs?: number;
  /** Number of successful calls in HALF_OPEN to close the circuit (default: 2) */
  successThreshold?: number;
  /** Optional callback when state changes */
  onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreaker {
  private name: string;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.successThreshold = options.successThreshold ?? 2;
    this.onStateChange = options.onStateChange;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  get stats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Execute an async operation through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.transition('HALF_OPEN');
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Execute with a fallback value when the circuit is open.
   * Returns the fallback instead of throwing.
   */
  async executeWithFallback<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await this.execute(fn);
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return fallback;
      }
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.transition('CLOSED');
      }
    }
    // Reset failure count on any success in CLOSED state
    if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.transition('OPEN');
    } else if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.transition('OPEN');
    }
  }

  private transition(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === 'HALF_OPEN') {
      this.successCount = 0;
    }

    this.onStateChange?.(this.name, oldState, newState);
  }

  /** Reset the circuit breaker to CLOSED state */
  reset(): void {
    this.transition('CLOSED');
  }
}

export class CircuitOpenError extends Error {
  constructor(breakerName: string) {
    super(`Circuit breaker "${breakerName}" is OPEN — service unavailable`);
    this.name = 'CircuitOpenError';
  }
}

// ── Global circuit breakers for the API server ─────────────────────────
export const supabaseBreaker = new CircuitBreaker('supabase', {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 2,
  onStateChange: (name, from, to) => {
    logger.warn(`[CircuitBreaker] ${name}: ${from} → ${to}`);
  },
});

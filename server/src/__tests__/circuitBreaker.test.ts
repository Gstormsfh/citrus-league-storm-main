import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../lib/circuitBreaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      resetTimeoutMs: 100,
      successThreshold: 2,
    });
  });

  it('starts in CLOSED state', () => {
    expect(breaker.currentState).toBe('CLOSED');
  });

  it('stays CLOSED on successful calls', async () => {
    await breaker.execute(() => Promise.resolve('ok'));
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.currentState).toBe('CLOSED');
  });

  it('opens after reaching failure threshold', async () => {
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow('fail');
    }

    expect(breaker.currentState).toBe('OPEN');
  });

  it('rejects calls immediately when OPEN', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(fail); } catch {}
    }

    await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitOpenError);
  });

  it('transitions to HALF_OPEN after reset timeout', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(fail); } catch {}
    }

    expect(breaker.currentState).toBe('OPEN');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 150));

    // Next call should transition to HALF_OPEN
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.currentState).toBe('HALF_OPEN');
  });

  it('closes after enough successes in HALF_OPEN', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(fail); } catch {}
    }

    await new Promise((r) => setTimeout(r, 150));

    // Two successes needed
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.currentState).toBe('HALF_OPEN');

    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.currentState).toBe('CLOSED');
  });

  it('re-opens on failure in HALF_OPEN', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(fail); } catch {}
    }

    await new Promise((r) => setTimeout(r, 150));

    // Success to get to HALF_OPEN
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.currentState).toBe('HALF_OPEN');

    // Failure re-opens
    try { await breaker.execute(fail); } catch {}
    expect(breaker.currentState).toBe('OPEN');
  });

  it('executeWithFallback returns fallback when OPEN', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(fail); } catch {}
    }

    const result = await breaker.executeWithFallback(
      () => Promise.resolve('real'),
      'fallback',
    );
    expect(result).toBe('fallback');
  });

  it('executeWithFallback returns real value when CLOSED', async () => {
    const result = await breaker.executeWithFallback(
      () => Promise.resolve('real'),
      'fallback',
    );
    expect(result).toBe('real');
  });

  it('reset() returns to CLOSED state', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(fail); } catch {}
    }
    expect(breaker.currentState).toBe('OPEN');

    breaker.reset();
    expect(breaker.currentState).toBe('CLOSED');
    expect(breaker.stats.failureCount).toBe(0);
  });

  it('reports stats correctly', async () => {
    const stats = breaker.stats;
    expect(stats.name).toBe('test');
    expect(stats.state).toBe('CLOSED');
    expect(stats.failureCount).toBe(0);
  });

  it('calls onStateChange callback', async () => {
    const onChange = vi.fn();
    const cb = new CircuitBreaker('cb', {
      failureThreshold: 1,
      onStateChange: onChange,
    });

    try {
      await cb.execute(() => Promise.reject(new Error('fail')));
    } catch {}

    expect(onChange).toHaveBeenCalledWith('cb', 'CLOSED', 'OPEN');
  });
});

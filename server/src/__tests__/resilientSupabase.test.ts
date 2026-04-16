import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withResilience,
  isTransientError,
  __setSleepForTests,
  __resetSleepForTests,
} from '../lib/resilientSupabase';
import { supabaseBreaker } from '../lib/circuitBreaker';

// Make retry delays synchronous in tests — otherwise every test adds 100ms+.
beforeEach(() => {
  __setSleepForTests(async () => {});
  supabaseBreaker.reset();
});

afterEach(() => {
  __resetSleepForTests();
});

describe('isTransientError', () => {
  it('flags HTTP 429 as transient', () => {
    expect(isTransientError({ status: 429 })).toBe(true);
  });

  it('flags HTTP 5xx as transient', () => {
    expect(isTransientError({ status: 500 })).toBe(true);
    expect(isTransientError({ status: 502 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ status: 504 })).toBe(true);
  });

  it('does NOT flag 4xx (non-429) as transient', () => {
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ status: 404 })).toBe(false);
    expect(isTransientError({ status: 409 })).toBe(false);
  });

  it('flags network error codes as transient', () => {
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientError({ code: 'ECONNREFUSED' })).toBe(true);
  });

  it('flags Postgres admin_shutdown / too_many_connections as transient', () => {
    expect(isTransientError({ code: '57P03' })).toBe(true);
    expect(isTransientError({ code: '53300' })).toBe(true);
  });

  it('flags messages matching network-failure patterns', () => {
    expect(isTransientError({ message: 'fetch failed' })).toBe(true);
    expect(isTransientError({ message: 'network timeout' })).toBe(true);
    expect(isTransientError({ message: 'Service unavailable' })).toBe(true);
  });

  it('does NOT flag domain errors as transient', () => {
    expect(isTransientError({ message: 'Player already drafted' })).toBe(false);
    expect(isTransientError({ message: 'Pick number already taken' })).toBe(false);
    expect(isTransientError({ message: 'unique constraint violated' })).toBe(false);
  });

  it('returns false for null, undefined, primitives', () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError('string')).toBe(false);
    expect(isTransientError(42)).toBe(false);
  });
});

describe('withResilience', () => {
  it('returns data on first successful call — no retries', async () => {
    const fn = vi.fn().mockResolvedValue({ data: { id: 'ok' }, error: null });

    const result = await withResilience(fn);

    expect(result).toEqual({ data: { id: 'ok' }, error: null });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes through permanent errors without retrying', async () => {
    const permanentError = { message: 'Player already drafted', status: 409 };
    const fn = vi.fn().mockResolvedValue({ data: null, error: permanentError });

    const result = await withResilience(fn);

    expect(result.error).toEqual(permanentError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient errors and returns success when they resolve', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'fetch failed' } })
      .mockResolvedValueOnce({ data: null, error: { status: 503 } })
      .mockResolvedValueOnce({ data: { id: 'recovered' }, error: null });

    const result = await withResilience(fn, { maxRetries: 2 });

    expect(result).toEqual({ data: { id: 'recovered' }, error: null });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns last transient error when retries exhausted', async () => {
    const fn = vi.fn().mockResolvedValue({ data: null, error: { status: 503, message: 'upstream dead' } });

    const result = await withResilience(fn, { maxRetries: 2 });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('TRANSIENT_EXHAUSTED');
    expect(result.error?.message).toContain('upstream dead');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on thrown transient errors (network-level failures)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce({ data: { id: 'recovered' }, error: null });

    const result = await withResilience(fn, { maxRetries: 2 });

    expect(result).toEqual({ data: { id: 'recovered' }, error: null });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('re-throws permanent exceptions — they are not retry-eligible', async () => {
    const programmerBug = new TypeError('cannot read property of undefined');
    const fn = vi.fn().mockRejectedValue(programmerBug);

    await expect(withResilience(fn)).rejects.toThrow('cannot read property of undefined');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('trips circuit breaker after enough transient exhaustions', async () => {
    // failureThreshold is 5. Each withResilience call = 1 failure (after
    // retries exhaust). So 5 calls should open the circuit.
    const fn = vi.fn().mockResolvedValue({ data: null, error: { status: 503 } });

    for (let i = 0; i < 5; i++) {
      await withResilience(fn, { maxRetries: 1 });
    }

    // Circuit should now be OPEN — next call fails fast without invoking fn
    const callCountBefore = fn.mock.calls.length;
    const result = await withResilience(fn, { maxRetries: 1 });
    const callCountAfter = fn.mock.calls.length;

    expect(result.error?.code).toBe('CIRCUIT_OPEN');
    expect(callCountAfter).toBe(callCountBefore); // fn NOT invoked
  });

  it('passes label through to log context', async () => {
    // Labels surface in logger.warn calls during retry — we're not asserting
    // log content here (logger is console-based), just that passing a label
    // doesn't break anything.
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { status: 503 } })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });

    const result = await withResilience(fn, { maxRetries: 1, label: 'test-op' });

    expect(result.data).toEqual({ ok: true });
  });

  it('handles maxRetries=0 — single attempt, no retries', async () => {
    const fn = vi.fn().mockResolvedValue({ data: null, error: { status: 503 } });

    const result = await withResilience(fn, { maxRetries: 0 });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe('TRANSIENT_EXHAUSTED');
  });
});

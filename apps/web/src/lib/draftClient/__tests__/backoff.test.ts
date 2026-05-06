// Phase 4.5 chunk 11g.5a — exponential backoff tests.
//
// 5 tests covering: initial delay at attempt 0, doubling per
// attempt, MAX_BACKOFF_MS cap, jitter range with seeded random,
// jitter never produces a negative delay.

import { describe, it, expect } from 'vitest';
import {
  computeBackoffMs,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  BACKOFF_MULTIPLIER,
  JITTER_FACTOR,
} from '../backoff';

describe('computeBackoffMs (chunk 11g.5a)', () => {
  it('attempt=0 returns approximately INITIAL_BACKOFF_MS (within ±20% jitter)', () => {
    const max = INITIAL_BACKOFF_MS * (1 + JITTER_FACTOR);
    const min = INITIAL_BACKOFF_MS * (1 - JITTER_FACTOR);
    // 100 trials with default Math.random — every result should be in band.
    for (let i = 0; i < 100; i++) {
      const delay = computeBackoffMs(0);
      expect(delay).toBeGreaterThanOrEqual(Math.floor(min));
      expect(delay).toBeLessThanOrEqual(Math.ceil(max));
    }
  });

  it('doubles per attempt up to MAX_BACKOFF_MS cap', () => {
    // Use the midpoint random function (returns 0.5) so jitter is
    // exactly 0 — base delay is observable directly.
    const noJitter = () => 0.5;
    expect(computeBackoffMs(0, noJitter)).toBe(INITIAL_BACKOFF_MS);
    expect(computeBackoffMs(1, noJitter)).toBe(INITIAL_BACKOFF_MS * BACKOFF_MULTIPLIER);
    expect(computeBackoffMs(2, noJitter)).toBe(INITIAL_BACKOFF_MS * BACKOFF_MULTIPLIER ** 2);
    expect(computeBackoffMs(3, noJitter)).toBe(INITIAL_BACKOFF_MS * BACKOFF_MULTIPLIER ** 3);
    expect(computeBackoffMs(4, noJitter)).toBe(INITIAL_BACKOFF_MS * BACKOFF_MULTIPLIER ** 4);
  });

  it('caps at MAX_BACKOFF_MS for high attempt counts', () => {
    const noJitter = () => 0.5;
    // attempt=10 would produce 1024 * 1000 = ~1M ms uncapped.
    expect(computeBackoffMs(10, noJitter)).toBe(MAX_BACKOFF_MS);
    expect(computeBackoffMs(20, noJitter)).toBe(MAX_BACKOFF_MS);
    expect(computeBackoffMs(100, noJitter)).toBe(MAX_BACKOFF_MS);
  });

  it('applies jitter at the negative extreme (random=0) and positive extreme (random=1)', () => {
    // random=0 → jitter = -JITTER_FACTOR; random=1 → jitter = +JITTER_FACTOR
    const minJitter = () => 0;
    const maxJitter = () => 1;
    const baseAtAttempt2 = INITIAL_BACKOFF_MS * BACKOFF_MULTIPLIER ** 2;
    expect(computeBackoffMs(2, minJitter)).toBe(
      Math.round(baseAtAttempt2 * (1 - JITTER_FACTOR)),
    );
    expect(computeBackoffMs(2, maxJitter)).toBe(
      Math.round(baseAtAttempt2 * (1 + JITTER_FACTOR)),
    );
  });

  it('never returns a negative delay even at the negative-jitter extreme', () => {
    const minJitter = () => 0;
    for (let attempt = 0; attempt < 30; attempt++) {
      expect(computeBackoffMs(attempt, minJitter)).toBeGreaterThanOrEqual(0);
    }
  });
});

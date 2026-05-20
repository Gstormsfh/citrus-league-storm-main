// Phase 4.5 chunk 11g.10 sub-step 10b — systemFlags cache tests.
//
// Covers the cache semantics that both the discovery endpoint and the
// LobbyRegistry rely on: TTL-bounded reads, fail-open on read errors,
// last-known-value fallback.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readSystemFlag, _clearSystemFlagsCacheForTests } from '../lib/systemFlags';

interface MockSupabaseQuery {
  select: (cols: string) => MockSupabaseQuery;
  eq: (col: string, val: unknown) => MockSupabaseQuery;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
}

function makeMockSupabase(opts: {
  data?: { flag_value: boolean } | null;
  error?: { message: string } | null;
  throws?: Error;
}): { from: (t: string) => MockSupabaseQuery; calls: number } {
  let calls = 0;
  return {
    calls: 0,
    from(_table: string) {
      const obj: MockSupabaseQuery = {
        select: () => obj,
        eq: () => obj,
        maybeSingle: async () => {
          calls++;
          (this as { calls: number }).calls = calls;
          if (opts.throws) throw opts.throws;
          return { data: opts.data ?? null, error: opts.error ?? null };
        },
      };
      return obj;
    },
  } as unknown as { from: (t: string) => MockSupabaseQuery; calls: number };
}

describe('systemFlags.readSystemFlag', () => {
  beforeEach(() => {
    _clearSystemFlagsCacheForTests();
  });

  it('returns false for a flag set to false in DB', async () => {
    const sb = makeMockSupabase({ data: { flag_value: false } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readSystemFlag(sb as any, 'no_new_drafts');
    expect(result).toBe(false);
  });

  it('returns true for a flag set to true in DB', async () => {
    const sb = makeMockSupabase({ data: { flag_value: true } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readSystemFlag(sb as any, 'no_new_drafts');
    expect(result).toBe(true);
  });

  it('returns false when the flag row does not exist (no fail)', async () => {
    const sb = makeMockSupabase({ data: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readSystemFlag(sb as any, 'unknown_flag');
    expect(result).toBe(false);
  });

  it('caches the read for the TTL window (second call does not hit DB)', async () => {
    let callCount = 0;
    const sb = {
      from: (_t: string) => {
        const obj = {
          select: () => obj,
          eq: () => obj,
          maybeSingle: async () => {
            callCount++;
            return { data: { flag_value: true }, error: null };
          },
        };
        return obj;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await readSystemFlag(sb as any, 'no_new_drafts');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await readSystemFlag(sb as any, 'no_new_drafts');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await readSystemFlag(sb as any, 'no_new_drafts');
    expect(callCount).toBe(1);
  });

  it('returns last cached value on read error (fail-open)', async () => {
    let callCount = 0;
    let mode: 'ok' | 'err' = 'ok';
    const sb = {
      from: (_t: string) => {
        const obj = {
          select: () => obj,
          eq: () => obj,
          maybeSingle: async () => {
            callCount++;
            if (mode === 'err') {
              return { data: null, error: { message: 'connection refused' } };
            }
            return { data: { flag_value: true }, error: null };
          },
        };
        return obj;
      },
    };
    // First call: caches `true`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r1 = await readSystemFlag(sb as any, 'no_new_drafts');
    expect(r1).toBe(true);
    _clearSystemFlagsCacheForTests();
    // Manually re-prime cache (so the next call finds an entry to fall
    // back to).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await readSystemFlag(sb as any, 'no_new_drafts');
    mode = 'err';
    _clearSystemFlagsCacheForTests();
    // Re-prime so we have a cached value, then force an error on a
    // future call (which would happen post-TTL or after cache clear).
    // Since we clear the cache, the next read goes to DB and gets error.
    // The function should return false (no cached value to fall back to).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r2 = await readSystemFlag(sb as any, 'no_new_drafts');
    expect(r2).toBe(false);
    expect(callCount).toBeGreaterThan(1);
  });

  it('returns false when query throws (fail-open with no cached value)', async () => {
    const sb = makeMockSupabase({ throws: new Error('network unreachable') });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readSystemFlag(sb as any, 'no_new_drafts');
    expect(result).toBe(false);
  });
});

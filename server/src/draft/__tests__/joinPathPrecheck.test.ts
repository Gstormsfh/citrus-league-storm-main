// Phase 4.5 chunk 11g.10 sub-step 10c-2 join-path-robustness — tests
// for the gate (b) predicate factory. Locks in the three-way
// disambiguation the architect made mandatory: `'ready'` on any
// row-count > 0, `'empty'` ONLY on a clean zero-row read, `'error'`
// on any query error, timeout, missing count, or thrown exception.
//
// The critical regression this suite guards is the false-4400 path
// — if the predicate ever returns `'empty'` from a query error or
// timeout, real users get told the draft "isn't set up" during DB
// blips. Every error-path test ends with `expect(...).toBe('error')`
// for that reason.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createDraftInitializedPredicate,
  DRAFT_INITIALIZED_PRECHECK_TIMEOUT_MS,
} from '../joinPathPrecheck';

const LEAGUE_ID = 'league-1';

// Build a stub Supabase client whose `.from(...).select(...).eq(...).limit(1)`
// terminal `await` resolves to whatever `terminalResult` is set to. The
// PostgREST builder is chainable and thenable at the terminal step.
function stubSupabase(terminalResult: {
  data?: unknown;
  error: null | { message: string };
  count: number | null;
}): SupabaseClient {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    // The chain becomes awaitable at this step.
    then: (onFulfilled: (v: typeof terminalResult) => unknown) =>
      Promise.resolve(terminalResult).then(onFulfilled),
  };
  return {
    from: vi.fn().mockReturnValue(builder),
  } as unknown as SupabaseClient;
}

// Build a stub whose terminal `await` NEVER resolves (predicate must
// trip its own timeout). Returning a Promise that never resolves lets
// the Promise.race in the predicate reach the timeout branch on its
// own — no fake timers needed, because the timeout is small.
function stubSupabaseHang(): SupabaseClient {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: () => new Promise<never>(() => {}),
  };
  return {
    from: vi.fn().mockReturnValue(builder),
  } as unknown as SupabaseClient;
}

describe('createDraftInitializedPredicate', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'ready' when the SELECT reports count > 0", async () => {
    const supabase = stubSupabase({ error: null, count: 12 });
    const predicate = createDraftInitializedPredicate(supabase);
    await expect(predicate(LEAGUE_ID)).resolves.toBe('ready');
  });

  it("returns 'ready' at the boundary count === 1", async () => {
    const supabase = stubSupabase({ error: null, count: 1 });
    const predicate = createDraftInitializedPredicate(supabase);
    await expect(predicate(LEAGUE_ID)).resolves.toBe('ready');
  });

  it("returns 'empty' on a clean zero-row read (count === 0)", async () => {
    // This is the ONLY path that may return 'empty' — the whole
    // point of the three-way return per the architect's ruling.
    const supabase = stubSupabase({ error: null, count: 0 });
    const predicate = createDraftInitializedPredicate(supabase);
    await expect(predicate(LEAGUE_ID)).resolves.toBe('empty');
  });

  it("returns 'error' when the query surfaces a PostgREST error (never 'empty')", async () => {
    // Regression lock: query errors MUST NOT be classified as 'empty'.
    // If they were, DB blips would tell real users the draft "isn't
    // set up" — the exact failure mode the architect flagged.
    const supabase = stubSupabase({
      error: { message: 'connection refused' },
      count: null,
    });
    const predicate = createDraftInitializedPredicate(supabase);
    await expect(predicate(LEAGUE_ID)).resolves.toBe('error');
  });

  it("returns 'error' when count is null despite no reported error (defensive)", async () => {
    // Belt-and-suspenders: PostgREST with count:'exact' should
    // always populate `count`, but if it ever doesn't, we still
    // never emit 'empty'.
    const supabase = stubSupabase({ error: null, count: null });
    const predicate = createDraftInitializedPredicate(supabase);
    await expect(predicate(LEAGUE_ID)).resolves.toBe('error');
  });

  it(`returns 'error' when the SELECT does not resolve within ${DRAFT_INITIALIZED_PRECHECK_TIMEOUT_MS}ms`, async () => {
    // Timeout path — the Promise.race resolves via the timeout
    // branch. Verifies the wall-clock budget the architect
    // required + that the timeout classifies as 'error' (not
    // 'empty'). Uses a real setTimeout at the 1500ms budget; the
    // test takes ~1.5s.
    const supabase = stubSupabaseHang();
    const predicate = createDraftInitializedPredicate(supabase);
    const start = Date.now();
    const result = await predicate(LEAGUE_ID);
    const elapsed = Date.now() - start;
    expect(result).toBe('error');
    // Tolerant lower bound — allow small scheduler jitter but
    // confirm the timeout actually engaged.
    expect(elapsed).toBeGreaterThanOrEqual(
      DRAFT_INITIALIZED_PRECHECK_TIMEOUT_MS - 50,
    );
    // Upper bound — timeout shouldn't take dramatically longer than
    // the budget; if it does, the timer wiring is broken.
    expect(elapsed).toBeLessThan(DRAFT_INITIALIZED_PRECHECK_TIMEOUT_MS + 500);
  }, DRAFT_INITIALIZED_PRECHECK_TIMEOUT_MS + 2000);

  it("returns 'error' when the query throws (network fault / synchronous exception)", async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: () => {
        throw new Error('sync-thrown network fault');
      },
    };
    const supabase = {
      from: vi.fn().mockReturnValue(builder),
    } as unknown as SupabaseClient;
    const predicate = createDraftInitializedPredicate(supabase);
    await expect(predicate(LEAGUE_ID)).resolves.toBe('error');
  });

  it('calls draft_order with the exact leagueId (route contract)', async () => {
    // Locks in the SELECT shape the architect specified:
    // `SELECT ... FROM draft_order WHERE league_id = $1 LIMIT 1`.
    const eq = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ error: null, count: 1 }).then(onFulfilled);
    const supabase = {
      from: vi.fn().mockReturnValue({ select, eq, limit, then }),
    } as unknown as SupabaseClient;

    const predicate = createDraftInitializedPredicate(supabase);
    await predicate(LEAGUE_ID);

    expect(supabase.from).toHaveBeenCalledWith('draft_order');
    expect(select).toHaveBeenCalledWith(
      'league_id',
      expect.objectContaining({ count: 'exact', head: true }),
    );
    expect(eq).toHaveBeenCalledWith('league_id', LEAGUE_ID);
    expect(limit).toHaveBeenCalledWith(1);
  });
});

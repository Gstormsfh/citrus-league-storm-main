import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createChain, createMockSupabase } from './helpers';

// Mock the supabase factory + auth middleware before importing the app.
vi.mock('../lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
  createUserClient: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'u-test');
    c.set('userToken', 'tok');
    await next();
  },
}));

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

afterEach(() => vi.clearAllMocks());

/**
 * Pick-lock logic regression coverage for POST /api/playoff-pools/bracket-pickem/picks.
 *
 * Lock-mode contract (deadline-only for full-bracket, matching Yahoo/ESPN/CBS):
 *   - round-by-round (default): any non-pending series locks its slot.
 *   - full-bracket (before lock deadline): NOTHING locks. Users can pick any
 *     series including finalized ones (deadline is the only authoritative gate).
 *   - full-bracket (after lock deadline): everything non-pending locks.
 *
 * The frontend at PoolPlayoffBracket.tsx:166-171 mirrors this logic. The
 * server must agree or it rejects picks the UI accepted.
 */
describe('POST /api/playoff-pools/bracket-pickem/picks — pick lock logic', () => {
  it('full-bracket mode (before lock): allows ALL series including finals (deadline-only)', async () => {
    const { supabaseAdmin, createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const futureLock = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    (supabaseAdmin.from as any).mockImplementation((tbl: string) => {
      if (tbl === 'leagues') {
        return createChain({
          data: {
            settings: {
              playoffBracketPickMode: 'full-bracket',
              playoffRosterLockedAt: futureLock,
            },
          },
          error: null,
        });
      }
      // nhl_playoff_series — even if slot 3 is final, full-bracket pre-deadline
      // short-circuits the lock query so this mock data should never be consulted.
      return createChain({ data: [{ bracket_slot: 3 }], error: null });
    });

    (createUserClient as any).mockReturnValue(
      createMockSupabase({
        playoff_bracket_picks: createChain({
          data: [
            { id: 1, series_slot: 1, picked_team_id: 7 },
            { id: 2, series_slot: 3, picked_team_id: 12 },
          ],
          error: null,
        }),
      })
    );

    const res = await app.request('/api/playoff-pools/bracket-pickem/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({
        leagueId: 'lg1',
        picks: [
          { series_slot: 1, picked_team_id: 7 },  // active R1 — allowed
          { series_slot: 3, picked_team_id: 12 }, // final R1 — also allowed pre-deadline
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.picks).toHaveLength(2);
  });

  it('round-by-round mode: rejects all non-pending series (legacy behavior)', async () => {
    const { supabaseAdmin, createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    (supabaseAdmin.from as any).mockImplementation((tbl: string) => {
      if (tbl === 'leagues') {
        return createChain({
          data: { settings: { playoffBracketPickMode: 'round-by-round' } },
          error: null,
        });
      }
      // nhl_playoff_series — slots 1 (active) + 3 (final) both locked in r-b-r
      return createChain({ data: [{ bracket_slot: 1 }, { bracket_slot: 3 }], error: null });
    });

    (createUserClient as any).mockReturnValue(createMockSupabase());

    const res = await app.request('/api/playoff-pools/bracket-pickem/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({
        leagueId: 'lg1',
        picks: [{ series_slot: 1, picked_team_id: 7 }], // active R1 — rejected in r-b-r
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/locked/);
  });

  it('full-bracket mode (after global lock): rejects all non-pending series', async () => {
    const { supabaseAdmin, createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const pastLock = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    (supabaseAdmin.from as any).mockImplementation((tbl: string) => {
      if (tbl === 'leagues') {
        return createChain({
          data: {
            settings: {
              playoffBracketPickMode: 'full-bracket',
              playoffRosterLockedAt: pastLock,
            },
          },
          error: null,
        });
      }
      return createChain({ data: [{ bracket_slot: 1 }], error: null });
    });

    (createUserClient as any).mockReturnValue(createMockSupabase());

    const res = await app.request('/api/playoff-pools/bracket-pickem/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({
        leagueId: 'lg1',
        picks: [{ series_slot: 1, picked_team_id: 7 }], // active R1 rejected post-lock
      }),
    });

    expect(res.status).toBe(400);
  });
});

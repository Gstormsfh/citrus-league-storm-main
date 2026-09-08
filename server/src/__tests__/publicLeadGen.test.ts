import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createChain, createMockSupabase } from './helpers';

vi.mock('../lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
  createUserClient: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});
afterEach(() => vi.clearAllMocks());

/**
 * LEAD GEN BEFORE THE APP IS LIVE (2026-09-09).
 *  - POST /api/public/waitlist with metadata merges into an existing row
 *    instead of bouncing off UNIQUE(email).
 *  - GET /api/public/schedule/opening-night answers the first scheduled date
 *    on or after today, and {date: null, games: []} when none is loaded.
 */
function post(app: any, body: unknown) {
  return app.request('/api/public/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/public/waitlist with metadata', () => {
  it('merges the payload into an existing waitlist row under its source', async () => {
    const { getSupabaseAdmin } = await import('../lib/supabase');
    const { app } = await import('../app');
    const waitlist = createChain({ data: { id: 'w1', metadata: { 'opening-night-pickem': { picks: [] } } }, error: null });
    (getSupabaseAdmin as any).mockReturnValue(createMockSupabase({ waitlist }));

    const res = await post(app, { email: 'G@X.com', source: 'bring-your-league', metadata: { leagueName: 'Pond' } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.success).toBe(true);
    expect(waitlist.update).toHaveBeenCalledTimes(1);
    expect(waitlist.insert).not.toHaveBeenCalled();
    const patch = (waitlist.update as any).mock.calls[0][0];
    expect(Object.keys(patch.metadata).sort()).toEqual(['bring-your-league', 'opening-night-pickem']);
    expect(patch.metadata['bring-your-league'].leagueName).toBe('Pond');
  });

  it('inserts a new row with the payload when the email is new', async () => {
    const { getSupabaseAdmin } = await import('../lib/supabase');
    const { app } = await import('../app');
    const waitlist = createChain({ data: null, error: null });
    (getSupabaseAdmin as any).mockReturnValue(createMockSupabase({ waitlist }));

    const res = await post(app, { email: 'new@x.com', source: 'opening-night-pickem', metadata: { date: '2026-10-07', picks: [{ game_id: 1, pick: 'EDM' }] } });
    expect(res.status).toBe(200);
    expect(waitlist.insert).toHaveBeenCalledTimes(1);
    const row = (waitlist.insert as any).mock.calls[0][0];
    expect(row.email).toBe('new@x.com');
    expect(row.metadata['opening-night-pickem'].picks[0].pick).toBe('EDM');
  });

  it('refuses an oversized payload rather than storing it', async () => {
    const { getSupabaseAdmin } = await import('../lib/supabase');
    const { app } = await import('../app');
    const waitlist = createChain({ data: null, error: null });
    (getSupabaseAdmin as any).mockReturnValue(createMockSupabase({ waitlist }));

    const res = await post(app, { email: 'new@x.com', source: 'x', metadata: { blob: 'y'.repeat(5000) } });
    expect(res.status).toBe(200);
    // Oversized metadata is dropped: the plain insert path runs without it.
    const row = (waitlist.insert as any).mock.calls[0][0];
    expect(row.metadata).toBeUndefined();
  });
});

describe('GET /api/public/schedule/opening-night', () => {
  it('answers null with no scheduled games loaded', async () => {
    const { getSupabaseAdmin } = await import('../lib/supabase');
    const { app } = await import('../app');
    (getSupabaseAdmin as any).mockReturnValue(createMockSupabase({ nhl_games: createChain({ data: null, error: null }) }));
    const res = await app.request('/api/public/schedule/opening-night');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ date: null, games: [] });
  });
});

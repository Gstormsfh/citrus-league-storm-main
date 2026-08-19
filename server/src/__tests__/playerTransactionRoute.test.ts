import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createMockSupabase } from './helpers';

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
 * POST /api/players/transaction — the trending write path.
 *
 * 2026-08-18 launch audit: this route did not exist. The frontend has
 * called it on every free-agent add since the feature shipped, and
 * PlayerService's try/catch swallowed the resulting 404 every time.
 * Verified against prod: public.player_transactions had 0 rows lifetime,
 * so GET /trending (which reads get_trending_players() over that table)
 * has always rendered an empty set.
 *
 * These tests lock the contract so it cannot silently regress again.
 */
const VALID = {
  playerId: 8479318,
  leagueId: '11111111-1111-1111-1111-111111111111',
  teamId: '22222222-2222-2222-2222-222222222222',
  transactionType: 'add',
  source: 'free-agents',
  playerName: 'Auston Matthews',
  playerTeam: 'TOR',
  playerPosition: 'C',
};

function post(app: any, body: unknown) {
  return app.request('/api/players/transaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/players/transaction', () => {
  it('exists (does NOT 404) and inserts a row', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const insert = vi.fn().mockResolvedValue({ error: null });
    const mock = createMockSupabase();
    mock.from = vi.fn(() => ({ insert }));
    (createUserClient as any).mockReturnValue(mock);

    const res = await post(app, VALID);

    // The regression that mattered: this used to be 404.
    expect(res.status).toBe(200);
    expect(mock.from).toHaveBeenCalledWith('player_transactions');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('takes user_id from the JWT, never from the request body', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const insert = vi.fn().mockResolvedValue({ error: null });
    const mock = createMockSupabase();
    mock.from = vi.fn(() => ({ insert }));
    (createUserClient as any).mockReturnValue(mock);

    // A caller trying to attribute the transaction to somebody else.
    await post(app, { ...VALID, user_id: 'someone-else', userId: 'someone-else' });

    const row = insert.mock.calls[0][0];
    expect(row.user_id).toBe('u-test');
  });

  it('maps every field onto the player_transactions column names', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const insert = vi.fn().mockResolvedValue({ error: null });
    const mock = createMockSupabase();
    mock.from = vi.fn(() => ({ insert }));
    (createUserClient as any).mockReturnValue(mock);

    await post(app, VALID);

    expect(insert.mock.calls[0][0]).toEqual({
      player_id: 8479318,
      league_id: VALID.leagueId,
      team_id: VALID.teamId,
      user_id: 'u-test',
      transaction_type: 'add',
      source: 'free-agents',
      player_name: 'Auston Matthews',
      player_team: 'TOR',
      player_position: 'C',
    });
  });

  it('accepts drop as well as add', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const insert = vi.fn().mockResolvedValue({ error: null });
    const mock = createMockSupabase();
    mock.from = vi.fn(() => ({ insert }));
    (createUserClient as any).mockReturnValue(mock);

    const res = await post(app, { ...VALID, transactionType: 'drop' });
    expect(res.status).toBe(200);
    expect(insert.mock.calls[0][0].transaction_type).toBe('drop');
  });

  it('rejects a bad transactionType without touching the database', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const insert = vi.fn();
    const mock = createMockSupabase();
    mock.from = vi.fn(() => ({ insert }));
    (createUserClient as any).mockReturnValue(mock);

    const res = await post(app, { ...VALID, transactionType: 'trade' });
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a missing playerId and a missing leagueId/teamId', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const insert = vi.fn();
    const mock = createMockSupabase();
    mock.from = vi.fn(() => ({ insert }));
    (createUserClient as any).mockReturnValue(mock);

    const noPlayer = await post(app, { ...VALID, playerId: 'nope' });
    expect(noPlayer.status).toBe(400);

    const noLeague = await post(app, { ...VALID, leagueId: undefined });
    expect(noLeague.status).toBe(400);

    expect(insert).not.toHaveBeenCalled();
  });

  it('optional descriptive fields become null rather than the string "undefined"', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const insert = vi.fn().mockResolvedValue({ error: null });
    const mock = createMockSupabase();
    mock.from = vi.fn(() => ({ insert }));
    (createUserClient as any).mockReturnValue(mock);

    await post(app, {
      playerId: 1,
      leagueId: VALID.leagueId,
      teamId: VALID.teamId,
      transactionType: 'add',
    });

    const row = insert.mock.calls[0][0];
    expect(row.source).toBeNull();
    expect(row.player_name).toBeNull();
    expect(row.player_team).toBeNull();
    expect(row.player_position).toBeNull();
  });

  it('surfaces a database error instead of reporting success', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');

    const insert = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } });
    const mock = createMockSupabase();
    mock.from = vi.fn(() => ({ insert }));
    (createUserClient as any).mockReturnValue(mock);

    const res = await post(app, VALID);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

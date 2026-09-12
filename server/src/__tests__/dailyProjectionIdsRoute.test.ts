import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { schemas } from '../middleware/validate';

const mocks = vi.hoisted(() => ({ read: vi.fn(), client: vi.fn() }));
vi.mock('../lib/supabase', () => ({ createUserClient: mocks.client, getSupabaseAdmin: vi.fn() }));
vi.mock('../services/MatchupService', () => ({ MatchupService: class {
  getDailyProjections = mocks.read;
} }));
vi.mock('../middleware/auth', () => ({ authMiddleware: async (c: any, next: any) => {
  if (!c.req.header('Authorization')) return c.json({ error: 'Unauthorized' }, 401);
  c.set('userToken', 'test-session');
  await next();
} }));
import { matchupRoutes } from '../routes/matchups';

const app = new Hono().route('/api/matchups', matchupRoutes);
const request = (playerIds: unknown[], date = '2026-09-27', authenticated = true) => app.request('/api/matchups/projections/daily', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-session' } : {}) },
  body: JSON.stringify({ playerIds, date }),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ projMap: new Map([[8478402, { player_id: 8478402, projected_plus_minus: -0.25 }]]), error: null });
});

describe('daily projection ID compatibility boundary', () => {
  it('normalizes observed native digit-string IDs and deduplicates before the service', async () => {
    const res = await request(['8478402', '8480069', '8484801', 8478402]);
    expect(res.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith([8478402, 8480069, 8484801], '2026-09-27');
    expect(mocks.client).toHaveBeenCalledWith('test-session');
    expect((await res.json()).data['8478402'].projected_plus_minus).toBe(-0.25);
  });
  it('preserves numeric callers and the maximum PostgreSQL integer', async () => {
    expect((await request([8478402, 2147483647])).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith([8478402, 2147483647], '2026-09-27');
  });
  it.each([true, false, null, '', ' ', '1e3', '0x10', '1.5', 'bad', '0', '-1', 0, -1, 1.5, 2147483648, '2147483648', '9007199254740993'])('rejects invalid ID %j before querying', async id => {
    expect((await request([id])).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('preserves required nonempty player array and date', async () => {
    expect((await request([])).status).toBe(400);
    expect((await request([8478402], '')).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('retains the route authentication boundary', async () => {
    expect((await request(['8478402'], '2026-09-27', false)).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('does not expand the shared player-ID schema used by other routes', () => {
    expect(schemas.matchupPlayerIds.safeParse({ playerIds: ['8478402'], date: '2026-09-27' }).success).toBe(false);
  });
});

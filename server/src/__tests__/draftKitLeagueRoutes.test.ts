import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../app';
const getBoard = vi.hoisted(() => vi.fn());
vi.mock('../middleware/auth', () => ({ authMiddleware: async (c: any, next: () => Promise<void>) => {
  c.set('userId', 'verified-user'); c.set('userToken', 'verified-token'); await next();
} }));
vi.mock('../lib/supabase', () => ({ createUserClient: vi.fn(() => ({})) }));
vi.mock('../services/DraftKitService', () => ({ DraftKitService: class {
  getBoard = getBoard;
} }));
import { draftKitRoutes } from '../routes/draftKit';
const app = new Hono<Env>().route('/api/draft-kit', draftKitRoutes);
beforeEach(() => { getBoard.mockReset().mockResolvedValue({ board: { cards: [] }, error: null }); });
describe('Draft Kit league request boundary', () => {
  it('passes the verified caller identity and requested league, ignoring forged user query', async () => {
    const leagueId = '11111111-1111-1111-1111-111111111111';
    const response = await app.request(`/api/draft-kit/board?leagueId=${leagueId}&userId=forged`);
    expect(response.status).toBe(200);
    expect(getBoard).toHaveBeenCalledWith({ leagueId, userId: 'verified-user' });
  });
  it('preserves the no-league default route', async () => {
    expect((await app.request('/api/draft-kit/board')).status).toBe(200);
    expect(getBoard).toHaveBeenCalledWith(undefined);
  });
  it.each(['bad', ''])('rejects malformed league scope %s before board assembly', async (leagueId) => {
    expect((await app.request(`/api/draft-kit/board?leagueId=${leagueId}`)).status).toBe(400);
    expect(getBoard).not.toHaveBeenCalled();
  });
});

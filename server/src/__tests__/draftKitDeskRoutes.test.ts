import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn(), log: vi.fn() }));
vi.mock('../middleware/auth', () => ({ authMiddleware: async (c: any, next: any) => {
  if (c.req.header('authorization') !== 'Bearer test') return c.json({ error: 'Unauthorized' }, 401);
  c.set('userId', 'buyer'); c.set('userToken', 'test'); await next();
} }));
vi.mock('../middleware/rateLimit', () => ({ rateLimitMiddleware: () => async (_c: any, next: any) => next() }));
vi.mock('../lib/supabase', () => ({ createUserClient: () => ({}) }));
vi.mock('../services/DraftKitDeskService', () => ({ DraftKitDeskService: class { open = mocks.open; save = mocks.save; } }));
vi.mock('../services/AuditService', () => ({ AuditService: class { log = mocks.log; } }));
import { draftKitDeskRoutes } from '../routes/draftKitDesk';
const app = new Hono().route('/desk', draftKitDeskRoutes);
const league = '11111111-1111-4111-8111-111111111111';
const path = `/desk/league/${league}`;
const headers = { authorization: 'Bearer test', 'Content-Type': 'application/json' };
beforeEach(() => { vi.clearAllMocks(); mocks.open.mockResolvedValue({ owned: true }); mocks.save.mockResolvedValue({ version: 1 }); });
describe('Purchased desk API boundary', () => {
  it('requires authentication for both reading and saving', async () => {
    expect((await app.request(path)).status).toBe(401);
    expect((await app.request(path + '/players/canonical%3A1', { method: 'PUT', body: '{}' })).status).toBe(401);
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('returns private no-store data and audits only entitled opens', async () => {
    const response = await app.request(path, { headers });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.open).toHaveBeenCalledWith('buyer', league); expect(mocks.log).toHaveBeenCalledOnce();
  });
  it('accepts only a bounded personal note, not identities, scores or pick state', async () => {
    const body = { note: 'Target', target: true, version: null };
    for (const extra of [{ userId: 'other' }, { drafted: true }, { weights: {} }, { note: 'x'.repeat(501) }, { version: -1 }]) {
      expect((await app.request(path + '/players/canonical%3A1', { method: 'PUT', headers, body: JSON.stringify({ ...body, ...extra }) })).status).toBe(400);
    }
    expect(mocks.save).not.toHaveBeenCalled();
    expect((await app.request(path + '/players/canonical%3A1', { method: 'PUT', headers, body: JSON.stringify(body) })).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith('buyer', league, 'canonical:1', body);
  });
  it('rejects invalid league and player identifiers before service calls', async () => {
    expect((await app.request('/desk/league/invalid', { headers })).status).toBe(400);
    expect((await app.request(path + '/players/not-a-player', { headers, method: 'PUT', body: JSON.stringify({ note: '', target: false, version: null }) })).status).toBe(400);
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
});

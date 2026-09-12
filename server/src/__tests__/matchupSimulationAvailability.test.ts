import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn(), admin: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), visible: vi.fn() }));
vi.mock('../lib/supabase', () => ({ createUserClient: mocks.client, getSupabaseAdmin: mocks.admin }));
vi.mock('../middleware/auth', () => ({ authMiddleware: async (c: any, next: any) => {
  if (!c.req.header('Authorization')) return c.json({ error: 'Unauthorized' }, 401);
  c.set('userToken', 'test-session');
  await next();
} }));
import { matchupRoutes } from '../routes/matchups';

const app = new Hono().route('/api/matchups', matchupRoutes);
const id = '576e3b64-229d-49c1-9498-2e4d2be36731';
const request = (authenticated = true) => app.request(`/api/matchups/${id}/simulation`, {
  headers: authenticated ? { Authorization: 'Bearer test-session' } : {},
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockReturnValue({ rpc: mocks.rpc, from: mocks.from });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.visible });
  mocks.visible.mockResolvedValue({ data: { id }, error: null });
});

describe('optional matchup simulation availability', () => {
  it.each(['PGRST202', '42P01'])('returns no stored simulation for missing optional dependency %s', async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'Optional simulation dependency missing' } });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_matchup_simulation', { p_matchup_id: id });
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith('test-session');
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledWith('matchups');
    expect(mocks.select).toHaveBeenCalledWith('id');
    expect(mocks.eq).toHaveBeenCalledWith('id', id);
    expect(mocks.visible.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  });

  it('retains the normal no-row response', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await (await request()).json()).toEqual({ data: [] });
  });

  it('returns stored simulation values without recalculation or zero filling', async () => {
    const data = [{ win_probability: 0, margin_mean: -12.5, simulation_details: null }];
    mocks.rpc.mockResolvedValue({ data, error: null });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data });
  });

  it.each(['42501', '57014', 'XX000', 'PGRST203'])('keeps genuine or ambiguous failure %s as an error', async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'Operation failed' } });
    const response = await request();
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
  });

  it('does not call the definer RPC for a nonexistent or RLS-inaccessible matchup', async () => {
    mocks.visible.mockResolvedValue({ data: null, error: null });
    const response = await request();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('does not hide a genuine visibility lookup failure as absent simulation', async () => {
    mocks.visible.mockResolvedValue({ data: null, error: { code: '57014', message: 'Query timed out' } });
    const response = await request();
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires authentication before calling the user-scoped RPC', async () => {
    expect((await request(false)).status).toBe(401);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});

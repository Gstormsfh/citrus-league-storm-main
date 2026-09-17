import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createChain } from './helpers';

/**
 * AUTODRAFT THAT SURVIVES A CLOSED TAB (2026-09-14): the flag lives on
 * teams.autodraft_enabled and only the owner may set it.
 */
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  admin: vi.fn(),
  teamsUser: null as any,
  teamsAdmin: null as any,
  audit: vi.fn(),
  membership: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  createUserClient: mocks.client,
  getSupabaseAdmin: mocks.admin,
  supabaseAdmin: { from: vi.fn() },
}));
vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    if (!c.req.header('Authorization')) return c.json({ error: 'Unauthorized' }, 401);
    c.set('userId', 'u-owner');
    c.set('userToken', 'tok');
    await next();
  },
}));
vi.mock('../middleware/membership', () => ({
  membershipMiddleware: async (c: any, next: any) => mocks.membership(c, next),
}));
vi.mock('../services/AuditService', () => ({
  AuditService: class { log = mocks.audit; },
}));

import { draftV2AutodraftRoutes } from '../routes/draftV2Autodraft';

const app = new Hono().route('/api/draft/v2', draftV2AutodraftRoutes);
const LEAGUE = '11111111-1111-1111-1111-111111111111';
const TEAM = '22222222-2222-2222-2222-222222222222';
const url = `/api/draft/v2/league/${LEAGUE}/teams/${TEAM}/autodraft`;
const headers = { Authorization: 'Bearer tok', 'Content-Type': 'application/json' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membership.mockImplementation(async (_c: any, next: any) => next());
  mocks.teamsUser = createChain({ data: { id: TEAM, owner_id: 'u-owner', autodraft_enabled: false }, error: null });
  mocks.teamsAdmin = createChain({ data: null, error: null });
  mocks.client.mockReturnValue({ from: vi.fn(() => mocks.teamsUser) });
  mocks.admin.mockReturnValue({ from: vi.fn(() => mocks.teamsAdmin) });
  mocks.audit.mockResolvedValue(undefined);
});

describe('GET/PUT autodraft', () => {
  it('reads the flag for the owner', async () => {
    mocks.teamsUser = createChain({ data: { id: TEAM, owner_id: 'u-owner', autodraft_enabled: true }, error: null });
    mocks.client.mockReturnValue({ from: vi.fn(() => mocks.teamsUser) });
    const res = await app.request(url, { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { enabled: true } });
    expect(mocks.teamsUser.eq).toHaveBeenCalledWith('id', TEAM);
    expect(mocks.teamsUser.eq).toHaveBeenCalledWith('league_id', LEAGUE);
  });

  it('writes the flag through the admin client after the ownership check, and audits it', async () => {
    const res = await app.request(url, { method: 'PUT', headers, body: JSON.stringify({ enabled: true }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { enabled: true } });
    expect(mocks.teamsAdmin.update).toHaveBeenCalledWith({ autodraft_enabled: true });
    expect(mocks.teamsAdmin.eq).toHaveBeenCalledWith('id', TEAM);
    expect(mocks.teamsAdmin.eq).toHaveBeenCalledWith('league_id', LEAGUE);
    expect(mocks.audit).toHaveBeenCalledWith('DRAFT_AUTODRAFT_TOGGLED', LEAGUE, expect.objectContaining({ teamId: TEAM, enabled: true, userId: 'u-owner' }));
    // ownership was read before the write
    expect(mocks.teamsUser.maybeSingle.mock.invocationCallOrder[0]).toBeLessThan(mocks.teamsAdmin.update.mock.invocationCallOrder[0]);
  });

  it('refuses a member who does not own the team, and never writes', async () => {
    mocks.teamsUser = createChain({ data: { id: TEAM, owner_id: 'someone-else', autodraft_enabled: false }, error: null });
    mocks.client.mockReturnValue({ from: vi.fn(() => mocks.teamsUser) });
    const res = await app.request(url, { method: 'PUT', headers, body: JSON.stringify({ enabled: true }) });
    expect(res.status).toBe(403);
    expect(mocks.teamsAdmin.update).not.toHaveBeenCalled();
  });

  it('404s a team outside the league (the league filter is part of the lookup)', async () => {
    mocks.teamsUser = createChain({ data: null, error: null });
    mocks.client.mockReturnValue({ from: vi.fn(() => mocks.teamsUser) });
    const res = await app.request(url, { method: 'PUT', headers, body: JSON.stringify({ enabled: false }) });
    expect(res.status).toBe(404);
    expect(mocks.teamsAdmin.update).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean body', async () => {
    const res = await app.request(url, { method: 'PUT', headers, body: JSON.stringify({ enabled: 'yes' }) });
    expect(res.status).toBe(400);
  });

  it('runs membership before ownership', async () => {
    mocks.membership.mockImplementation(async (c: any) => c.json({ error: { code: 'FORBIDDEN' } }, 403));
    const res = await app.request(url, { headers });
    expect(res.status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    expect((await app.request(url)).status).toBe(401);
  });
});

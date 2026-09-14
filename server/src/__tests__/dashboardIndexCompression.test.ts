import { Hono } from 'hono';
import { gunzipSync, inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerDashboardService } from '../services/PlayerDashboardService';
import { createUserClient } from '../lib/supabase';
import { playerRoutes } from '../routes/players';

vi.mock('../lib/supabase', () => ({ createUserClient: vi.fn(() => ({})), getSupabaseAdmin: vi.fn(), supabaseAdmin: {} }));
vi.mock('../lib/verifyAccessToken', () => ({ verifyAccessTokenLocally: vi.fn(async () => ({ ok: true, userId: 'transport-fixture' })), isTokenExpiredUnsafe: vi.fn() }));
const fixture = [{ id: 1, name: 'Transport Fixture', team: 'EDM', position: 'C', goals: 0, plus_minus: -12,
  proj_plus_minus: -.25, proj_gp: 0, canonical_context: { run_id: 'published', revision: 'revision',
    opportunity_prior: { probability_semantics: 'already_in_exposure' }, rates: { goals: 0, plus_minus: -.012 },
    sources: [{ url: 'https://www.nhl.com/news/fixture' }], team_notes: ['Reviewed scenario. '.repeat(200)] } }];
function app(headers: Record<string, string> = {}) {
  const application = new Hono();
  application.use('*', async (c, next) => { for (const [key, value] of Object.entries(headers)) c.header(key, value); await next(); });
  application.route('/api/players', playerRoutes);
  application.get('/events', c => c.text('data: unchanged\n\n', 200, { 'Content-Type': 'text/event-stream' }));
  return application;
}
const request = (encoding?: string) => ({ headers: { Authorization: 'Bearer transport-fixture', ...(encoding === undefined ? {} : { 'Accept-Encoding': encoding }) } });
beforeEach(() => { vi.spyOn(PlayerDashboardService.prototype, 'getDashboardIndex').mockResolvedValue({ players: fixture as never, error: null }); });
afterEach(() => vi.restoreAllMocks());

describe('dashboard index route compression', () => {
  it.each([['gzip', 'gzip'], ['deflate;q=1,gzip;q=0.5', 'deflate'], ['gzip;q=0,deflate;q=1', 'deflate'], ['identity', null], ['gzip;q=0,deflate;q=0', null], [undefined, null]] as const)
  ('preserves exact decoded JSON with Accept-Encoding %s', async (accept, expected) => {
    const response = await app().request('/api/players/dashboard-index', request(accept));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe(expected);
    expect(response.headers.get('vary')).toBe('Accept-Encoding');
    const bytes = Buffer.from(await response.arrayBuffer());
    const decoded = expected === 'gzip' ? gunzipSync(bytes) : expected === 'deflate' ? inflateSync(bytes) : bytes;
    expect(decoded.toString()).toBe(JSON.stringify({ data: fixture }));
    if (expected) expect(bytes.byteLength).toBeLessThan(decoded.byteLength);
  });

  it.each(['Origin', 'Origin, Accept-Encoding', '*'])('preserves existing Vary: %s', async vary => {
    const response = await app({ Vary: vary, 'Cache-Control': 'private, max-age=0' }).request('/api/players/dashboard-index', request('gzip'));
    expect(response.headers.get('vary')).toBe(vary === 'Origin' ? 'Origin, Accept-Encoding' : vary);
    expect(response.headers.get('cache-control')).toBe('private, max-age=0');
    await response.arrayBuffer();
  });

  it('keeps auth denial before compression and database access', async () => {
    vi.mocked(createUserClient).mockClear();
    const response = await app().request('/api/players/dashboard-index', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(response.status).toBe(401);
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(PlayerDashboardService.prototype.getDashboardIndex).not.toHaveBeenCalled();
    expect(createUserClient).not.toHaveBeenCalled();
  });

  it('keeps small JSON valid, skips a known below-threshold length, and honors no-transform', async () => {
    vi.mocked(PlayerDashboardService.prototype.getDashboardIndex).mockResolvedValue({ players: [], error: null });
    const small = await app().request('/api/players/dashboard-index', request('gzip'));
    // Hono JSON has no Content-Length: its streaming compressor does not buffer to measure it.
    expect(gunzipSync(Buffer.from(await small.arrayBuffer())).toString()).toBe('{"data":[]}');
    for (const headers of [{ 'Content-Length': '11' }, { 'Cache-Control': 'private, no-transform' }]) {
      const response = await app(headers).request('/api/players/dashboard-index', request('gzip'));
      expect(response.headers.get('content-encoding')).toBeNull();
      expect(await response.json()).toEqual({ data: [] });
    }
  });

  it('does not compress another route or a HEAD response', async () => {
    const application = app();
    const events = await application.request('/events', request('gzip'));
    expect(events.headers.get('content-encoding')).toBeNull();
    expect(await events.text()).toBe('data: unchanged\n\n');
    const head = await application.request('/api/players/dashboard-index', { ...request('gzip'), method: 'HEAD' });
    expect(head.headers.get('content-encoding')).toBeNull();
    expect(await head.text()).toBe('');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createChain } from './helpers';
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ createUserClient: () => ({ from: mocks.from }), getSupabaseAdmin: vi.fn() }));
vi.mock('../middleware/auth', () => ({ authMiddleware: async (c: any, next: any) => { c.set('userToken', 'token'); await next(); } }));
import { playerRoutes } from '../routes/players';
import { getProjectionsSeason } from '@citrus/shared';
const app = new Hono().route('/players', playerRoutes);
const season = getProjectionsSeason();
const pointer = (revision: string) => ({ season, run_id: `run-${revision}`, revision });
const row = (id: number, revision: string) => ({ player_id: id, season, projection_run_id: `run-${revision}`, projection_revision: revision, total_projected_points: -id });
function fixture(pointers: any[], pages: any[]) {
  mocks.from.mockReset(); const rowChains: any[] = []; const pointerChains: any[] = [];
  mocks.from.mockImplementation((table: string) => {
    const chain = createChain({ data: table === 'canonical_published_runs' ? pointers.shift() : pages.shift(), error: null });
    (table === 'canonical_published_runs' ? pointerChains : rowChains).push(chain); return chain;
  });
  return { rowChains, pointerChains };
}
describe('ROS route publication guard', () => {
  it('retries activation during pagination and returns only the stable assembled revision', async () => {
    const rows = (revision: string) => Array.from({ length: 1000 }, (_, i) => row(i + 1, revision));
    const { rowChains, pointerChains } = fixture([pointer('a'), pointer('b'), pointer('b'), pointer('b')], [rows('a'), [row(1001, 'b')], rows('b'), [row(1001, 'b')]]);
    const response = await app.request('/players/ros-projections?limit=1500');
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.data).toHaveLength(1001); expect(body.data.every((r: any) => r.projection_revision === 'b')).toBe(true);
    expect(rowChains).toHaveLength(4); expect(pointerChains).toHaveLength(4);
    for (const chain of rowChains) expect(chain.eq).toHaveBeenCalledWith('season', season);
  });
  it('guards the single-player route and preserves an empty missing result', async () => {
    const { rowChains, pointerChains } = fixture([pointer('a'), pointer('a')], [[]]);
    const response = await app.request('/players/ros-projections?playerId=999');
    expect(response.status).toBe(200); expect((await response.json()).data).toEqual([]);
    expect(rowChains[0].eq).toHaveBeenCalledWith('player_id', 999); expect(pointerChains).toHaveLength(2);
  });
  it('refuses mixed rows after its one retry', async () => {
    fixture(Array.from({ length: 4 }, () => pointer('a')), [[row(1, 'b')], [row(1, 'b')]]);
    const response = await app.request('/players/ros-projections'); expect(response.status).toBe(500);
  });
});

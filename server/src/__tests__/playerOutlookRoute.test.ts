import { describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ outlook: vi.fn(), notes: [{ id: 'stored', kind: 'season-outlook', season: 2026, published_at: '2026-08-25T00:00:00Z', body: 'Old template' }] }));
vi.mock('../lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: (table: string) => {
  const q: any = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: table === 'citrus_news' ? state.notes : [{ full_name: 'Sample Forward' }], error: null }) };
  return q;
} }) }));
vi.mock('../services/NewsRoomService', () => ({ NewsRoomService: class { async forPlayer() { return []; } } }));
vi.mock('../services/PlayerOutlookService', () => ({ PlayerOutlookService: class { forPlayer = state.outlook; } }));
import { newsRoutes } from '../routes/news';

describe('current outlook route', () => {
  it('serves revised compatible prose while retaining original publication time', async () => {
    state.outlook.mockResolvedValue({ kind: 'season-outlook', season: 2026, body: 'Current argument', headline: 'Outlook', analysis: 'Current implication', tags: [], severity: 'info', contentRevision: 'new', editorialVersion: 'version', sourceContext: { newsSources: [] } });
    const response = await newsRoutes.request('/player/1000');
    const payload = await response.json();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(payload.data.notes).toHaveLength(1);
    expect(payload.data.notes[0]).toMatchObject({ id: 'stored', body: 'Current argument', published_at: '2026-08-25T00:00:00Z', content_revision: 'new' });
    expect(payload.data.notes[0].evaluated_at).toBeTruthy();
  });
  it('does not revive obsolete standing prose when current evidence cannot be read', async () => {
    state.outlook.mockRejectedValue(new Error('Publication unavailable'));
    const response = await newsRoutes.request('/player/1000');
    const payload = await response.json();
    expect(payload.data.notes).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pagedSelect } from '../pagedSelect';

/**
 * A PostgREST stand-in that behaves the way the real one does: it answers a
 * `.range(from, to)` window out of a fixed table and never signals that more
 * rows exist. The clamp this helper defends against is invisible from the
 * response, so the fake must be invisible about it too.
 */
type Row = { id: number; team: string; season: number; day: number };

function makeClient(rows: Row[], spy?: { ranges: Array<[number, number]>; orders: string[] }) {
  const build = () => {
    let data = [...rows];
    const q: Record<string, unknown> = {};
    q.eq = (c: string, v: unknown) => { data = data.filter((r) => (r as never as Record<string, unknown>)[c] === v); return q; };
    q.in = (c: string, vs: unknown[]) => { data = data.filter((r) => vs.includes((r as never as Record<string, unknown>)[c])); return q; };
    q.gte = (c: string, v: number) => { data = data.filter((r) => (r as never as Record<string, number>)[c] >= v); return q; };
    q.lte = (c: string, v: number) => { data = data.filter((r) => (r as never as Record<string, number>)[c] <= v); return q; };
    q.order = (c: string) => { spy?.orders.push(c); data.sort((a, b) => Number((a as never as Record<string, number>)[c]) - Number((b as never as Record<string, number>)[c])); return q; };
    q.range = async (from: number, to: number) => {
      spy?.ranges.push([from, to]);
      return { data: data.slice(from, to + 1), error: null };
    };
    return q;
  };
  return { from: () => ({ select: () => build() }) } as unknown as SupabaseClient;
}

function failingClient(message: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['eq', 'in', 'gte', 'lte', 'order']) q[m] = () => q;
  q.range = async () => ({ data: null, error: { message } });
  return { from: () => ({ select: () => q }) } as unknown as SupabaseClient;
}

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, team: i % 2 ? 'EDM' : 'TOR', season: 2026, day: i }));

const READ = { table: 'player_directory', columns: 'id', orderBy: ['id'] };

describe('pagedSelect', () => {
  // The defect this exists for: an unbounded select comes back at exactly
  // db-max-rows with HTTP 200 and nothing to distinguish it from a complete
  // answer. 2,738 rows must arrive as 2,738.
  it('returns every row past the 1000-row clamp', async () => {
    const spy = { ranges: [] as Array<[number, number]>, orders: [] as string[] };
    const r = await pagedSelect<Row>(makeClient(rows(2738), spy), READ);
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(2738);
    expect(r.truncated).toBe(false);
    expect(new Set(r.data.map((x) => x.id)).size).toBe(2738);
    expect(spy.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('handles the empty table and the single short page', async () => {
    expect((await pagedSelect<Row>(makeClient([]), READ)).data).toHaveLength(0);
    expect((await pagedSelect<Row>(makeClient(rows(1)), READ)).data).toHaveLength(1);
    expect((await pagedSelect<Row>(makeClient(rows(999)), READ)).data).toHaveLength(999);
  });

  // An exactly-full page is ambiguous: it may be the end, or the clamp. The
  // helper spends one wasted empty read rather than guessing.
  it('an exactly-full page costs one extra read and is not truncated', async () => {
    const spy = { ranges: [] as Array<[number, number]>, orders: [] as string[] };
    const r = await pagedSelect<Row>(makeClient(rows(1000), spy), READ);
    expect(r.data).toHaveLength(1000);
    expect(r.truncated).toBe(false);
    expect(spy.ranges).toHaveLength(2);
  });

  it('applies eq, in and range filters before the sort', async () => {
    const all = rows(2500);
    const r = await pagedSelect<Row>(makeClient(all), {
      table: 't', columns: '*', orderBy: ['id'],
      filters: [['season', 2026]],
      inFilters: [['team', ['EDM']]],
      rangeFilters: [['day', 'gte', 10], ['day', 'lte', 99]],
    });
    expect(r.error).toBeNull();
    expect(r.data.every((x) => x.team === 'EDM' && x.day >= 10 && x.day <= 99)).toBe(true);
    expect(r.data).toHaveLength(all.filter((x) => x.team === 'EDM' && x.day >= 10 && x.day <= 99).length);
  });

  it('orders by every key it was given, in order', async () => {
    const spy = { ranges: [] as Array<[number, number]>, orders: [] as string[] };
    await pagedSelect<Row>(makeClient(rows(10), spy), { table: 't', columns: '*', orderBy: ['season', 'id'] });
    expect(spy.orders).toEqual(['season', 'id']);
  });

  // A silently-clipped list is the same lie as a silently-clamped one, so
  // hitting maxRows must be reported on the wire.
  it('reports truncated when maxRows clips the answer', async () => {
    const r = await pagedSelect<Row>(makeClient(rows(2500)), { ...READ, maxRows: 1500 });
    expect(r.data).toHaveLength(1500);
    expect(r.truncated).toBe(true);
  });

  it('does not claim truncation when maxRows is exactly the row count', async () => {
    const r = await pagedSelect<Row>(makeClient(rows(500)), { ...READ, maxRows: 500 });
    expect(r.data).toHaveLength(500);
    expect(r.truncated).toBe(false);
  });

  it('surfaces a query error instead of a short list', async () => {
    const r = await pagedSelect<Row>(failingClient('permission denied for table x'), READ);
    expect(r.data).toEqual([]);
    expect(r.error?.message).toBe('permission denied for table x');
    expect(r.truncated).toBe(false);
  });

  // The MAX_PAGES guard: 25 pages of 1000. A table that answers full pages
  // forever must end in a named error, not an unbounded loop.
  it('stops at the page ceiling and says why', async () => {
    const r = await pagedSelect<Row>(makeClient(rows(30000)), READ);
    expect(r.data).toHaveLength(25000);
    expect(r.error?.message).toMatch(/exceeded 25 pages/);
  });
});

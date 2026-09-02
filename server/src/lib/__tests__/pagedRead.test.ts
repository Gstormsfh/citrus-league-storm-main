// `readAllPaged` — the shared answer to PostgREST's silent row clamp.
//
// The stubs here behave like the real Data API does: a `.range(from, to)`
// window, truncated at `db-max-rows` (1,000 on this project), returned with
// HTTP 200 and no error. Any helper that "works" against a stub which hands
// back the whole table regardless of range is untested against the only
// failure mode that matters.

import { describe, it, expect, vi } from 'vitest';
import { readAllPaged, PAGE_SIZE, MAX_PAGES } from '../pagedRead';

const PG_MAX_ROWS = 1000;

/**
 * A Supabase-shaped stub that clamps like PostgREST and records what it
 * was asked for.
 */
function stubTable(rows: Array<{ id: number }>) {
  const calls = {
    range: [] as Array<[number, number]>,
    eq: [] as Array<[string, unknown]>,
    order: [] as Array<[string, unknown]>,
    select: [] as string[],
  };
  const builder: Record<string, any> = {};
  builder.select = vi.fn((cols: string) => {
    calls.select.push(cols);
    return builder;
  });
  builder.eq = vi.fn((col: string, val: unknown) => {
    calls.eq.push([col, val]);
    return builder;
  });
  builder.order = vi.fn((col: string, opts: unknown) => {
    calls.order.push([col, opts]);
    return builder;
  });
  builder.range = vi.fn((from: number, to: number) => {
    calls.range.push([from, to]);
    const requested = to - from + 1;
    return Promise.resolve({
      data: rows.slice(from, from + Math.min(requested, PG_MAX_ROWS)),
      error: null,
    });
  });
  const supabase = { from: vi.fn(() => builder) } as any;
  return { supabase, calls, builder };
}

const spec = { table: 't', columns: 'id', orderBy: ['id'] };

describe('readAllPaged', () => {
  it('returns every row when the table exceeds the clamp', async () => {
    const rows = Array.from({ length: 2350 }, (_, i) => ({ id: i }));
    const { supabase, calls } = stubTable(rows);

    const { data, error } = await readAllPaged<{ id: number }>(supabase, spec);

    expect(error).toBeNull();
    expect(data).toHaveLength(2350);
    expect(data.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    // Three windows: two full, one short.
    expect(calls.range).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('stops after one read when the first page is short', async () => {
    const { supabase, calls } = stubTable(Array.from({ length: 12 }, (_, i) => ({ id: i })));
    const { data } = await readAllPaged<{ id: number }>(supabase, spec);
    expect(data).toHaveLength(12);
    expect(calls.range).toHaveLength(1);
  });

  it('takes one extra empty read when the row count is an exact multiple of the page size', async () => {
    // An exactly-full page is ambiguous — it could be the end or not —
    // so the loop goes round once more rather than guessing short.
    const { supabase, calls } = stubTable(
      Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })),
    );
    const { data } = await readAllPaged<{ id: number }>(supabase, spec);
    expect(data).toHaveLength(PAGE_SIZE);
    expect(calls.range).toHaveLength(2);
  });

  it('always asks for an explicit sort — paging without one duplicates and skips rows', async () => {
    const { supabase, calls } = stubTable([{ id: 1 }]);
    await readAllPaged(supabase, { table: 't', columns: 'id', orderBy: ['a', 'b'] });
    expect(calls.order).toEqual([
      ['a', { ascending: true }],
      ['b', { ascending: true }],
    ]);
  });

  it('applies equality filters before the sort', async () => {
    const { supabase, calls } = stubTable([{ id: 1 }]);
    await readAllPaged(supabase, {
      table: 't',
      columns: 'id',
      filters: [['season', 2025], ['is_goalie', false]],
      orderBy: ['id'],
    });
    expect(calls.eq).toEqual([
      ['season', 2025],
      ['is_goalie', false],
    ]);
  });

  it('surfaces a read error instead of returning a partial page as if it were whole', async () => {
    const builder: Record<string, any> = {};
    for (const m of ['select', 'eq', 'order']) builder[m] = vi.fn(() => builder);
    builder.range = vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } }));
    const supabase = { from: vi.fn(() => builder) } as any;

    const { data, error } = await readAllPaged(supabase, spec);
    expect(data).toEqual([]);
    expect(error?.message).toBe('boom');
  });

  it('gives up rather than looping forever when a table keeps returning full pages', async () => {
    // A filter that does not narrow, or a mis-specified sort, would
    // otherwise page until the process runs out of memory.
    const builder: Record<string, any> = {};
    for (const m of ['select', 'eq', 'order']) builder[m] = vi.fn(() => builder);
    builder.range = vi.fn(() =>
      Promise.resolve({ data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })), error: null }),
    );
    const supabase = { from: vi.fn(() => builder) } as any;

    const { error } = await readAllPaged(supabase, spec);
    expect(error?.message).toContain(`exceeded ${MAX_PAGES} pages`);
    expect(builder.range).toHaveBeenCalledTimes(MAX_PAGES);
  });
});

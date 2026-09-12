import { describe, it, expect, vi } from 'vitest';
import { readCanonicalProjectionRows } from '../lib/canonicalProjectionRead';
import { createChain } from './helpers';

const pointer = (revision = 'a', season = 2026) => ({ season, run_id: `run-${revision}`, revision });
const row = (revision = 'a', season = 2026) => ({ season, projection_run_id: `run-${revision}`, projection_revision: revision, projected_saves: 0 });
function client(results: Array<any>) {
  const chains: any[] = [];
  const from = vi.fn(() => { const chain = createChain(results.shift()); chains.push(chain); return chain; });
  return { db: { from } as any, from, chains };
}
const result = (data: any) => ({ data, error: null });
describe('readCanonicalProjectionRows', () => {
  it('accepts exact stable stamps and zero counts with two season-scoped reads', async () => {
    const { db, from, chains } = client([result(pointer()), result(pointer())]);
    const rows = [row()]; expect(await readCanonicalProjectionRows(db, 2026, async () => rows)).toBe(rows);
    expect(from).toHaveBeenCalledTimes(2); for (const chain of chains) expect(chain.eq).toHaveBeenCalledWith('season', 2026);
  });
  it('keeps legacy rows only for true absent pointers', async () => {
    const { db } = client([result(null), result(null)]);
    expect(await readCanonicalProjectionRows(db, 2025, async () => [{ projected_saves: 12 }])).toEqual([{ projected_saves: 12 }]);
  });
  it('retries an activation during assembled read once', async () => {
    const { db, from } = client([result(null), result(pointer('b')), result(pointer('b')), result(pointer('b'))]);
    const read = vi.fn().mockResolvedValueOnce([{ old: true }]).mockResolvedValueOnce([row('b')]);
    expect(await readCanonicalProjectionRows(db, 2026, read)).toEqual([row('b')]);
    expect(read).toHaveBeenCalledTimes(2); expect(from).toHaveBeenCalledTimes(4);
  });
  it.each([
    [row(), row('b')],
    [{ season: 2026, projection_run_id: 'run-a' }],
    [row('a', 2025)],
  ])('rejects persistent mixed, missing or cross-season stamps: %j', async (...rows) => {
    const { db } = client(Array.from({ length: 4 }, () => result(pointer())));
    const read = vi.fn(async () => rows);
    await expect(readCanonicalProjectionRows(db, 2026, read)).rejects.toThrow('mismatched publication stamps');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('keeps genuinely empty active results missing', async () => {
    const { db } = client([result(pointer()), result(pointer())]);
    expect(await readCanonicalProjectionRows(db, 2026, async () => [])).toEqual([]);
  });
  it('does not turn pointer read/auth failure into legacy success', async () => {
    const error = { message: 'permission denied' };
    const { db } = client([{ data: null, error }]); const read = vi.fn();
    await expect(readCanonicalProjectionRows(db, 2026, read)).rejects.toEqual(error); expect(read).not.toHaveBeenCalled();
  });
  it('fails if the after-read pointer fails', async () => {
    const { db } = client([result(null), { data: null, error: { message: 'network failure' } }]);
    await expect(readCanonicalProjectionRows(db, 2026, async () => [])).rejects.toEqual({ message: 'network failure' });
  });
});

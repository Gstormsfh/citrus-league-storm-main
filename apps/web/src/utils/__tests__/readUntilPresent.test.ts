// MATCHUP LOAD (2026-08-26) — reported from an iPhone as "Matchup tab still
// takes painfully long", three separate times.
//
// Two `await new Promise(r => setTimeout(r, 2000))` calls sat on the matchup
// generation path, both commented "wait for database commits". The write API
// had already returned before either of them ran. Four seconds of guaranteed
// dead wall-clock, against a page with a 15-second timeout that was taking ten.
//
// readUntilPresent replaces them: read, and only wait if the read came back
// empty. These tests pin both halves — that the happy path pays nothing, and
// that a genuinely slow write is still tolerated rather than traded away for
// speed.
import { describe, it, expect, vi } from 'vitest';
import { readUntilPresent } from '../readUntilPresent';

describe('readUntilPresent', () => {
  it('reads once and returns when the value is already there', async () => {
    const read = vi.fn<() => Promise<{ data: number[] }>>().mockResolvedValue({ data: [1] });
    const result = await readUntilPresent(read, (r) => r.data.length > 0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: [1] });
  });

  it('costs no wall-clock on the happy path', async () => {
    // The whole point. The sleep this replaced cost 2000ms whether or not the
    // data was there.
    const start = Date.now();
    await readUntilPresent(async () => 'ready', (v) => v === 'ready', { delayMs: 500 });
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('retries until the value appears, then stops', async () => {
    let calls = 0;
    const read = vi.fn(async () => {
      calls += 1;
      return calls >= 3 ? { matchup: { id: 'm1' } } : { matchup: null };
    });
    const result = await readUntilPresent(read, (r) => Boolean(r.matchup), { delayMs: 1 });
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.matchup).toEqual({ id: 'm1' });
  });

  it('gives up after the attempt budget and returns the last read', async () => {
    // It must NOT throw or hang: the caller has its own "still nothing" error
    // path, and swallowing that would turn a clear message into a spinner.
    const read = vi
      .fn<() => Promise<{ matchup: { id: string } | null }>>()
      .mockResolvedValue({ matchup: null });
    const result = await readUntilPresent(read, (r) => Boolean(r.matchup), { attempts: 4, delayMs: 1 });
    expect(read).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ matchup: null });
  });

  it('respects an attempts budget of one', async () => {
    const read = vi.fn().mockResolvedValue(null);
    await readUntilPresent(read, Boolean, { attempts: 1, delayMs: 1 });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('propagates a read that throws rather than masking it as absent', async () => {
    const read = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(readUntilPresent(read, Boolean, { delayMs: 1 })).rejects.toThrow('network down');
  });
});

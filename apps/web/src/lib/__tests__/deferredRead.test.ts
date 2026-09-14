import { afterEach, expect, it, vi } from 'vitest';
import { startDeferredRead } from '../deferredRead';

afterEach(() => vi.useRealTimers());
const after = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

it('overlaps the read with prerequisite work without publishing state early', async () => {
  vi.useFakeTimers();
  const value = { transactions: [{ points: 0 }, { points: -3 }], error: null };
  const read = vi.fn(() => after(600, value));
  const consume = startDeferredRead(read);
  const writes: unknown[] = [];
  const loading = (async () => {
    await after(900, 'roster');
    const result = await consume();
    writes.push(result);
    return result;
  })();
  await vi.advanceTimersByTimeAsync(600);
  expect(read).toHaveBeenCalledOnce();
  expect(writes).toEqual([]);
  await vi.advanceTimersByTimeAsync(300);
  expect(await loading).toBe(value);
  expect(writes).toEqual([value]);
  // A serial read would still need another 600ms after the 900ms prerequisite.
  expect(vi.getTimerCount()).toBe(0);
});

it('surfaces a rejected read at its consumption boundary, after prerequisite work', async () => {
  vi.useFakeTimers();
  const failure = new Error('transactions failed');
  const consume = startDeferredRead(async () => { throw failure; });
  const events: string[] = [];
  const loading = (async () => {
    await after(900, null);
    events.push('roster complete');
    await consume();
    events.push('transactions applied');
  })();
  const rejection = expect(loading).rejects.toBe(failure);
  await vi.advanceTimersByTimeAsync(600);
  expect(events).toEqual([]);
  await vi.advanceTimersByTimeAsync(300);
  await rejection;
  expect(events).toEqual(['roster complete']);
});

it('retains an earlier-stage failure when the speculative read also rejects', async () => {
  vi.useFakeTimers();
  const earlier = new Error('earlier stage failed');
  const consume = startDeferredRead(async () => { throw new Error('later boundary failed'); });
  const loading = (async () => {
    await after(20, null);
    await Promise.reject(earlier);
    // An aborted caller never consumes the later read.
    await consume();
  })();
  const rejection = expect(loading).rejects.toBe(earlier);
  await vi.advanceTimersByTimeAsync(20);
  await rejection;
});

it('captures synchronous read errors without moving the caller error boundary', async () => {
  const failure = new Error('synchronous read failure');
  const consume = startDeferredRead(() => { throw failure; });
  await expect(consume()).rejects.toBe(failure);
});

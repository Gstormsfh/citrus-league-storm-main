import { expect, it, vi } from 'vitest';
import { consumeScopedRead, normalizedPlayerScope, startScopedRead } from '../scopedRead';
it('normalizes valid IDs without accepting malformed identifiers', () => {
  expect(normalizedPlayerScope(['02', 1, ' 2 '], 'date')).toBe(normalizedPlayerScope([2, 1], 'date'));
  for (const invalid of ['1oops', '', '1.2', -1, 0, Number.MAX_SAFE_INTEGER + 1]) {
    expect(normalizedPlayerScope([invalid], 'date')).toBeNull();
  }
});
it.each(['new-date', 'new-week', 'new-league'])('uses the current read when %s changes', async scope => {
  const receipt = startScopedRead(normalizedPlayerScope([1], 'old-scope'), async () => 'old');
  const fallback = vi.fn().mockResolvedValue('current');
  expect(await consumeScopedRead(receipt, normalizedPlayerScope([1], scope), fallback)).toBe('current');
  expect(fallback).toHaveBeenCalledOnce();
});
it('captures early rejection, discards an obsolete failed read, and preserves matched error identity', async () => {
  const failure = new Error('early');
  const receipt = startScopedRead('scope', async () => { throw failure; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(await consumeScopedRead(receipt, 'new-scope', async () => 'fresh')).toBe('fresh');
  await expect(consumeScopedRead(receipt, 'scope', async () => 'wrong')).rejects.toBe(failure);
});
it('does not start invalid scope reads or alter zero/negative/null values', async () => {
  const read = vi.fn().mockResolvedValue(0);
  expect(startScopedRead(null, read)).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
  for (const value of [0, -2, null]) {
    expect(await consumeScopedRead(startScopedRead('same', async () => value), 'same', async () => 99)).toBe(value);
  }
});

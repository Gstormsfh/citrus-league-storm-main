import { describe, it, expect } from 'vitest';
import { plainDashes } from '../lib/stormy/plainDashes';

describe('plainDashes', () => {
  it('turns a spaced dash into a comma', () => {
    expect(plainDashes('Elite looks — cold stick.')).toBe('Elite looks, cold stick.');
    expect(plainDashes('Elite looks – cold stick.')).toBe('Elite looks, cold stick.');
  });
  it('turns an unspaced em dash into a comma', () => {
    expect(plainDashes('start him—he plays tonight')).toBe('start him, he plays tonight');
  });
  it('drops a dash that opens a line or a quote', () => {
    expect(plainDashes('— Bench him.\n— Start McDavid.')).toBe('Bench him.\nStart McDavid.');
  });
  it('leaves ranges and scores alone', () => {
    expect(plainDashes('In 2025–26 he went 5–3 on the road.')).toBe('In 2025–26 he went 5–3 on the road.');
  });
  it('never doubles punctuation', () => {
    expect(plainDashes('Fine —, really.')).toBe('Fine, really.');
    expect(plainDashes('Done —.')).toBe('Done.');
  });
  it('is a no-op on clean text', () => {
    const s = 'McDavid: 138 points, 82 games. Start him.';
    expect(plainDashes(s)).toBe(s);
    expect(plainDashes('')).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { projectionFraming } from '../projectionFraming';

describe('projectionFraming', () => {
  it('before the opener the line is a season projection and the GP is what the model expects him to play', () => {
    // 2026-09-05: the 2026-27 season has not started.
    const f = projectionFraming(new Date('2026-09-05T12:00:00'));
    expect(f.beforeOpener).toBe(true);
    expect(f.eyebrow).toBe('2026-27 projection');
    expect(f.gpPhrase(74)).toBe(' in a projected 74 GP');
  });

  it('once the season is under way it is the rest of the season', () => {
    const f = projectionFraming(new Date('2026-12-05T12:00:00'));
    expect(f.beforeOpener).toBe(false);
    expect(f.eyebrow).toBe('Rest of season');
    expect(f.gpPhrase(41.6)).toBe(' over 42 GP');
  });
});

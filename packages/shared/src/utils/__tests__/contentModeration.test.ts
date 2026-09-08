import { describe, it, expect } from 'vitest';
import { moderateText, normalizeForModeration } from '../contentModeration';

describe('moderateText', () => {
  it('passes ordinary and tricky-but-innocent names', () => {
    for (const name of ['Edmonton Oil Kings', 'Scunthorpe United', 'Assassins', 'Classic Cup', 'Cockburn FC',
      'Raccoon City', 'Japan Jets', 'Mustard Gas', 'Conspicuous', 'Shiitake Squad', 'Grape Fruits', "Storms' Army", 'JAS', '', 'Dickinson Dynasty', 'Flame Retardant']) {
      expect(moderateText(name).ok, name).toBe(true);
    }
  });
  it('rejects slurs including obfuscated forms', () => {
    for (const name of ['n1gg3r nation', 'N.I.G.G.E.R', 'the kikes', 'F4ggots', 'Team Retards', 'white power', 'Heil Hitler FC', 'K K K', 'sand n!ggers']) {
      const r = moderateText(name);
      expect(r.ok, name).toBe(false);
      expect(r.tier, name).toBe('hate');
    }
  });
  it('rejects profanity as whole words and common obfuscations', () => {
    for (const name of ['Fuck Yeah', 'sh1t show', 'The Cunts', 'f.u.c.k', 'Dick Heads', 'Nazi Punks', 'fuckyou', 'Cuntface']) {
      const r = moderateText(name);
      expect(r.ok, name).toBe(false);
      expect(r.tier, name).toBe('profanity');
    }
  });
  it('returns a user-safe message that never echoes the term', () => {
    const r = moderateText('n1gg3r');
    expect(r.message).toMatch(/not allow/);
    expect(r.message).not.toMatch(/nigg/);
  });
  it('normalises leet and diacritics', () => {
    expect(normalizeForModeration('Fück 5h1t')).toBe('fuck shit');
  });
});

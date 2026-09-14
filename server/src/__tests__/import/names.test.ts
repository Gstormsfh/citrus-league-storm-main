import { describe, it, expect } from 'vitest';
import { normalizeName, surnameKey, firstNameKey, normalizeTeamAbbr } from '../../import/names';

describe('normalizeName', () => {
  it('strips accents, case and punctuation so honest variants match', () => {
    expect(normalizeName('J.T. Miller')).toBe('jt miller');
    expect(normalizeName('JT Miller')).toBe('jt miller');
    expect(normalizeName("Ryan O'Reilly")).toBe('ryan oreilly');
    expect(normalizeName('Axel Sandin-Pellikka')).toBe('axel sandinpellikka');
    expect(normalizeName('Jiří Kulich')).toBe('jiri kulich');
    expect(normalizeName('  Connor   McDavid ')).toBe('connor mcdavid');
  });
  it('does not make two different people match', () => {
    // A borrowed first name from an adjacent roster row must stay different.
    expect(normalizeName('Simon Andrae')).not.toBe(normalizeName('Emil Andrae'));
    expect(normalizeName('Jackson Hinds')).not.toBe(normalizeName('Tyson Hinds'));
  });
  it('handles empty input', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName('')).toBe('');
  });
});

describe('surnameKey / firstNameKey', () => {
  it('splits on the last token', () => {
    expect(surnameKey('Sebastian Aho')).toBe('aho');
    expect(firstNameKey('Sebastian Aho')).toBe('sebastian');
    expect(surnameKey('')).toBe('');
  });
});

describe('normalizeTeamAbbr', () => {
  it('maps source spellings onto NHL codes', () => {
    expect(normalizeTeamAbbr('LA')).toBe('LAK');
    expect(normalizeTeamAbbr('NJ')).toBe('NJD');
    expect(normalizeTeamAbbr('tb')).toBe('TBL');
    expect(normalizeTeamAbbr('Utah')).toBe('UTA');
    expect(normalizeTeamAbbr('EDM')).toBe('EDM');
  });
  it('returns null for nothing or nonsense', () => {
    expect(normalizeTeamAbbr(null)).toBeNull();
    expect(normalizeTeamAbbr('Free Agent')).toBeNull();
  });
});

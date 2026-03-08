import { describe, it, expect } from 'vitest';
import { TEAM_COLORS, getTeamColor } from '../teamColors';

describe('teamColors', () => {
  describe('TEAM_COLORS', () => {
    it('contains all 32 NHL teams', () => {
      expect(Object.keys(TEAM_COLORS)).toHaveLength(32);
    });

    it('has valid hex color format for all teams', () => {
      Object.entries(TEAM_COLORS).forEach(([abbrev, color]) => {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });

    it('contains expected teams', () => {
      const expected = ['ANA', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET',
        'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NSH', 'NJD', 'NYI', 'NYR', 'OTT',
        'PHI', 'PIT', 'SJS', 'SEA', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WSH', 'WPG'];
      expected.forEach(team => {
        expect(TEAM_COLORS).toHaveProperty(team);
      });
    });
  });

  describe('getTeamColor', () => {
    it('returns correct color for known team', () => {
      expect(getTeamColor('EDM')).toBe('#FF4C00');
      expect(getTeamColor('TOR')).toBe('#003E7E');
    });

    it('is case-insensitive', () => {
      expect(getTeamColor('edm')).toBe('#FF4C00');
      expect(getTeamColor('Tor')).toBe('#003E7E');
    });

    it('returns default gray for unknown team', () => {
      expect(getTeamColor('XXX')).toBe('#666666');
    });

    it('returns default gray for empty string', () => {
      expect(getTeamColor('')).toBe('#666666');
    });

    it('handles null/undefined gracefully', () => {
      expect(getTeamColor(undefined as unknown as string)).toBe('#666666');
      expect(getTeamColor(null as unknown as string)).toBe('#666666');
    });
  });
});

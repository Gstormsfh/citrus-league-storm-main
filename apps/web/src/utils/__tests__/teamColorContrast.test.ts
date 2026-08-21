import { describe, it, expect } from 'vitest';
import { onTeamColor, contrastRatio, relativeLuminance } from '../teamColorContrast';
import { NHL_TEAMS } from '@/types/captracker';

/**
 * 2026-08-19 visual audit. Team chips hardcoded white text over the
 * team's own primary colour. Measured on production, 11 failures on
 * /nhl/playoffs alone, the worst at 1.73:1 (Boston gold, Pittsburgh
 * gold, Nashville gold).
 *
 * The contract this locks: EVERY team in the league gets readable text,
 * so a colour change or an expansion team can never silently reintroduce
 * an unreadable chip.
 */

describe('onTeamColor', () => {
  it('uses dark ink on the light team colours that broke', () => {
    // The six that failed in production.
    expect(onTeamColor('#FFB81C')).toBe('#0F1F15'); // BOS / NSH gold
    expect(onTeamColor('#FCB514')).toBe('#0F1F15'); // PIT gold
    expect(onTeamColor('#B4975A')).toBe('#0F1F15'); // VGK gold
    expect(onTeamColor('#F47A38')).toBe('#0F1F15'); // ANA orange
    expect(onTeamColor('#F74902')).toBe('#0F1F15'); // PHI orange
  });

  it('keeps cream on the dark team colours that were already fine', () => {
    expect(onTeamColor('#003087')).toBe('#FFF8F0'); // BUF navy
    expect(onTeamColor('#002868')).toBe('#FFF8F0'); // TBL navy
    expect(onTeamColor('#AF1E2D')).toBe('#FFF8F0'); // MTL red
    expect(onTeamColor('#000000')).toBe('#FFF8F0');
  });

  it('falls back to cream for missing or malformed input, never to invisible', () => {
    expect(onTeamColor(null)).toBe('#FFF8F0');
    expect(onTeamColor(undefined)).toBe('#FFF8F0');
    expect(onTeamColor('')).toBe('#FFF8F0');
    expect(onTeamColor('not-a-colour')).toBe('#FFF8F0');
  });

  it('handles 3-digit hex', () => {
    expect(onTeamColor('#fff')).toBe('#0F1F15');
    expect(onTeamColor('#000')).toBe('#FFF8F0');
  });

  // The real guarantee: run it across the actual league.
  it('gives every NHL team a chip that clears AA large-text (3:1)', () => {
    const teams = Object.values(NHL_TEAMS) as Array<{ abbrev?: string; primaryColor?: string }>;
    expect(teams.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const t of teams) {
      if (!t?.primaryColor) continue;
      const ink = onTeamColor(t.primaryColor);
      const ratio = contrastRatio(ink, t.primaryColor);
      // Team codes render at ~11px bold inside a 32px chip. 3:1 is the
      // WCAG floor for large/bold text; every team clears it comfortably
      // with the derived ink, where fixed white left six teams under 3.
      if (ratio === null || ratio < 3) {
        failures.push(`${t.abbrev ?? '???'} ${t.primaryColor} -> ${ink} = ${ratio?.toFixed(2)}`);
      }
    }
    expect(failures, `unreadable team chips:\n${failures.join('\n')}`).toEqual([]);
  });

  // NOTE: an earlier version of this test asserted the derived ink always
  // scored >= fixed #FFFFFF. That was a bad test. Cream (#FFF8F0) is
  // deliberately a touch darker than pure white, so on dark teams it
  // lands fractionally lower — WPG 15.70 vs 16.54 — which is meaningless
  // at that magnitude and is the app's chosen convention everywhere else.
  // What actually matters is the absolute floor, asserted here.
  it('clears full AA body-text contrast (4.5:1) for every team, not just the large-text floor', () => {
    const teams = Object.values(NHL_TEAMS) as Array<{ abbrev?: string; primaryColor?: string }>;
    const failures: string[] = [];
    for (const t of teams) {
      if (!t?.primaryColor) continue;
      const ratio = contrastRatio(onTeamColor(t.primaryColor), t.primaryColor) ?? 0;
      if (ratio < 4.5) {
        failures.push(`${t.abbrev ?? '???'} ${t.primaryColor} = ${ratio.toFixed(2)}`);
      }
    }
    expect(failures, `below AA:\n${failures.join('\n')}`).toEqual([]);
  });

  it('measurably rescues the teams that shipped broken', () => {
    // Each of these was under 3:1 with fixed white. Prove the fix moved
    // them, rather than trusting that it did.
    for (const bad of ['#FFB81C', '#FCB514', '#B4975A', '#F47A38', '#F74902']) {
      const before = contrastRatio('#FFFFFF', bad) ?? 0;
      const after = contrastRatio(onTeamColor(bad), bad) ?? 0;
      expect(before).toBeLessThan(4.5);
      expect(after).toBeGreaterThan(before);
      expect(after).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('colour maths', () => {
  it('luminance is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('black on white is the canonical 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });
});

import { describe, expect, it } from 'vitest';
import { draftReadiness, sizeForLayout } from '../draftReadiness';

/**
 * ONE OWNER OF TRUTH (2026-09-14): the client asks league_size, and only
 * league_size, whether a draft can start — the same column start_draft_v2
 * and build_draft_order_for_league read. These pin that there is no
 * settings.teamsCount fallback and no `|| 12`.
 */
describe('draftReadiness', () => {
  const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

  it('is ready when every seat is filled', () => {
    const r = draftReadiness({ league_size: 12 }, teams(12));
    expect(r).toEqual({ size: 12, have: 12, missing: 0, ready: true, reason: 'ready', message: '' });
  });

  it('reports the shortfall, with the dashboard sentence, when seats are open', () => {
    const r = draftReadiness({ league_size: 12 }, teams(9));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('roster_incomplete');
    expect(r.missing).toBe(3);
    expect(r.message).toBe('Need 3 more teams to start the draft.');
  });

  it('uses the singular for one open seat', () => {
    expect(draftReadiness({ league_size: 4 }, teams(3)).message).toBe('Need 1 more team to start the draft.');
  });

  it('never falls back to 12 when the size is unset — the engine will refuse, so this must too', () => {
    const r = draftReadiness({ league_size: null }, teams(12));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('size_unset');
    expect(r.size).toBeNull();
    expect(r.missing).toBe(0);
    expect(r.message).toMatch(/league size isn't set/i);
  });

  it('treats a missing league row and a missing column the same as unset', () => {
    expect(draftReadiness(null, teams(12)).reason).toBe('size_unset');
    expect(draftReadiness(undefined, teams(12)).reason).toBe('size_unset');
    expect(draftReadiness({}, teams(12)).reason).toBe('size_unset');
  });

  it('treats zero and negative sizes as unset, matching start_draft_v2 (league_size <= 0)', () => {
    expect(draftReadiness({ league_size: 0 }, teams(2)).reason).toBe('size_unset');
    expect(draftReadiness({ league_size: -3 }, teams(2)).reason).toBe('size_unset');
  });

  it('ignores settings.teamsCount entirely, even when it is the only number present', () => {
    const league = { settings: { teamsCount: 12 } } as { league_size?: number | null };
    expect(draftReadiness(league, teams(12)).reason).toBe('size_unset');
  });

  it('is ready, not over-full, when more teams exist than seats', () => {
    const r = draftReadiness({ league_size: 4 }, teams(5));
    expect(r.ready).toBe(true);
    expect(r.missing).toBe(0);
  });

  it('counts a missing team list as zero teams', () => {
    expect(draftReadiness({ league_size: 4 }, null).have).toBe(0);
    expect(draftReadiness({ league_size: 4 }, undefined).missing).toBe(4);
  });

  it('sizeForLayout gives layout math a number without inventing a size', () => {
    expect(sizeForLayout(draftReadiness({ league_size: 10 }, teams(1)))).toBe(10);
    expect(sizeForLayout(draftReadiness({ league_size: null }, teams(1)))).toBe(0);
  });
});

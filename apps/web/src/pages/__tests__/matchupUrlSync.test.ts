import { describe, it, expect } from 'vitest';
import { syncLeagueFromUrl } from '../matchupUrlSync';

describe('syncLeagueFromUrl — league isolation regression', () => {
  const BETA = 'beta-id';
  const CHARLIE = 'charlie-id';

  it('syncs context to URL when URL league differs from stale activeLeagueId (Beta→Charlie hijack fix)', () => {
    // User clicked /matchup/beta-id but LeagueContext still has Charlie as active.
    const result = syncLeagueFromUrl({
      urlLeagueId: BETA,
      activeLeagueId: CHARLIE,
    });

    expect(result.action).toBe('sync-context');
    if (result.action === 'sync-context') {
      expect(result.payload.leagueId).toBe(BETA);
    }
  });

  it('does NOT emit a navigate action that would rewrite /matchup/beta-id to /matchup/charlie-id', () => {
    const result = syncLeagueFromUrl({
      urlLeagueId: BETA,
      activeLeagueId: CHARLIE,
    });

    // Must never be a navigate — that was the bug.
    expect(result.action).not.toBe('navigate');
    // And certainly never carry the stale charlie id as a payload.
    if (result.action !== 'noop') {
      expect((result.payload as { leagueId: string }).leagueId).not.toBe(CHARLIE);
    }
  });

  it('navigates to include activeLeagueId when URL has none', () => {
    const result = syncLeagueFromUrl({
      urlLeagueId: undefined,
      activeLeagueId: CHARLIE,
    });
    expect(result).toEqual({ action: 'navigate', payload: { leagueId: CHARLIE } });
  });

  it('is a noop when URL and activeLeagueId already match', () => {
    const result = syncLeagueFromUrl({
      urlLeagueId: BETA,
      activeLeagueId: BETA,
    });
    expect(result).toEqual({ action: 'noop' });
  });

  it('is a noop when neither URL nor active league is set', () => {
    const result = syncLeagueFromUrl({
      urlLeagueId: undefined,
      activeLeagueId: null,
    });
    expect(result).toEqual({ action: 'noop' });
  });

  it('is a noop when URL has leagueId but activeLeagueId is not yet set', () => {
    // Context still loading — don't do anything, let it settle.
    const result = syncLeagueFromUrl({
      urlLeagueId: BETA,
      activeLeagueId: null,
    });
    expect(result).toEqual({ action: 'noop' });
  });
});

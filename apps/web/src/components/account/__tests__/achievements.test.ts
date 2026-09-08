import { describe, it, expect } from 'vitest';
import { deriveAccomplishments } from '../achievements';

const base = {
  championships: 0,
  playoffAppearances: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  currentRank: null,
  totalSeasons: 0,
  memberSince: 2027,
  leagues: [],
  commissionerLeagueCount: 0,
  launchYear: 2026,
};

describe('deriveAccomplishments', () => {
  it('draws nothing for a brand-new manager with nothing on record', () => {
    expect(deriveAccomplishments(base)).toEqual([]);
  });

  it('a founding manager who drafted and runs a league gets those three, rarest first', () => {
    const out = deriveAccomplishments({
      ...base,
      memberSince: 2026,
      leagues: [{ draft_status: 'completed' }, { draft_status: 'not_started' }],
      commissionerLeagueCount: 1,
    });
    expect(out.map((a) => a.key)).toEqual(['drafted', 'commissioner', 'founding']);
    expect(out[0].title).toBe('Draft day');
    expect(out[2].year).toBe('2026');
  });

  it('wins escalate: first win, then ten, and a winning record needs five games', () => {
    expect(deriveAccomplishments({ ...base, wins: 1, losses: 3 }).map((a) => a.key)).toEqual(['firstwin']);
    expect(deriveAccomplishments({ ...base, wins: 12, losses: 4 }).map((a) => a.key)).toEqual(['wins10', 'winning']);
    // 3-1 is a winning record on paper but four games is not a record yet.
    expect(deriveAccomplishments({ ...base, wins: 3, losses: 1 }).map((a) => a.key)).toEqual(['firstwin']);
  });

  it('a champion leads the list and a podium needs games played', () => {
    const out = deriveAccomplishments({ ...base, championships: 2, playoffAppearances: 3, currentRank: 2, wins: 8, losses: 2 });
    expect(out[0]).toMatchObject({ key: 'champion', title: '2× league champion', tone: 'gold' });
    expect(out.map((a) => a.key)).toEqual(['champion', 'playoffs', 'podium', 'firstwin', 'winning']);
    expect(deriveAccomplishments({ ...base, currentRank: 1 }).map((a) => a.key)).toEqual([]);
  });
});

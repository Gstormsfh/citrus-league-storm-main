// LEAGUE SCOREBOARD RULES (2026-09-01, Sleeper parity audit M7)
//
// The strip is only as honest as these: who is ahead, which side is the
// viewer, when a week is over, and when anything is live. Each is a small
// pure function so a wrong answer here fails without a render.
import { describe, it, expect } from 'vitest';
import {
  anyGameLive,
  formatScore,
  initialOf,
  isBye,
  isFinal,
  leaderOf,
  ownSideOf,
  scoreOf,
  scoreboardState,
  teamNameOf,
  avatarOf,
  type WeekMatchupRow,
} from '../scoreboard';

const row = (over: Partial<WeekMatchupRow> = {}): WeekMatchupRow => ({
  id: 'm1',
  team1_id: 't1',
  team2_id: 't2',
  team1_score: 12.4,
  team2_score: 9.8,
  status: 'in_progress',
  week_end_date: '2026-10-17',
  team1_name: 'Citrus Crushers',
  team2_name: 'Thunder Titans',
  ...over,
});

const TODAY = '2026-10-14';

describe('scoreOf / formatScore — the API hands numerics back as strings on some paths', () => {
  it('reads numbers, numeric strings, and treats null / junk as zero', () => {
    expect(scoreOf(12.4)).toBe(12.4);
    expect(scoreOf('12.4')).toBe(12.4);
    expect(scoreOf(null)).toBe(0);
    expect(scoreOf(undefined)).toBe(0);
    expect(scoreOf('abc')).toBe(0);
  });

  it('prints one decimal like every other score on the page', () => {
    expect(formatScore(12)).toBe('12.0');
    expect(formatScore('9.86')).toBe('9.9');
    expect(formatScore(null)).toBe('0.0');
  });
});

describe('teamNameOf — both spellings the page carries', () => {
  it('prefers the copied-up name, falls back to the joined team, then to Unknown', () => {
    expect(teamNameOf(row(), 'team1')).toBe('Citrus Crushers');
    expect(teamNameOf(row({ team1_name: undefined, team1: { team_name: 'Joined Name' } }), 'team1')).toBe('Joined Name');
    expect(teamNameOf(row({ team1_name: '', team1: null }), 'team1')).toBe('Unknown');
  });

  it('names a missing second team "Bye Week", not Unknown', () => {
    expect(teamNameOf(row({ team2_id: null, team2_name: undefined, team2: null }), 'team2')).toBe('Bye Week');
    expect(isBye(row({ team2_id: null }))).toBe(true);
    expect(isBye(row())).toBe(false);
  });

  it('reads an avatar only when the join carries one (it does not today)', () => {
    expect(avatarOf(row(), 'team1')).toBeNull();
    expect(avatarOf(row({ team1: { team_name: 'X', avatar_url: '  ' } }), 'team1')).toBeNull();
    expect(avatarOf(row({ team1: { team_name: 'X', avatar_url: 'https://cdn/x.png' } }), 'team1')).toBe('https://cdn/x.png');
  });

  // Audit M8: the owner's profile picture comes from the league/teams
  // response, keyed by team id; the join wins when both are present.
  it('falls back to the owner avatar map by team id, and treats blanks as nothing', () => {
    const avatars = new Map<string, string | null>([
      ['t1', 'https://cdn/owner1.png'],
      ['t2', '   '],
    ]);
    expect(avatarOf(row(), 'team1', avatars)).toBe('https://cdn/owner1.png');
    expect(avatarOf(row(), 'team2', avatars)).toBeNull();
    expect(avatarOf(row({ team2_id: null }), 'team2', avatars)).toBeNull();
    expect(avatarOf(row({ team1: { team_name: 'X', avatar_url: 'https://cdn/joined.png' } }), 'team1', avatars)).toBe('https://cdn/joined.png');
    expect(avatarOf(row(), 'team1', new Map())).toBeNull();
  });

  it('initialOf takes the first letter, upper-cased, with ? for nothing', () => {
    expect(initialOf('citrus crushers')).toBe('C');
    expect(initialOf('  ')).toBe('?');
  });
});

describe('leaderOf — sage means ahead, and only ahead', () => {
  it('picks the side with more points', () => {
    expect(leaderOf(row())).toBe('team1');
    expect(leaderOf(row({ team1_score: '3.2', team2_score: '10.5' }))).toBe('team2');
  });

  it('a tie has no leader — 0.0–0.0 before puck drop is not a double leader', () => {
    expect(leaderOf(row({ team1_score: 0, team2_score: 0 }))).toBeNull();
    expect(leaderOf(row({ team1_score: '7.0', team2_score: 7 }))).toBeNull();
  });

  it('a bye has nobody to lead', () => {
    expect(leaderOf(row({ team2_id: null, team1_score: 40, team2_score: 0 }))).toBeNull();
  });
});

describe('ownSideOf — orange means you', () => {
  it('finds the viewer on either side, and nowhere in a stranger matchup', () => {
    expect(ownSideOf(row(), 't1')).toBe('team1');
    expect(ownSideOf(row(), 't2')).toBe('team2');
    expect(ownSideOf(row(), 't9')).toBeNull();
    expect(ownSideOf(row(), null)).toBeNull();
  });
});

describe('isFinal / scoreboardState', () => {
  it('a completed status is final regardless of the calendar', () => {
    expect(isFinal(row({ status: 'completed', week_end_date: '2099-01-01' }), TODAY)).toBe(true);
  });

  it('a week that ended on the calendar is final even if the status column lags', () => {
    expect(isFinal(row({ status: 'in_progress', week_end_date: '2026-10-13' }), TODAY)).toBe(true);
    expect(isFinal(row({ status: 'in_progress', week_end_date: '2026-10-14' }), TODAY)).toBe(false);
    expect(isFinal(row({ status: 'in_progress', week_end_date: null }), TODAY)).toBe(false);
  });

  it('the strip reads FINAL only when every matchup is settled', () => {
    expect(scoreboardState([row({ status: 'completed' }), row({ id: 'm2', status: 'completed' })], TODAY, false)).toBe('final');
    expect(scoreboardState([row({ status: 'completed' }), row({ id: 'm2' })], TODAY, false)).toBe('open');
    expect(scoreboardState([], TODAY, false)).toBe('open');
  });

  it('LIVE wins over OPEN, and FINAL wins over a stale live flag', () => {
    expect(scoreboardState([row()], TODAY, true)).toBe('live');
    expect(scoreboardState([row({ status: 'completed' })], TODAY, true)).toBe('final');
  });
});

describe('anyGameLive — the cheap strip-level signal from the rosters the page already holds', () => {
  const player = (games: Array<{ game_date: string; status: string }>) => ({ games });

  it('is true when any player has a live, crit or intermission game today', () => {
    expect(anyGameLive([player([{ game_date: '2026-10-14', status: 'live' }])], TODAY)).toBe(true);
    expect(anyGameLive([player([{ game_date: '2026-10-14T19:00:00', status: 'CRIT' }])], TODAY)).toBe(true);
    expect(anyGameLive([player([{ game_date: '2026-10-14', status: 'intermission' }])], TODAY)).toBe(true);
  });

  it("ignores yesterday's live flag, scheduled and final games, and players with no games", () => {
    expect(anyGameLive([player([{ game_date: '2026-10-13', status: 'live' }])], TODAY)).toBe(false);
    expect(anyGameLive([player([{ game_date: '2026-10-14', status: 'scheduled' }])], TODAY)).toBe(false);
    expect(anyGameLive([player([{ game_date: '2026-10-14', status: 'final' }])], TODAY)).toBe(false);
    expect(anyGameLive([{ games: null }, {}], TODAY)).toBe(false);
    expect(anyGameLive([], TODAY)).toBe(false);
  });
});

/**
 * `League setup:` tokens (2026-09-11). See src/services/stormy/leagueSetup.ts.
 *
 * The gap this closes, from stormy_chat_log on 2026-09-09: asked whether the
 * league changes lineups daily or weekly, Stormy answered that it had no
 * league-configuration field in its context, then cited a token shape it had
 * never been given. Waivers, add limits, the deadline, keepers and best ball
 * decide whether advice is legal in a league; none of it reached the model.
 */
import { describe, it, expect } from 'vitest';
import { formatLeagueSetup } from '../stormy/leagueSetup';

describe('formatLeagueSetup', () => {
  it('writes the settings a recommendation has to obey, in order', () => {
    const line = formatLeagueSetup(
      {
        scoringFormat: 'points',
        teamsCount: 12,
        weekStartDay: 'Monday',
        waiver_type: 'faab',
        faab_budget: 100,
        waiver_period_hours: 24,
        waiver_process_time: '02:00',
        waiver_game_lock: true,
        weeklyAddLimit: 4,
        seasonAddLimit: 60,
        tradeDeadlineWeek: 19,
        allow_trades_during_games: false,
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'round1',
        playoffTeams: 6,
        playoffWeeks: 3,
        minGoalieGames: 2,
      },
      { C: 2, LW: 2, RW: 2, D: 4, G: 2, BN: 4 },
      12,
    );

    expect(line).toBe(
      'Format:points Teams:12 Roster:C2/LW2/RW2/D4/G2/BN4 WeekStarts:Monday ' +
        'Waivers:faab FAAB:100 WaiverHold:24h WaiverRun:02:00 WaiverGameLock:on ' +
        'AddsPerWeek:4 AddsPerSeason:60 TradeDeadline:wk19 TradesDuringGames:off ' +
        'Keepers:3 KeeperPenalty:round1 PlayoffTeams:6 PlayoffWeeks:3 MinGoalieStarts:2',
    );
  });

  it('zero add limits are unlimited, and week zero is no deadline at all', () => {
    // The shape every production league is actually carrying today.
    const line = formatLeagueSetup(
      {
        scoringFormat: 'h2h-points',
        waiver_type: 'rolling',
        waiver_process_time: '02:00:00',
        weekStartDay: 'sunday',
        weeklyAddLimit: 0,
        seasonAddLimit: 0,
        tradeDeadlineWeek: 0,
        keeperEnabled: false,
        bestBallEnabled: false,
      },
      { C: 2, D: 4, G: 2, BN: 5, IR: 2, LW: 2, RW: 2, UTIL: 2 },
      12,
    );
    expect(line).toBe(
      'Format:h2h-points Teams:12 Roster:C2/D4/G2/BN5/IR2/LW2/RW2/UTIL2 WeekStarts:sunday ' +
        'Waivers:rolling WaiverRun:02:00:00 AddsPerWeek:unlimited AddsPerSeason:unlimited ' +
        'TradeDeadline:none',
    );
  });

  it('a setting the league does not have gets no token, not a zero', () => {
    const line = formatLeagueSetup({ scoringFormat: 'categories', teamsCount: 10 }, null, null);
    expect(line).toBe('Format:categories Teams:10');
    expect(line).not.toContain('FAAB');
    expect(line).not.toContain('AddsPerWeek');
  });

  it('best ball and dynasty are stated, because they change what advice is even legal', () => {
    const line = formatLeagueSetup({ bestBallEnabled: true, dynastyMode: true }, null, null);
    expect(line).toBe('Dynasty:on BestBall:on');
  });

  it('a false flag is not an on token', () => {
    const line = formatLeagueSetup({ keeperEnabled: false, bestBallEnabled: false, waiver_game_lock: false }, null, null);
    expect(line).toBe('');
  });

  it('no settings at all, no line', () => {
    expect(formatLeagueSetup(null)).toBe('');
    expect(formatLeagueSetup(undefined)).toBe('');
    expect(formatLeagueSetup({})).toBe('');
  });

  it('the league row wins over the settings copy of team count', () => {
    expect(formatLeagueSetup({ teamsCount: 8 }, null, 12)).toBe('Teams:12');
  });
});

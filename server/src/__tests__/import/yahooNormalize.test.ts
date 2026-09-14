import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unpack, num, bool, str, asList } from '../../import/yahoo/normalize';

// Real Yahoo Fantasy API responses (other sports; the JSON shape is identical
// across games). Guids, names, emails and images are synthetic.
const load = (name: string) => JSON.parse(readFileSync(resolve(__dirname, `../fixtures/yahoo/${name}`), 'utf8'));

describe('unpack on real Yahoo payloads', () => {
  it('standings: league metadata and a teams collection with nested standings', () => {
    const doc = unpack(load('sample.standings.json')) as any;
    const league = doc.fantasy_content.league;
    expect(league.league_key).toBe('370.l.56877');
    expect(league.season).toBe('2017');
    expect(league.scoring_type).toBe('head');
    expect(league.is_finished).toBe(1);
    const teams = league.standings.teams;
    expect(Array.isArray(teams)).toBe(true);
    expect(teams).toHaveLength(10);
    const t = teams[0];
    expect(t.team_key).toBe('370.l.56877.t.5');
    expect(t.name).toBe('Fixture Team');
    expect(t.team_standings.rank).toBe(1);
    expect(t.team_standings.outcome_totals).toEqual({ wins: '144', losses: '103', ties: '17', percentage: '.578' });
    // A lone manager is still a list.
    expect(Array.isArray(t.managers)).toBe(true);
    expect(t.managers[0].guid).toMatch(/^FIXTUREGUID\d+$/);
    expect(t.managers[0].nickname).toBe('manager');
    // Empty placeholder arrays inside the team element vanish rather than becoming fields.
    expect(Object.keys(t)).not.toContain('0');
  });

  it('scoreboard: matchups with stat winners and per-team stat lists', () => {
    const doc = unpack(load('sample.scoreboard.week12.json')) as any;
    const sb = doc.fantasy_content.league.scoreboard;
    expect(sb.week).toBe('12');
    expect(sb.matchups).toHaveLength(5);
    const m = sb.matchups[0];
    expect(m.is_playoffs).toBe('0');
    expect(Array.isArray(m.stat_winners)).toBe(true);
    expect(m.stat_winners[0]).toEqual({ stat_id: '7', winner_team_key: '388.l.27081.t.4' });
    expect(m.teams).toHaveLength(2);
    expect(m.teams[0].team_points.total).toBe(5);
    expect(Array.isArray(m.teams[0].team_stats.stats)).toBe(true);
    expect(m.teams[0].team_stats.stats[1]).toEqual({ stat_id: '7', value: 31 });
  });

  it('users/games/leagues: the chain fields survive', () => {
    const doc = unpack(load('sample.users_leagues.json')) as any;
    const user = doc.fantasy_content.users[0];
    expect(user.guid).toMatch(/^FIXTUREGUID/);
    expect(user.games).toHaveLength(2);
    const nfl = user.games[0];
    expect(nfl.code).toBe('nfl');
    expect(nfl.leagues).toHaveLength(1);
    expect(nfl.leagues[0]).toMatchObject({ league_key: '449.l.751781', season: '2024', renew: '423_71785', renewed: '', is_finished: 1 });
  });

  it('transactions: trade with players and their movement', () => {
    const doc = unpack(load('sample.transactions.json')) as any;
    const trs = doc.fantasy_content.league.transactions;
    expect(trs).toHaveLength(3);
    expect(trs[0]).toMatchObject({ transaction_id: '319', type: 'trade', status: 'successful', trader_team_key: '399.l.710921.t.9' });
    const p = trs[0].players[0];
    expect(p.player_key).toBe('399.p.26804');
    expect(p.name.full).toBe('Latavius Murray');
    expect(p.transaction_data).toMatchObject({ type: 'trade', source_team_key: '399.l.710921.t.9' });
  });

  it('team roster: players with eligible positions and selected position', () => {
    const doc = unpack(load('sample.team_roster.json')) as any;
    const team = doc.fantasy_content.team;
    expect(team.team_key).toBe('412.l.48244.t.8');
    const players = team.roster.players;
    expect(players.length).toBeGreaterThan(10);
    expect(players[0].player_key).toMatch(/^412\.p\.\d+$/);
    expect(Array.isArray(players[0].eligible_positions)).toBe(true);
  });

  it('league teams: a single manager per team stays a list, commissioner flag readable', () => {
    const doc = unpack(load('sample.league_teams.json')) as any;
    const teams = doc.fantasy_content.league.teams;
    expect(teams).toHaveLength(14);
    for (const t of teams) expect(Array.isArray(t.managers)).toBe(true);
    expect(teams.some((t: any) => t.managers.some((m: any) => m.is_commissioner === '1'))).toBe(true);
  });
});

describe('unpack shape rules', () => {
  it('merges a bag of distinct single-key objects', () => {
    expect(unpack([{ a: 1 }, { b: 2 }, [{ c: 3 }], []])).toEqual({ a: 1, b: 2, c: 3 });
  });
  it('lists repeated same-key objects', () => {
    expect(unpack([{ stat: { id: 1 } }, { stat: { id: 2 } }])).toEqual([{ id: 1 }, { id: 2 }]);
  });
  it('a lone same-key object is a list only under its plural parent', () => {
    expect(unpack({ managers: [{ manager: { guid: 'x' } }] })).toEqual({ managers: [{ guid: 'x' }] });
    expect(unpack({ stat_categories: { stats: [{ stat: { stat_id: '1' } }] } })).toEqual({ stat_categories: { stats: [{ stat_id: '1' }] } });
    expect(unpack({ standings: [{ teams: { 0: { team: [[{ team_key: 'k' }]] }, count: 1 } }] })).toEqual({ standings: { teams: [{ team_key: 'k' }] } });
  });
  it('numeric collections become ordered arrays', () => {
    expect(unpack({ 1: 'b', 0: 'a', 10: 'c', count: 3 })).toEqual(['a', 'b', 'c']);
  });
  it('leaves scalars and mixed arrays alone', () => {
    expect(unpack('x')).toBe('x');
    expect(unpack([1, 2])).toEqual([1, 2]);
    expect(unpack([{ a: 1 }, { a: 2 }, { b: 3 }])).toEqual([{ a: 1 }, { a: 2 }, { b: 3 }]);
  });
});

describe('scalar helpers', () => {
  it('num reads strings, numbers and Yahoo dashes', () => {
    expect(num('144')).toBe(144);
    expect(num('.578')).toBe(0.578);
    expect(num(5)).toBe(5);
    expect(num('-')).toBeNull();
    expect(num('')).toBeNull();
    expect(num('abc')).toBeNull();
  });
  it('bool reads 0/1 in either type', () => {
    expect(bool('1')).toBe(true);
    expect(bool(0)).toBe(false);
    expect(bool(undefined)).toBeNull();
  });
  it('str trims and nulls empties', () => {
    expect(str(' x ')).toBe('x');
    expect(str('')).toBeNull();
    expect(str(7)).toBe('7');
  });
  it('asList wraps a bare element and drops an empty bag', () => {
    expect(asList({ a: 1 })).toEqual([{ a: 1 }]);
    expect(asList([1])).toEqual([1]);
    expect(asList({})).toEqual([]);
    expect(asList(null)).toEqual([]);
  });
});

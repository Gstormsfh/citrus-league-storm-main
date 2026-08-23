/**
 * SILENT-NO-OP regression (2026-08-21, found live on prod during launch QA).
 *
 * The client always sends target_date, so UI lineup saves only ever took the
 * per-day path. With no matchup for the team (schedule not generated) or a
 * target date outside the current matchup week - i.e. EVERY save in EVERY
 * league pre-season - createDailyRosterSnapshots silently wrote nothing and
 * saveLineup returned success anyway. Two 200 PUTs, zero rows, lineup
 * reverting on reload.
 *
 * The fix: the snapshot writer reports whether it wrote; when it did not,
 * saveLineup falls back to the base team_lineups upsert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LineupService } from '../services/LineupService';

type Result = { data: unknown; error: unknown };

/** Chainable supabase table mock: every builder method returns the chain,
 *  awaiting the chain (or .single()/.maybeSingle()) resolves `result`. */
function makeChain(result: Result) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'or', 'gte', 'order', 'limit', 'in', 'delete', 'upsert', 'insert', 'update']) {
    c[m] = vi.fn(() => c);
  }
  c.maybeSingle = vi.fn(async () => result);
  c.single = vi.fn(async () => result);
  (c as { then: unknown }).then = (res: (v: Result) => unknown) => Promise.resolve(result).then(res);
  return c as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
}

function makeSupabase(tableResults: Record<string, Result | Result[]>) {
  const chains: Record<string, ReturnType<typeof makeChain>[]> = {};
  const from = vi.fn((table: string) => {
    const conf = tableResults[table] ?? { data: null, error: null };
    const result = Array.isArray(conf) ? (conf.shift() ?? { data: null, error: null }) : conf;
    const ch = makeChain(result as Result);
    (chains[table] ||= []).push(ch);
    return ch;
  });
  return { client: { from } as never, from, chains };
}

const LINEUP = {
  starters: ['8479193'],
  bench: ['8480280'],
  ir: [] as string[],
  slot_assignments: { '8479193': 'slot-G-1' } as Record<string, string>,
};

const ROSTER_ROWS = { data: [{ player_id: '8479193' }, { player_id: '8480280' }], error: null };
const NO_SETTINGS = { data: { settings: null }, error: null };

describe('LineupService.saveLineup silent-no-op fix', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('falls back to the base team_lineups upsert when the league has no matchup', async () => {
    const { client, chains } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      // 1st team_lineups access: roster-protection read (none). 2nd: the upsert.
      team_lineups: [
        { data: null, error: null },
        { data: { starters: LINEUP.starters, bench: LINEUP.bench, ir: [] }, error: null },
      ],
      matchups: { data: [], error: null }, // no schedule => old code silently no-opped
    });

    const svc = new LineupService(client);
    const res = await svc.saveLineup('team-1', 'league-1', { ...LINEUP }, '2026-08-21');

    expect(res.success).toBe(true);
    const lineupChains = chains['team_lineups'] ?? [];
    const upserted = lineupChains.some(ch => ch.upsert.mock.calls.length > 0);
    expect(upserted).toBe(true); // the fallback actually wrote the base lineup
  });

  it('does NOT touch team_lineups when the daily-roster path really writes', async () => {
    // matchup week that contains the target date, so the per-day path writes.
    const today = new Date();
    const iso = (d: Date) => d.toISOString().split('T')[0];
    const start = new Date(today); start.setDate(start.getDate() - 2);
    const end = new Date(today); end.setDate(end.getDate() + 4);

    const { client, chains } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      team_lineups: { data: null, error: null }, // roster-protection read only
      matchups: {
        data: [{ id: 'm-1', week_start_date: iso(start), week_end_date: iso(end), team1_id: 'team-1', team2_id: 'team-2' }],
        error: null,
      },
      player_directory: { data: [], error: null },
      nhl_games: { data: [], error: null },
      fantasy_daily_rosters: { data: null, error: null }, // delete + upsert both succeed
    });

    const svc = new LineupService(client);
    const res = await svc.saveLineup('team-1', 'league-1', { ...LINEUP }, iso(today));

    expect(res.success).toBe(true);
    const dailyChains = chains['fantasy_daily_rosters'] ?? [];
    expect(dailyChains.some(ch => ch.upsert.mock.calls.length > 0)).toBe(true); // day rows written
    const lineupChains = chains['team_lineups'] ?? [];
    expect(lineupChains.every(ch => ch.upsert.mock.calls.length === 0)).toBe(true); // base untouched
  });

  it('createDailyRosterSnapshots reports false when there is nothing to write', async () => {
    const { client } = makeSupabase({ matchups: { data: [], error: null } });
    const svc = new LineupService(client);
    const wrote = await svc.createDailyRosterSnapshots('team-1', 'league-1', { ...LINEUP }, '2026-08-21');
    expect(wrote).toBe(false);
  });
});

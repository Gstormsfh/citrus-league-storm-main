/**
 * GAME-LOCK ENFORCEMENT (2026-09-01, Sleeper parity audit R6).
 *
 * The PUT lineup route guarded season-complete only; the client's
 * GameLockService was the whole gate, and Auto Lineup did not consult even
 * that. `findLockedLineupChanges` is the server's own answer: compare the
 * requested lineup with the lineup on record for today and name every
 * locked player whose spot would change.
 *
 * What would be WRONG rather than ugly:
 *   * letting a locked starter be benched (the bug);
 *   * refusing a save that leaves every locked player exactly where he is;
 *   * refusing because a recorded slot is null and the client repaired it;
 *   * refusing a strictly future day — nothing can be locked there;
 *   * treating a scheduled game that has not started as a lock;
 *   * blocking a drop (a locked player absent from the request is not a move).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTodayMST } from '@citrus/shared';
import { LineupService, lockedMoveMessage } from '../services/LineupService';

type Result = { data: unknown; error: unknown };

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

const TODAY = getTodayMST();
const HOUR_AGO = new Date(Date.now() - 3600_000).toISOString();
const IN_TWO_HOURS = new Date(Date.now() + 2 * 3600_000).toISOString();

const MCDAVID = 8478402;
const DRAISAITL = 8477934;

const DIRECTORY = {
  data: [
    { player_id: MCDAVID, full_name: 'Connor McDavid', team_abbrev: 'EDM' },
    { player_id: DRAISAITL, full_name: 'Leon Draisaitl', team_abbrev: 'TOR' },
  ],
  error: null,
};
/** EDM is under way; TOR has no game. */
const EDM_LIVE = { data: [{ game_time: HOUR_AGO, status: 'live', home_team: 'EDM', away_team: 'CGY' }], error: null };

/** Today's rows: McDavid starting at C1, Draisaitl on the bench. */
const TODAY_ROWS = {
  data: [
    { player_id: MCDAVID, slot_type: 'active', slot_id: 'slot-C-1' },
    { player_id: DRAISAITL, slot_type: 'bench', slot_id: null },
  ],
  error: null,
};

const lineup = (over: Partial<{ starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> }> = {}) => ({
  starters: [String(MCDAVID)],
  bench: [String(DRAISAITL)],
  ir: [] as string[],
  slot_assignments: { [String(MCDAVID)]: 'slot-C-1' } as Record<string, string>,
  ...over,
});

describe('LineupService.findLockedLineupChanges', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('names a locked starter the request would bench', async () => {
    const { client } = makeSupabase({ fantasy_daily_rosters: TODAY_ROWS, player_directory: DIRECTORY, nhl_games: EDM_LIVE });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges(
      't1',
      'l1',
      lineup({ starters: [String(DRAISAITL)], bench: [String(MCDAVID)], slot_assignments: { [String(DRAISAITL)]: 'slot-C-1' } }),
      TODAY,
    );
    expect(changes).toEqual([{ playerId: String(MCDAVID), playerName: 'Connor McDavid', from: 'slot-C-1', to: 'bench' }]);
    expect(lockedMoveMessage(changes)).toBe("Connor McDavid's game has started — locked players can't be moved until tomorrow.");
  });

  it('lets an unlocked player move while the locked one stays put', async () => {
    const { client, chains } = makeSupabase({ fantasy_daily_rosters: TODAY_ROWS, player_directory: DIRECTORY, nhl_games: EDM_LIVE });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges(
      't1',
      'l1',
      lineup({
        starters: [String(MCDAVID), String(DRAISAITL)],
        bench: [],
        slot_assignments: { [String(MCDAVID)]: 'slot-C-1', [String(DRAISAITL)]: 'slot-C-2' },
      }),
      TODAY,
    );
    expect(changes).toEqual([]);
    // Draisaitl's move was the only candidate, and TOR has no game.
    expect(chains['nhl_games']?.length ?? 0).toBe(1);
  });

  it('a locked starter moved to another slot is still a move', async () => {
    const { client } = makeSupabase({ fantasy_daily_rosters: TODAY_ROWS, player_directory: DIRECTORY, nhl_games: EDM_LIVE });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges('t1', 'l1', lineup({ slot_assignments: { [String(MCDAVID)]: 'slot-UTIL' } }), TODAY);
    expect(changes.map((c) => `${c.playerName} ${c.from}->${c.to}`)).toEqual(['Connor McDavid slot-C-1->slot-UTIL']);
  });

  it('does not query anything for a strictly future day — nothing can be locked there', async () => {
    const { client, from } = makeSupabase({ fantasy_daily_rosters: TODAY_ROWS, player_directory: DIRECTORY, nhl_games: EDM_LIVE });
    const svc = new LineupService(client);
    const tomorrow = new Date(`${TODAY}T12:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const changes = await svc.findLockedLineupChanges('t1', 'l1', lineup({ starters: [], bench: [String(MCDAVID), String(DRAISAITL)], slot_assignments: {} }), iso);
    expect(changes).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('a base save (no date) is checked against today, because it propagates there', async () => {
    const { client } = makeSupabase({ fantasy_daily_rosters: TODAY_ROWS, player_directory: DIRECTORY, nhl_games: EDM_LIVE });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges('t1', 'l1', lineup({ starters: [], bench: [String(MCDAVID), String(DRAISAITL)], slot_assignments: {} }));
    expect(changes.map((c) => c.playerName)).toEqual(['Connor McDavid']);
  });

  it('falls back to the base lineup when today has no rows of its own', async () => {
    const { client, chains } = makeSupabase({
      fantasy_daily_rosters: { data: [], error: null },
      team_lineups: { data: { starters: [MCDAVID], bench: [DRAISAITL], ir: [], slot_assignments: { [String(MCDAVID)]: 'slot-C-1' } }, error: null },
      player_directory: DIRECTORY,
      nhl_games: EDM_LIVE,
    });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges('t1', 'l1', lineup({ starters: [], bench: [String(MCDAVID), String(DRAISAITL)], slot_assignments: {} }), TODAY);
    expect(changes.map((c) => c.playerName)).toEqual(['Connor McDavid']);
    expect(chains['team_lineups']?.length).toBe(1);
  });

  it('allows everything when there is no record at all', async () => {
    const { client, chains } = makeSupabase({ fantasy_daily_rosters: { data: [], error: null }, team_lineups: { data: null, error: null } });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges('t1', 'l1', lineup(), TODAY);
    expect(changes).toEqual([]);
    expect(chains['nhl_games']).toBeUndefined();
  });

  it('a recorded slot of null compares by list only, so a client-side repair is not a move', async () => {
    const { client } = makeSupabase({
      fantasy_daily_rosters: { data: [{ player_id: MCDAVID, slot_type: 'active', slot_id: null }], error: null },
      player_directory: DIRECTORY,
      nhl_games: EDM_LIVE,
    });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges('t1', 'l1', lineup({ slot_assignments: { [String(MCDAVID)]: 'slot-C-2' } }), TODAY);
    expect(changes).toEqual([]);
  });

  it('a scheduled game that has not started is not a lock', async () => {
    const { client } = makeSupabase({
      fantasy_daily_rosters: TODAY_ROWS,
      player_directory: DIRECTORY,
      nhl_games: { data: [{ game_time: IN_TWO_HOURS, status: 'scheduled', home_team: 'EDM', away_team: 'CGY' }], error: null },
    });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges('t1', 'l1', lineup({ starters: [], bench: [String(MCDAVID), String(DRAISAITL)], slot_assignments: {} }), TODAY);
    expect(changes).toEqual([]);
  });

  it('a scheduled game whose start time has passed IS a lock, even before the feed flips to live', async () => {
    const { client } = makeSupabase({
      fantasy_daily_rosters: TODAY_ROWS,
      player_directory: DIRECTORY,
      nhl_games: { data: [{ game_time: HOUR_AGO, status: 'scheduled', home_team: 'CGY', away_team: 'EDM' }], error: null },
    });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges('t1', 'l1', lineup({ starters: [], bench: [String(MCDAVID), String(DRAISAITL)], slot_assignments: {} }), TODAY);
    expect(changes.map((c) => c.playerName)).toEqual(['Connor McDavid']);
  });

  it('a locked player absent from the request is a drop, not a move', async () => {
    const { client, chains } = makeSupabase({ fantasy_daily_rosters: TODAY_ROWS, player_directory: DIRECTORY, nhl_games: EDM_LIVE });
    const svc = new LineupService(client);
    const changes = await svc.findLockedLineupChanges('t1', 'l1', lineup({ starters: [], bench: [String(DRAISAITL)], slot_assignments: {} }), TODAY);
    expect(changes).toEqual([]);
    expect(chains['nhl_games']).toBeUndefined();
  });

  it('names every locked player in one sentence', () => {
    expect(
      lockedMoveMessage([
        { playerId: '1', playerName: 'Connor McDavid', from: 'slot-C-1', to: 'bench' },
        { playerId: '2', playerName: 'Leon Draisaitl', from: 'slot-C-2', to: 'bench' },
      ]),
    ).toBe("Connor McDavid and Leon Draisaitl's games have started — locked players can't be moved until tomorrow.");
  });
});

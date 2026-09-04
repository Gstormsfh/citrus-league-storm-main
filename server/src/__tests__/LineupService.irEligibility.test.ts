/**
 * LINEUP SAVE: eligibility is text, and only the injured go on IR (2026-09-03).
 *
 * Two findings from re-verifying docs/apple/WORLD_CLASS_READINESS.md §1
 * against the tree and the databases:
 *
 *   A. `player_directory.eligible_positions` is a comma-separated TEXT cell
 *      (migration 20260301000000). saveLineup typed it string[] and called
 *      .map on it, which threw for every non-null cell (787 of 2,035 staging
 *      rows, 797 of 1,909 production rows) and failed the whole position map
 *      open. The 2026-08-23 "goalie at C returns 200" fix was live only for
 *      players with a NULL cell.
 *
 *   B. `validateSlotAssignments` capped `ir-slot-N` and never asked whether
 *      the player is hurt; the `ir` LIST the snapshot writer stores was not
 *      capped at all. The roster page has gated IR on `is_ir_eligible` since
 *      the column arrived (migration 20260103151931); the server never did. It does now, with Yahoo's two
 *      softenings: an occupant placed while injured is tolerated after he
 *      heals, and a failed lookup never blocks a save.
 *
 * Mocks follow LineupService.silentNoop.test.ts: one chain per table read,
 * every builder method returns the chain, awaiting it resolves the table's
 * configured result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LineupService } from '../services/LineupService';

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

const MCDAVID = '8478402';
const DRAISAITL = '8477934';
const SKINNER = '8479973'; // goalie
const KANE = '8475169';
const HORVAT = '8477500';

const ROSTER_ROWS = {
  data: [MCDAVID, DRAISAITL, SKINNER, KANE, HORVAT].map((player_id) => ({ player_id })),
  error: null,
};
const NO_SETTINGS = { data: { settings: null }, error: null };

/** player_directory rows exactly as PostgREST returns them: the cell is a string. */
const DIRECTORY = {
  data: [
    { player_id: Number(MCDAVID), full_name: 'Connor McDavid', position_code: 'C', eligible_positions: 'C' },
    { player_id: Number(DRAISAITL), full_name: 'Leon Draisaitl', position_code: 'C', eligible_positions: 'C,LW' },
    { player_id: Number(SKINNER), full_name: 'Stuart Skinner', position_code: 'G', eligible_positions: 'G' },
    { player_id: Number(KANE), full_name: 'Evander Kane', position_code: 'LW', eligible_positions: null },
    { player_id: Number(HORVAT), full_name: 'Bo Horvat', position_code: 'C', eligible_positions: 'RW' },
  ],
  error: null,
};

/** The base lineup on record. Nobody on IR unless a test says so. */
const base = (ir: string[] = []) => ({
  data: { starters: [MCDAVID, DRAISAITL, SKINNER, HORVAT], bench: [KANE], ir, slot_assignments: {} },
  error: null,
});

const lineupWith = (over: Partial<{ starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> }>) => ({
  starters: [MCDAVID, DRAISAITL, SKINNER, HORVAT],
  bench: [KANE],
  ir: [] as string[],
  slot_assignments: {} as Record<string, string>,
  ...over,
});

const upserted = (chains: Record<string, ReturnType<typeof makeChain>[]>) =>
  (chains['team_lineups'] ?? []).some((ch) => ch.upsert.mock.calls.length > 0);

describe('saveLineup reads eligible_positions as the text cell it is (gap A)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('THE regression: a text cell no longer throws, so a goalie parked at C is refused instead of saved', async () => {
    const { client, chains } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      team_lineups: base(),
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup(
      'team-1', 'league-1', lineupWith({ slot_assignments: { [SKINNER]: 'slot-C-1' } }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/cannot fill slot-C-1/);
    expect(upserted(chains)).toBe(false);
  });

  it('a "C,LW" cell lets the player start at LW', async () => {
    const { client, chains } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      team_lineups: base(),
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup(
      'team-1', 'league-1', lineupWith({ slot_assignments: { [DRAISAITL]: 'slot-LW-1' } }),
    );
    expect(res.success).toBe(true);
    expect(upserted(chains)).toBe(true);
  });

  it('a cell that omits the listed position still lets him start at it', async () => {
    // Horvat's cell says "RW" while position_code says C (13 staging rows and
    // 9 production rows look like this): he must fit his own C slot.
    const { client } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      team_lineups: base(),
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup(
      'team-1', 'league-1', lineupWith({ slot_assignments: { [HORVAT]: 'slot-C-1' } }),
    );
    expect(res.success).toBe(true);
  });

  it('a save that puts nobody on IR never reads the IR tables', async () => {
    const { client, from } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      team_lineups: base(),
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup(
      'team-1', 'league-1', lineupWith({ slot_assignments: { [MCDAVID]: 'slot-C-1' } }),
    );
    expect(res.success).toBe(true);
    expect(from.mock.calls.map((c) => c[0])).not.toContain('player_talent_metrics');
  });
});

describe('saveLineup lets only the injured onto IR (gap B)', () => {
  beforeEach(() => vi.restoreAllMocks());

  const talent = (rows: Array<{ id: string; ir: boolean; status?: string | null }>) => ({
    data: rows.map((r) => ({ player_id: Number(r.id), is_ir_eligible: r.ir, roster_status: r.status ?? null })),
    error: null,
  });

  const irSave = (ir: string[]) =>
    lineupWith({
      starters: [MCDAVID, DRAISAITL, SKINNER, HORVAT, KANE].filter((id) => !ir.includes(id)),
      bench: [],
      ir,
      slot_assignments: Object.fromEntries(ir.map((id, i) => [id, `ir-slot-${i + 1}`])),
    });

  it('THE gap: a healthy player placed on IR is refused, and the sentence names him', async () => {
    const { client, chains } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      player_talent_metrics: talent([{ id: MCDAVID, ir: false }]),
      team_lineups: base(),
      fantasy_daily_rosters: { data: [], error: null },
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup('team-1', 'league-1', irSave([MCDAVID]));
    expect(res.success).toBe(false);
    expect(res.error).toBe(
      "Connor McDavid isn't listed IR or LTIR, so an IR slot can't hold him. Bench him, or move a player with official IR/LTIR status there.",
    );
    expect(upserted(chains)).toBe(false);
  });

  it('a player the NHL lists IR is accepted and written to IR', async () => {
    const { client, chains } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      player_talent_metrics: talent([{ id: KANE, ir: true, status: 'IR' }]),
      team_lineups: base(),
      fantasy_daily_rosters: { data: [], error: null },
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup('team-1', 'league-1', irSave([KANE]));
    expect(res.success).toBe(true);
    const upsert = (chains['team_lineups'] ?? []).flatMap((ch) => ch.upsert.mock.calls)[0];
    expect((upsert[0] as { ir: string[] }).ir).toEqual([KANE]);
  });

  it('a player in the ir LIST with no ir-slot id is checked too (the snapshot writer stores him regardless)', async () => {
    const { client } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      player_talent_metrics: talent([{ id: MCDAVID, ir: false }]),
      team_lineups: base(),
      fantasy_daily_rosters: { data: [], error: null },
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup(
      'team-1', 'league-1', lineupWith({ starters: [DRAISAITL, SKINNER, HORVAT], bench: [KANE], ir: [MCDAVID] }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^Connor McDavid isn't listed IR or LTIR/);
  });

  it('no talent row means no designation, which means no IR', async () => {
    const { client } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      player_talent_metrics: { data: [], error: null },
      team_lineups: base(),
      fantasy_daily_rosters: { data: [], error: null },
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup('team-1', 'league-1', irSave([HORVAT]));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^Bo Horvat isn't listed IR or LTIR/);
  });

  it('an occupant on record who has since been activated is tolerated (base lineup)', async () => {
    const { client } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      player_talent_metrics: talent([{ id: KANE, ir: false, status: 'ACT' }]),
      team_lineups: base([KANE]),
      fantasy_daily_rosters: { data: [], error: null },
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup('team-1', 'league-1', irSave([KANE]));
    expect(res.success).toBe(true);
  });

  it('an occupant on record in the daily rows alone is tolerated too (per-day saves never touch the base)', async () => {
    const { client } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      player_talent_metrics: talent([{ id: KANE, ir: false, status: 'ACT' }]),
      team_lineups: base(),
      fantasy_daily_rosters: { data: [{ player_id: Number(KANE) }], error: null },
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup('team-1', 'league-1', irSave([KANE]), '2026-10-20');
    expect(res.success).toBe(true);
  });

  it('tolerating the old occupant does not wave through a new healthy one beside him', async () => {
    const { client } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      player_talent_metrics: talent([{ id: KANE, ir: false }, { id: MCDAVID, ir: false }]),
      team_lineups: base([KANE]),
      fantasy_daily_rosters: { data: [], error: null },
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup('team-1', 'league-1', irSave([KANE, MCDAVID]));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^Connor McDavid isn't listed IR or LTIR/);
  });

  it('a failed status read fails OPEN: the save goes through', async () => {
    const { client } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      player_talent_metrics: { data: null, error: { message: 'boom' } },
      team_lineups: base(),
      fantasy_daily_rosters: { data: [], error: null },
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup('team-1', 'league-1', irSave([MCDAVID]));
    expect(res.success).toBe(true);
  });

  it('the ir LIST is capped at the league count: a fourth injured player in a 3-IR league is refused', async () => {
    const four = [MCDAVID, DRAISAITL, HORVAT, KANE];
    const { client } = makeSupabase({
      roster_assignments: ROSTER_ROWS,
      leagues: NO_SETTINGS,
      player_directory: DIRECTORY,
      player_talent_metrics: talent(four.map((id) => ({ id, ir: true, status: 'IR' }))),
      team_lineups: base(),
      fantasy_daily_rosters: { data: [], error: null },
      matchups: { data: [], error: null },
    });
    const res = await new LineupService(client).saveLineup('team-1', 'league-1', irSave(four));
    expect(res.success).toBe(false);
    expect(res.error).toBe('This league has 3 IR slots and 4 players are headed there. Bench one first.');
  });
});

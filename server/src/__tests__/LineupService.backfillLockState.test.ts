/**
 * Regression (2026-09-14 handoff review): the two daily-roster backfill
 * writers disagreed on is_locked.
 *
 * LineupService.backfillMissingDailyRosters (POST /rosters/.../backfill,
 * fired by the Matchup page effect) wrote is_locked: true for today and
 * future dates. MatchupService.backfillDailyRostersIfMissing (run inside
 * daily-scores / frozen-roster-batch / ensure-rosters on the same page load)
 * writes is_locked: date < today, i.e. false for those same dates. Both use
 * ON CONFLICT DO NOTHING, so whichever request landed first decided whether
 * today's rows were frozen — and a frozen row survives the snapshot writer's
 * delete-unlocked-then-insert, so a lineup edit before puck drop could not
 * replace it.
 *
 * is_locked means "the player's game has started" or "the day is complete".
 * Nothing this writer touches (today or later, by design) is locked yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTodayMST } from '@citrus/shared';
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

function makeSupabase(tableResults: Record<string, Result>) {
  const chains: Record<string, ReturnType<typeof makeChain>[]> = {};
  const from = vi.fn((table: string) => {
    const ch = makeChain(tableResults[table] ?? { data: null, error: null });
    (chains[table] ||= []).push(ch);
    return ch;
  });
  return { client: { from } as never, chains };
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('LineupService.backfillMissingDailyRosters lock state', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('writes today and future rows unlocked, matching the calculator backfill', async () => {
    const today = getTodayMST();
    const weekStart = addDays(today, -2);
    const weekEnd = addDays(today, 3);

    const { client, chains } = makeSupabase({
      matchups: { data: { id: 'm-1', week_start_date: weekStart, week_end_date: weekEnd }, error: null },
      team_lineups: {
        data: { starters: ['8479193'], bench: ['8480280'], ir: [], slot_assignments: { '8479193': 'slot-C-1' } },
        error: null,
      },
      roster_assignments: { data: [{ player_id: '8479193' }, { player_id: '8480280' }], error: null },
      fantasy_daily_rosters: { data: [], error: null }, // nothing exists yet
    });

    const svc = new LineupService(client);
    const res = await svc.backfillMissingDailyRosters('team-1', 'league-1', 'm-1');
    expect(res.error).toBeNull();

    const writer = (chains['fantasy_daily_rosters'] ?? []).find(ch => ch.upsert.mock.calls.length > 0);
    expect(writer).toBeDefined();
    const rows = writer!.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;

    // today + 3 future dates × 2 players; the two past dates are refused (Task 1B)
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map(r => r.roster_date))).toEqual(new Set([0, 1, 2, 3].map(n => addDays(today, n))));
    for (const row of rows) {
      expect(row.is_locked).toBe(false);
      expect(row.locked_at).toBeNull();
      expect(row.source).toBe('reconstructed');
    }
    // still a no-overwrite insert
    expect(writer!.upsert.mock.calls[0][1]).toMatchObject({ ignoreDuplicates: true });
    expect(res.backfilledCount).toBe(8);
  });
});

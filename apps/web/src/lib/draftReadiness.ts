/**
 * ONE OWNER OF TRUTH FOR LEAGUE SIZE (2026-09-14)
 *
 * `leagues.league_size` is the number the draft engine ignites against.
 * start_draft_v2 refuses a null or zero size and requires a round-1
 * team_order exactly that long; build_draft_order_for_league — the
 * scheduled sweep's builder — refuses `roster_incomplete` against the same
 * column. The server mirrors every write into settings.teamsCount, so the
 * two never disagree in the database (64 of 64 production leagues with
 * both set, checked 2026-09-14) — but the client had grown eleven
 * readings of `settings.teamsCount || 12`, and the `|| 12` was the defect:
 * a league with no size rendered "12 of 12, ready" on the dashboard while
 * the engine would answer invalid_league_size.
 *
 * Every client surface that asks "can this draft start?" asks here, and
 * this reads league_size only. No fallback, by design: a null size is
 * `size_unset`, which is what the engine will say too.
 *
 * Both sides count the same rows. get_league_teams (the client's team
 * list) and build_draft_order_for_league (the sweep) both read every row
 * of public.teams for the league, AI seats included, so `have` here is
 * the number the engine will compare against `size`.
 */

export type DraftReadinessReason = 'ready' | 'size_unset' | 'roster_incomplete';

export interface DraftReadiness {
  /** leagues.league_size as the API returned it. null means unset. */
  size: number | null;
  /** Teams in the league, every row. */
  have: number;
  /** Seats still open. 0 when ready or when the size is unset. */
  missing: number;
  ready: boolean;
  reason: DraftReadinessReason;
  /** Commissioner-facing sentence for the blocked states; '' when ready. */
  message: string;
}

interface LeagueSizeSource {
  league_size?: number | null;
}

/** Render `size` where a number is required for layout math. */
export function sizeForLayout(readiness: DraftReadiness): number {
  return readiness.size ?? 0;
}

export function draftReadiness(
  league: LeagueSizeSource | null | undefined,
  teams: readonly unknown[] | null | undefined,
): DraftReadiness {
  const have = teams?.length ?? 0;
  const raw = league?.league_size;
  const size = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;

  if (size === null) {
    return {
      size: null,
      have,
      missing: 0,
      ready: false,
      reason: 'size_unset',
      message: "The league size isn't set. Set it in the draft settings. The draft can't start without it.",
    };
  }

  const missing = Math.max(0, size - have);
  if (missing > 0) {
    return {
      size,
      have,
      missing,
      ready: false,
      reason: 'roster_incomplete',
      message: `Need ${missing} more team${missing === 1 ? '' : 's'} to start the draft.`,
    };
  }

  return { size, have, missing: 0, ready: true, reason: 'ready', message: '' };
}

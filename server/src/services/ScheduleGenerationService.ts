/**
 * SCHEDULE OWNERSHIP (2026-09-14, latency arc: the Matchup page becomes a read).
 *
 * WHAT WAS TRUE BEFORE. Nothing on the server created a league's schedule.
 * routes/matchups.ts says it plainly: the v2 engine's `draft_completed`
 * trigger syncs rosters and stops, so "for a league that has just drafted,
 * THIS ROUTE is the only thing in the product that ever writes a schedule,
 * and Matchup.tsx reaches it by noticing the void and asking for one." The
 * page also carried a branch that deleted every matchup in the league and
 * regenerated when the viewer's team was missing from the list. A stale
 * team list on one phone could wipe a league's season.
 *
 * WHAT IS TRUE NOW. The schedule has one owner, here, called from two
 * places: the engine's draft-completion handler (so a manager who finishes
 * a draft sees a matchup immediately, and eleven other managers never race
 * to create one) and the hourly matchup-sweep (self-heal for leagues drafted
 * before the hook existed, and for anything the hook misses). Both calls are
 * idempotent: a league that already holds matchups is left alone.
 *
 * The week math is `@citrus/shared` fantasyWeeks, the same module the web
 * app reads, and this file is a port of the web MatchupService wrapper that
 * used to feed the generate route: clamp the anchor to the season, trim
 * trailing weeks with no NHL games, reserve the commissioner's playoff
 * weeks. Cloud Run runs in UTC, so the completion date is taken as the
 * Mountain civil date (see fantasyWeeks.ts header).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clampToSeasonStart,
  fantasyWeekAnchorFor,
  getAvailableWeeks,
  getWeekEndDate,
  getWeekStartDate,
  weekStartDowFor,
} from '@citrus/shared';
import { getSupabaseAdmin } from '../lib/supabase';
import { logger } from '@citrus/shared';
import { MatchupService } from './MatchupService';

/** The zone every league's calendar is computed in (matches getTodayMST). */
export const SCHEDULE_TIMEZONE = 'America/Denver';

export interface EnsureScheduleResult {
  leagueId: string;
  /** 'exists' — matchups already present, nothing written. 'generated' — written now. 'skipped' — no completed draft, or fewer than two teams. */
  outcome: 'exists' | 'generated' | 'skipped';
  weeks: number;
  teams: number;
  reason?: string;
}

interface LeagueRow {
  id: string;
  draft_status: string | null;
  settings: unknown;
  created_at: string;
}

const formatLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class ScheduleGenerationService {
  private readonly admin: SupabaseClient;

  constructor(admin: SupabaseClient = getSupabaseAdmin()) {
    this.admin = admin;
  }

  /**
   * Build the fantasy weeks for a league from its row. Pure apart from the
   * season-end trim, which reads nhl_games. Exposed for the sweep's report
   * and for tests.
   */
  async fantasyWeeksFor(league: LeagueRow): Promise<Array<{ week_number: number; start_date: string; end_date: string }>> {
    const anchor = fantasyWeekAnchorFor(league, null, SCHEDULE_TIMEZONE);
    if (!anchor) return [];
    const dow = weekStartDowFor(league);
    const firstWeekStart = clampToSeasonStart(anchor, dow);

    let weeks = getAvailableWeeks(firstWeekStart);

    // SEASON-END TRIM: drop trailing calendar weeks with no NHL games (the
    // 2026-27 slate ends Apr 10; the date math runs to mid April). Fail-open
    // on any read error: keep the untrimmed weeks.
    try {
      const MAX_TRIM = 4;
      for (let i = 0; i < MAX_TRIM && weeks.length > 1; i++) {
        const last = weeks[weeks.length - 1];
        const { count, error } = await this.admin
          .from('nhl_games')
          .select('id', { count: 'exact', head: true })
          .gte('game_date', formatLocal(getWeekStartDate(last, firstWeekStart)))
          .lte('game_date', formatLocal(getWeekEndDate(last, firstWeekStart)));
        if (error || (count ?? 0) > 0) break;
        weeks = weeks.slice(0, -1);
      }
    } catch {
      /* fail-open */
    }

    // PLAYOFF RESERVATION: the commissioner's playoff length, clamped 1..4;
    // playoffTeams 0 means no reservation; absent/invalid means the legacy 3.
    // The DB playoff generators key off MAX(matchups.week_number), so the
    // regular season stopping short is what makes bracket weeks line up.
    const s = (league.settings ?? {}) as Record<string, unknown>;
    let reserve = 3;
    const pt = Number(s.playoffTeams);
    const pw = Number(s.playoffWeeks);
    if (Number.isFinite(pt) && pt <= 0) reserve = 0;
    else if (Number.isFinite(pw) && pw > 0) reserve = Math.max(1, Math.min(4, Math.round(pw)));

    const configured = Number(s.regularSeasonWeeks);
    const regularWeeks = Number.isFinite(configured) && configured > 0
      ? configured
      : weeks.length > reserve + 5
        ? weeks.length - reserve
        : weeks.length;

    return weeks
      .filter((w) => w <= regularWeeks)
      .map((week_number) => ({
        week_number,
        start_date: formatLocal(getWeekStartDate(week_number, firstWeekStart)),
        end_date: formatLocal(getWeekEndDate(week_number, firstWeekStart)),
      }));
  }

  /**
   * Generate the schedule for a league that has none. Idempotent: a league
   * with any matchup row is reported as 'exists' and left untouched. Never
   * deletes.
   */
  async ensureLeagueSchedule(leagueId: string): Promise<EnsureScheduleResult> {
    const { data: league, error: lErr } = await this.admin
      .from('leagues')
      .select('id, draft_status, settings, created_at')
      .eq('id', leagueId)
      .single();
    if (lErr || !league) {
      return { leagueId, outcome: 'skipped', weeks: 0, teams: 0, reason: lErr?.message ?? 'league not found' };
    }
    const row = league as LeagueRow;
    if (row.draft_status !== 'completed') {
      return { leagueId, outcome: 'skipped', weeks: 0, teams: 0, reason: 'draft not completed' };
    }

    const { count: existing, error: mErr } = await this.admin
      .from('matchups')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId);
    if (mErr) {
      return { leagueId, outcome: 'skipped', weeks: 0, teams: 0, reason: mErr.message };
    }
    if ((existing ?? 0) > 0) {
      return { leagueId, outcome: 'exists', weeks: 0, teams: 0 };
    }

    const { data: teams, error: tErr } = await this.admin
      .from('teams')
      .select('id')
      .eq('league_id', leagueId)
      .order('id');
    if (tErr) {
      return { leagueId, outcome: 'skipped', weeks: 0, teams: 0, reason: tErr.message };
    }
    const teamRows = (teams ?? []) as Array<{ id: string }>;
    if (teamRows.length < 2) {
      return { leagueId, outcome: 'skipped', weeks: 0, teams: teamRows.length, reason: 'fewer than two teams' };
    }

    const weeks = await this.fantasyWeeksFor(row);
    if (weeks.length === 0) {
      return { leagueId, outcome: 'skipped', weeks: 0, teams: teamRows.length, reason: 'no fantasy weeks' };
    }

    // forceRegenerate is pinned false: this path can never reach the DELETE.
    const { error } = await new MatchupService(this.admin).generateMatchupsForLeague(leagueId, teamRows, weeks, false);
    if (error) {
      const message = (error as { message?: string }).message ?? String(error);
      // A concurrent writer (the hook and the sweep, or two engine events)
      // beat us to it. The unique constraint makes that a benign race.
      if (/duplicate key|23505/i.test(message)) {
        return { leagueId, outcome: 'exists', weeks: weeks.length, teams: teamRows.length, reason: 'generated concurrently' };
      }
      logger.error('[ScheduleGenerationService] generate failed', { leagueId, message });
      return { leagueId, outcome: 'skipped', weeks: weeks.length, teams: teamRows.length, reason: message };
    }
    logger.info('[ScheduleGenerationService] schedule generated', { leagueId, weeks: weeks.length, teams: teamRows.length });
    return { leagueId, outcome: 'generated', weeks: weeks.length, teams: teamRows.length };
  }
}

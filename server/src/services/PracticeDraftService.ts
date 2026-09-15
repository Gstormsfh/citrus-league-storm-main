import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPracticeLeaguePayload,
  isPracticeLeagueSettings,
  PRACTICE_DRAFT_DEFAULT_PICK_SECONDS,
  PRACTICE_DRAFT_DEFAULT_ROUNDS,
  PRACTICE_DRAFT_DEFAULT_TEAM_COUNT,
} from '@citrus/shared';
import { LeagueService } from './LeagueService';
import { LeagueMembershipService } from './LeagueMembershipService';
import { AppError } from '../lib/errors';

/**
 * THE MOCK DRAFT IS A REAL DRAFT (2026-09-14).
 *
 * The practice draft was designed on 2026-08-09 as a throwaway league — one
 * human seat, every other seat AI — drafted in the live V2 room on the live
 * engine. The shared factory shipped; this, the server half, never did, and
 * the "Run a mock draft" buttons were pointed at the Armchair GM simulator
 * instead: a client-side picker with no engine, no clock and no league
 * scoring. This is the half that was missing.
 *
 * Nothing here is new machinery. The league is created through
 * LeagueService.createLeague, the same insert every real league goes
 * through, so it gets a join code, a commissioner team and the RLS the
 * room expects. The AI seats are the same owner_id=null rows the
 * commissioner's "fill with AI" writes. The room, the clock, the picks and
 * the autopick treatment are the V2 engine's own; the human presses Start
 * exactly as a commissioner does. The only things that make it a mock are
 * settings.practice = true, which keeps it out of league lists, the deploy
 * freeze gate and the nightly sweep, and the name.
 *
 * Launched from a league it inherits that league's size, rounds, roster
 * slots and scoring, so the mock scores the way the season will. From the
 * home page it takes the caller's size and the 21-round default.
 */
export interface CreatePracticeDraftOptions {
  /** Inherit size, rounds, roster slots and scoring from this league (caller must be a member). */
  fromLeagueId?: string;
  /** Seats in the mock, human included. Ignored when fromLeagueId is set. */
  teamsCount?: number;
  draftRounds?: number;
  pickTimeLimitSeconds?: number;
  /** Test injection for the name. */
  now?: string;
}

export interface PracticeDraftResult {
  leagueId: string;
  teamId: string;
  aiSeats: number;
}

const MIN_TEAMS = 2;
const MAX_TEAMS = 20;

export class PracticeDraftService {
  private readonly leagues: LeagueService;
  private readonly membership: LeagueMembershipService;

  constructor(private readonly user: SupabaseClient, private readonly admin: SupabaseClient) {
    this.leagues = new LeagueService(user);
    this.membership = new LeagueMembershipService(user);
  }

  async create(userId: string, options: CreatePracticeDraftOptions = {}): Promise<PracticeDraftResult> {
    let teamsCount = options.teamsCount ?? PRACTICE_DRAFT_DEFAULT_TEAM_COUNT;
    let draftRounds = options.draftRounds ?? PRACTICE_DRAFT_DEFAULT_ROUNDS;
    let rosterSize: number | undefined;
    let rosterSlots: Record<string, number> | undefined;
    let scoring: Record<string, number> | undefined;
    let draftType: string | undefined;

    if (options.fromLeagueId) {
      await this.membership.requireMembership(options.fromLeagueId, userId);
      const { data: source, error } = await this.user
        .from('leagues')
        .select('league_size, draft_rounds, roster_size, roster_slots, settings, scoring_settings')
        .eq('id', options.fromLeagueId)
        .single();
      if (error || !source) throw AppError.notFound('League');
      const s = source as {
        league_size: number | null; draft_rounds: number | null; roster_size: number | null;
        roster_slots: Record<string, number> | null; settings: Record<string, unknown> | null;
        scoring_settings: Record<string, number> | null;
      };
      if (isPracticeLeagueSettings(s.settings)) throw AppError.badRequest('A mock draft cannot be based on another mock draft');
      if (typeof s.league_size !== 'number' || s.league_size < MIN_TEAMS) {
        throw AppError.badRequest('Set the league size before running a mock draft from this league');
      }
      teamsCount = s.league_size;
      draftRounds = s.draft_rounds ?? draftRounds;
      rosterSize = s.roster_size ?? undefined;
      rosterSlots = (s.settings?.rosterSlots as Record<string, number> | undefined) ?? s.roster_slots ?? undefined;
      scoring = s.scoring_settings ?? undefined;
      draftType = typeof s.settings?.draftType === 'string' ? s.settings.draftType : undefined;
    }

    if (!Number.isInteger(teamsCount) || teamsCount < MIN_TEAMS || teamsCount > MAX_TEAMS) {
      throw AppError.badRequest(`A mock draft needs between ${MIN_TEAMS} and ${MAX_TEAMS} teams`);
    }
    if (!Number.isInteger(draftRounds) || draftRounds < 1 || draftRounds > 30) {
      throw AppError.badRequest('Draft rounds must be between 1 and 30');
    }

    const payload = buildPracticeLeaguePayload(userId, {
      teamsCount,
      draftRounds,
      pickTimeLimitSeconds: options.pickTimeLimitSeconds ?? PRACTICE_DRAFT_DEFAULT_PICK_SECONDS,
      now: options.now,
    });
    const settings: Record<string, unknown> = {
      ...payload.settings,
      leagueType: 'fantasy',
      teamsCount,
      ...(draftType ? { draftType } : {}),
      ...(rosterSlots ? { rosterSlots } : {}),
      ...(options.fromLeagueId ? { practiceOf: options.fromLeagueId } : {}),
    };

    const { league, team, error } = await this.leagues.createLeague(
      mockName(options.now),
      userId,
      rosterSize,
      draftRounds,
      settings,
      scoring,
    );
    if (error || !league || !team) {
      const detail = error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Could not create the mock draft';
      throw AppError.badRequest(detail);
    }

    // Every seat but the human's, in one insert, the same rows the
    // commissioner's "fill with AI" writes (owner_id null; admin client
    // because RLS has no user to attribute them to).
    const aiSeats = teamsCount - 1;
    const rows = Array.from({ length: aiSeats }, (_, i) => ({
      league_id: league.id,
      team_name: `AI Team ${i + 2}`,
      owner_id: null,
    }));
    const { error: fillError } = await this.admin.from('teams').insert(rows);
    if (fillError) throw AppError.internal('Could not seat the AI teams for the mock draft');

    return { leagueId: league.id as string, teamId: team.id as string, aiSeats };
  }
}

/** "Mock Draft 9/14 5:52 PM" — the ISO stamp keeps it unique per call. */
function mockName(now?: string): string {
  const at = now ? new Date(now) : new Date();
  const stamp = Number.isNaN(at.getTime()) ? new Date() : at;
  const label = stamp.toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' });
  return `Mock Draft ${label}`;
}

import { SupabaseClient } from '@supabase/supabase-js';
import {
  COLUMNS,
  DEFAULT_SCORING,
  logger,
  deriveStandings,
  rankStandings,
  getTodayMST,
  type StandingsMatchup,
  type StandingsTeamRef,
} from '@citrus/shared';
import { getSupabaseAdmin } from '../lib/supabase';
import { LeagueMembershipService } from './LeagueMembershipService';

// Demo league IDs that should never appear in user league lists
const DEMO_LEAGUE_IDS = new Set([
  '00000000-0000-0000-0000-000000000001',
  '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9',
]);

/**
 * LeagueService — Server-side league management with dependency-injected Supabase client.
 *
 * Extracted from apps/web/src/services/LeagueService.ts.
 * All business logic preserved; browser-specific code removed.
 */
export class LeagueService {
  private supabase: SupabaseClient;
  private membership: LeagueMembershipService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.membership = new LeagueMembershipService(supabase);
  }

  /** Get all leagues for a user (commissioner + team owner, deduplicated) */
  async getUserLeagues(userId: string) {
    const { data: commissionerLeagues } = await this.supabase
      .from('leagues')
      .select(COLUMNS.LEAGUE)
      .eq('commissioner_id', userId);

    const { data: teamData } = await this.supabase
      .from('teams')
      .select('league_id')
      .eq('owner_id', userId);

    const teamLeagueIds = (teamData || []).map((t: { league_id: string }) => t.league_id);

    let memberLeagues: Record<string, unknown>[] = [];
    if (teamLeagueIds.length > 0) {
      const { data } = await this.supabase
        .from('leagues')
        .select(COLUMNS.LEAGUE)
        .in('id', teamLeagueIds);
      memberLeagues = (data || []) as unknown as Record<string, unknown>[];
    }

    const allLeagues = [...(commissionerLeagues || []), ...memberLeagues];
    const unique = Array.from(new Map(allLeagues.map((l: Record<string, unknown>) => [l.id, l])).values());
    // Exclude demo leagues — they should only be visible to guests via public API.
    // SWEEP FIX (2026-08-16): also exclude soft-deleted leagues. Deletion
    // renames the league to a "[DELETED-<timestamp>]" prefix (no dedicated
    // column exists); without this filter the league switcher listed every
    // deleted test league — 130+ junk entries labeled "SEASON ACTIVE".
    const filtered = unique.filter((l: Record<string, unknown>) =>
      !DEMO_LEAGUE_IDS.has(l.id as string) &&
      !String((l as { name?: unknown }).name ?? '').startsWith('[DELETED'));

    // SWEEP FIX (2026-08-18): deterministic order, newest first.
    //
    // Neither query above carries an ORDER BY, and the two result sets are
    // concatenated, so the order Postgres happened to return decided which
    // league the app treated as active — LeagueContext falls through to
    // `filteredLeagues[0]` when there is no ?league= param, no in-session
    // selection and no localStorage entry.
    //
    // Field report (prod, 2026-08-18): an account in 18 leagues opened on a
    // playoff-roster-pool from April and got the playoff nav — Pool Home /
    // My Roster / NHL Bracket — instead of their season-long league. The nav
    // was right for the league it was given; the league was arbitrary.
    //
    // Newest-first is both deterministic and the better default: the league
    // you just created or joined is the one you meant to open.
    filtered.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const at = Date.parse(String(a.created_at ?? '')) || 0;
      const bt = Date.parse(String(b.created_at ?? '')) || 0;
      if (bt !== at) return bt - at;
      // Stable tiebreak so equal timestamps cannot reintroduce arbitrary order.
      return String(a.id).localeCompare(String(b.id));
    });

    return { leagues: filtered, error: null };
  }

  /** Get a specific league (membership-gated) */
  async getLeague(leagueId: string, userId: string) {
    await this.membership.requireMembership(leagueId, userId);

    const { data, error } = await this.supabase
      .from('leagues')
      .select(COLUMNS.LEAGUE)
      .eq('id', leagueId)
      .single();

    return { league: data, error };
  }

  /** Create a new league with commissioner team + optional FAAB budget */
  async createLeague(
    name: string,
    commissionerId: string,
    rosterSize?: number,
    draftRounds?: number,
    settings?: Record<string, any>,
    scoringSettings?: Record<string, number>,
    waiverSettings?: Record<string, any>,
  ) {
    // Determine league type from settings
    const leagueType = settings?.leagueType || 'fantasy';
    const isPool = leagueType !== 'fantasy';
    const teamsCount = settings?.teamsCount || null;

    // For pools: roster_size and draft_rounds should be 0
    // Use nullish coalescing (??) instead of || to preserve 0 values
    const effectiveRosterSize = rosterSize ?? (isPool ? 0 : 21);
    const effectiveDraftRounds = draftRounds ?? (isPool ? 0 : 21);
    // Pools don't need drafts
    const effectiveDraftStatus = isPool ? 'completed' : 'not_started';

    // Safeguard: every fantasy-scored league (season-long fantasy + playoff
    // roster pools) MUST have explicit scoring_settings. Otherwise the RPC
    // falls back to COALESCE defaults which could surprise commissioners
    // who thought they configured scoring. If caller didn't provide any,
    // write the standard default values explicitly so every stat is set.
    // The values are the shared DEFAULT_SCORING (single source:
    // packages/shared/src/constants/scoringDefaults.json) — copied so the
    // inserted row never aliases the shared constant.
    const DEFAULT_SCORING_SETTINGS = {
      skater: { ...DEFAULT_SCORING.skater },
      goalie: { ...DEFAULT_SCORING.goalie },
    };
    const needsFantasyScoring = leagueType === 'fantasy' || leagueType === 'playoff-roster-pool';
    const effectiveScoringSettings = scoringSettings
      ?? (needsFantasyScoring ? DEFAULT_SCORING_SETTINGS : null);

    // Build the insert row — include waiver columns if provided
    const insertRow: Record<string, unknown> = {
      name,
      commissioner_id: commissionerId,
      roster_size: effectiveRosterSize,
      draft_rounds: effectiveDraftRounds,
      draft_status: effectiveDraftStatus,
      league_size: teamsCount,
      settings: settings || {},
      scoring_settings: effectiveScoringSettings,
    };
    // SETTINGS PASS-THROUGH (2026-09-05): mirror the commissioner's slot
    // shape into the dedicated column (see updateRosterSlotSettings).
    if (settings?.rosterSlots && typeof settings.rosterSlots === 'object') {
      insertRow.roster_slots = settings.rosterSlots;
    }

    // Write waiver settings to dedicated columns (fantasy leagues)
    // These come merged into settings from the client, or via waiverSettings param
    const ws = waiverSettings || settings;
    if (ws?.waiver_type) insertRow.waiver_type = ws.waiver_type;
    if (ws?.waiver_process_time) insertRow.waiver_process_time = ws.waiver_process_time;
    if (ws?.waiver_period_hours) insertRow.waiver_period_hours = ws.waiver_period_hours;
    if (ws?.waiver_game_lock !== undefined) insertRow.waiver_game_lock = ws.waiver_game_lock;
    if (ws?.allow_trades_during_games !== undefined) insertRow.allow_trades_during_games = ws.allow_trades_during_games;

    // Create league
    const { data: leagueData, error: leagueError } = await this.supabase
      .from('leagues')
      .insert(insertRow)
      .select(COLUMNS.LEAGUE)
      .single();

    const league = leagueData as any;
    if (leagueError || !league) {
      return { league: null, team: null, error: leagueError };
    }

    // Get commissioner profile for default team name
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('username, first_name, last_name, default_team_name')
      .eq('id', commissionerId)
      .single();

    const teamName = profile?.default_team_name
      || (profile?.first_name ? `${profile.first_name}'s Team` : 'My Team');

    // Create commissioner's team
    const { data: teamData, error: teamError } = await this.supabase
      .from('teams')
      .insert({
        league_id: league.id,
        owner_id: commissionerId,
        team_name: teamName,
      })
      .select(COLUMNS.TEAM)
      .single();

    // F14(a) (2026-08-03): invalidate cached membership entry for the
    // (leagueId, commissionerId) pair. Node-side owner_id write ⇒
    // clearCache — the invariant that keeps the cache from serving
    // a stale isMember=false to the newly-owning commissioner.
    LeagueMembershipService.clearCache(league.id, commissionerId);
    const team = teamData as any;

    // Initialize FAAB budget if enabled.
    // 2026-08-24: accept BOTH key spellings — the settings dialog and the
    // budget-seeding path write camelCase `faabBudget`; older callers used
    // snake_case `faab_budget`. Prefer camelCase (JSONB settings convention).
    if (waiverSettings?.waiver_type === 'faab' || settings?.waiver_type === 'faab') {
      const initialBudget = waiverSettings?.faabBudget ?? waiverSettings?.faab_budget
        ?? settings?.faabBudget ?? settings?.faab_budget ?? 100;
      if (team) {
        await this.supabase.from('faab_budgets').insert({
          league_id: league.id,
          team_id: team.id,
          initial_budget: initialBudget,
          remaining_budget: initialBudget,
        });
      }
    }

    return { league, team, error: teamError };
  }

  /** Join a league using an invite code (atomic RPC) */
  async joinLeagueByCode(joinCode: string, userId: string, teamName?: string) {
    if (!joinCode || !userId) {
      return { league: null, team: null, error: 'Join code and user ID are required' };
    }

    const { data, error } = await this.supabase.rpc('join_league_with_code', {
      p_join_code: joinCode.trim(),
      p_user_id: userId,
      p_team_name: teamName || null,
    });

    if (error) {
      return { league: null, team: null, error: error.message };
    }

    // Parse RPC response — the function returns a flat JSONB object, not nested league/team
    let result;
    try {
      result = typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return { league: null, team: null, error: 'Invalid response from join league' };
    }

    if (result?.error) {
      return { league: null, team: null, error: result.error };
    }

    if (!result?.success) {
      return { league: null, team: null, error: 'Join failed unexpectedly' };
    }

    // Transform flat RPC response into the league/team structure the client expects
    return {
      league: result.league_id ? { id: result.league_id, name: result.league_name, settings: result.settings || {} } : null,
      team: result.team_id ? { id: result.team_id, team_name: result.team_name } : null,
      error: null,
    };
  }

  /** Update waiver settings (commissioner only) */
  async updateWaiverSettings(
    leagueId: string,
    userId: string,
    settings: {
      waiver_process_time?: string;
      waiver_period_hours?: number;
      waiver_game_lock?: boolean;
      waiver_type?: 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings';
      allow_trades_during_games?: boolean;
    },
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    // Read prior waiver_type + faabBudget so we can detect a flip TO faab
    // and seed budgets for existing teams. `join_league_with_code` seeds
    // FAAB budgets for the joining team only when the league is ALREADY
    // faab at join time — a subsequent flip via this endpoint left every
    // team without a budget row, which is why faab_budgets is empty in
    // prod today.
    const { data: priorLeague } = await this.supabase
      .from('leagues')
      .select('waiver_type, settings')
      .eq('id', leagueId)
      .single();
    const priorType = (priorLeague?.waiver_type as string) || 'rolling';
    const priorSettings = (priorLeague?.settings as Record<string, unknown>) || {};

    const { error } = await this.supabase
      .from('leagues')
      .update({
        waiver_process_time: settings.waiver_process_time,
        waiver_period_hours: settings.waiver_period_hours,
        waiver_game_lock: settings.waiver_game_lock,
        waiver_type: settings.waiver_type,
        allow_trades_during_games: settings.allow_trades_during_games,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (error) {
      return { success: false, error };
    }

    // FAAB budget seeding — fires on flip to faab AND on every save while
    // faab (idempotent via ON CONFLICT DO NOTHING). Uses admin client to
    // bypass RLS since the "system manages updates" policy on
    // faab_budgets requires service_role.
    const wantsFaab = settings.waiver_type === 'faab';
    const flipToFaab = wantsFaab && priorType !== 'faab';
    if (wantsFaab || flipToFaab) {
      const admin = getSupabaseAdmin();
      const initialBudget = Number(
        (priorSettings as { faabBudget?: number }).faabBudget ?? 100,
      );
      const { data: teams } = await admin
        .from('teams')
        .select('id')
        .eq('league_id', leagueId);
      const rows = ((teams || []) as Array<{ id: string }>).map(t => ({
        league_id: leagueId,
        team_id: t.id,
        initial_budget: initialBudget,
        remaining_budget: initialBudget,
      }));
      if (rows.length > 0) {
        // upsert with ON CONFLICT DO NOTHING semantics — existing budgets
        // (mid-season flip, prior season carryover) are preserved.
        const { error: budgetErr } = await admin
          .from('faab_budgets')
          .upsert(rows, {
            onConflict: 'league_id,team_id',
            ignoreDuplicates: true,
          });
        if (budgetErr) {
          logger.error('[updateWaiverSettings] faab_budgets seed failed:',
            budgetErr, 'league:', leagueId, 'teams:', rows.length);
          // Do NOT fail the settings save — the league record is already
          // updated. Surface the seed failure loudly for ops.
        } else {
          logger.info('[updateWaiverSettings] seeded faab_budgets for',
            rows.length, 'teams in league', leagueId, 'initialBudget=', initialBudget);
        }
      }
    }

    await this.notifyLeagueMembers(leagueId, 'Waiver settings have been updated by the commissioner.');

    return { success: true, error: null };
  }

  /** Update scoring settings (commissioner only, locked after games scored) */
  async updateScoringSettings(
    leagueId: string,
    userId: string,
    scoringSettings: { skater?: Record<string, number>; goalie?: Record<string, number> },
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    // Check if any matchups have been scored
    const { count } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId);

    if (count && count > 0) {
      return { success: false, error: 'Cannot change scoring after games have been scored' };
    }

    const { error } = await this.supabase
      .from('leagues')
      .update({
        scoring_settings: scoringSettings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, 'Scoring settings have been updated by the commissioner.');
    }

    return { success: !error, error };
  }

  /** Update draft settings (commissioner only) */
  async updateDraftSettings(
    leagueId: string,
    userId: string,
    draftSettings: { draft_rounds?: number; pickTimeLimit?: number; draft_status?: string; scheduled_draft_time?: string; teams_count?: number },
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings, draft_status')
      .eq('id', leagueId)
      .single();

    // SETTINGS PASS-THROUGH (2026-09-05): the league's size and the number
    // of rounds are the draft's geometry. submit_pick_v2 derives every
    // pick's round and on-clock team from league_size and draft_order, so
    // changing either once the draft has started corrupts every pick that
    // follows; and a size below the teams already in the league orphans
    // managers. Both are refused with the reason, not silently clamped.
    const geometryChange = draftSettings.teams_count !== undefined || draftSettings.draft_rounds !== undefined;
    if (geometryChange && league?.draft_status && league.draft_status !== 'not_started') {
      return {
        success: false,
        error: 'League size and draft rounds are locked once the draft has started.',
      };
    }
    if (draftSettings.teams_count !== undefined) {
      const { count } = await this.supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId);
      if (typeof count === 'number' && draftSettings.teams_count < count) {
        return {
          success: false,
          error: `This league already has ${count} teams; the size cannot be set below that.`,
        };
      }
    }

    const currentSettings = league?.settings || {};
    const updatedSettings = { ...currentSettings };
    if (draftSettings.pickTimeLimit !== undefined) {
      updatedSettings.pickTimeLimit = draftSettings.pickTimeLimit;
    }
    if (draftSettings.teams_count !== undefined) {
      updatedSettings.teamsCount = draftSettings.teams_count;
    }

    const updatePayload: Record<string, any> = {
      settings: updatedSettings,
      updated_at: new Date().toISOString(),
    };
    if (draftSettings.draft_rounds !== undefined) {
      updatePayload.draft_rounds = draftSettings.draft_rounds;
    }
    if (draftSettings.draft_status !== undefined) {
      updatePayload.draft_status = draftSettings.draft_status;
    }
    if (draftSettings.scheduled_draft_time !== undefined) {
      updatePayload.scheduled_draft_time = draftSettings.scheduled_draft_time;
    }
    if (draftSettings.teams_count !== undefined) {
      updatePayload.league_size = draftSettings.teams_count;
    }

    const { error } = await this.supabase
      .from('leagues')
      .update(updatePayload)
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, 'Draft settings have been updated by the commissioner.');
    }

    return { success: !error, error };
  }

  /** Update roster slot settings (commissioner only, locked after draft) */
  async updateRosterSlotSettings(
    leagueId: string,
    userId: string,
    rosterSlots: Record<string, number>,
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings, draft_status')
      .eq('id', leagueId)
      .single();

    if (league?.draft_status === 'completed') {
      return { success: false, error: 'Cannot change roster slots after draft is completed' };
    }

    const currentSettings = league?.settings || {};
    const updatedSettings = { ...currentSettings, rosterSlots };

    // Calculate new roster size from slots
    const newRosterSize = Object.values(rosterSlots).reduce((sum: number, v: number) => sum + (v || 0), 0);

    const { error } = await this.supabase
      .from('leagues')
      .update({
        settings: updatedSettings,
        roster_size: newRosterSize,
        // SETTINGS PASS-THROUGH (2026-09-05): the dedicated column carried
        // its default forever; settings.rosterSlots is what the app reads
        // (resolveSlotConfig), so the column mirrors it and never disagrees.
        roster_slots: rosterSlots,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, 'Roster slot settings have been updated by the commissioner.');
    }

    return { success: !error, error };
  }

  /** Get all teams in a league (uses RPC to avoid RLS recursion) */
  async getLeagueTeams(leagueId: string) {
    const { data, error } = await this.supabase.rpc('get_league_teams', {
      p_league_id: leagueId,
    });

    if (error) {
      // Fallback to direct query
      const { data: fallback, error: fbError } = await this.supabase
        .from('teams')
        .select(COLUMNS.TEAM)
        .eq('league_id', leagueId);
      return { teams: fallback || [], error: fbError };
    }

    return { teams: data || [], error: null };
  }

  /**
   * Owner avatars for a list of teams (2026-09-01, Sleeper parity audit M8).
   *
   * Teams have no picture of their own — a team-level avatar is a later
   * schema change — so the matchup header and scoreboard discs show the
   * OWNER's `profiles.avatar_url` and fall back to the team initial. One
   * explicit-column query for the whole league (`id, avatar_url`, the
   * "authenticated users can view all profiles" policy covers other
   * owners); AI teams (owner_id null) and owners without a picture come
   * back `null`. A failed profile read degrades to null everywhere rather
   * than failing the teams list — the picture is decoration, the list is
   * not.
   */
  async attachOwnerAvatars<T extends { owner_id?: string | null }>(
    teams: T[],
  ): Promise<Array<T & { avatar_url: string | null }>> {
    const ownerIds = [...new Set(teams.map((t) => t.owner_id).filter((id): id is string => !!id))];
    const avatarByOwner = new Map<string, string | null>();
    if (ownerIds.length > 0) {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, avatar_url')
        .in('id', ownerIds);
      if (error) {
        logger.warn('[LeagueService] owner avatars unavailable, serving initials:', error);
      }
      for (const p of (data || []) as Array<{ id: string; avatar_url: string | null }>) {
        avatarByOwner.set(p.id, p.avatar_url ?? null);
      }
    }
    return teams.map((t) => ({
      ...t,
      avatar_url: (t.owner_id && avatarByOwner.get(t.owner_id)) || null,
    }));
  }

  /** Get teams with owner profile names (and the owner's avatar, see attachOwnerAvatars) */
  async getLeagueTeamsWithOwners(leagueId: string) {
    const { teams, error } = await this.getLeagueTeams(leagueId);
    if (error || !teams.length) return { teams: [], error };

    const ownerIds = [...new Set(teams.map((t: { owner_id: string }) => t.owner_id).filter(Boolean))];
    type OwnerProfile = { id: string; username: string | null; display_name: string | null; first_name: string | null; last_name: string | null; avatar_url?: string | null };
    let profiles: OwnerProfile[] = [];
    if (ownerIds.length > 0) {
      const { data } = await this.supabase
        .from('profiles')
        .select('id, username, display_name, first_name, last_name, avatar_url')
        .in('id', ownerIds);
      profiles = (data || []) as OwnerProfile[];
    }

    // SWEEP FIX (2026-08-16): signup mints username 'user_<id-prefix>' with
    // display_name NULL, so owner labels rendered raw handles like
    // "user_c4489220" across roster/standings. Prefer display_name, then
    // real names, and never surface the generated handle — fall back to
    // "Manager" instead.
    const isGeneratedHandle = (u: string | null): boolean =>
      !!u && /^user_[0-9a-f]{6,}$/i.test(u);
    const profileMap = new Map(profiles.map((p: OwnerProfile) => [p.id, p]));
    const teamsWithOwners = teams.map((t: { owner_id: string; [key: string]: unknown }) => {
      const profile = profileMap.get(t.owner_id);
      const ownerName = profile
        ? (profile.display_name
            || (profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : null)
            || (isGeneratedHandle(profile.username) ? 'Manager' : profile.username)
            || 'Manager')
        : 'Unknown';
      return { ...t, owner_name: ownerName, avatar_url: profile?.avatar_url || null };
    });

    return { teams: teamsWithOwners, error: null };
  }

  /** Get the user's team in a specific league */
  async getUserTeam(leagueId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('teams')
      .select(COLUMNS.TEAM)
      .eq('league_id', leagueId)
      .eq('owner_id', userId)
      .maybeSingle();

    return { team: data, error };
  }

  /** Delete a team (commissioner only) */
  async deleteTeam(teamId: string, leagueId: string, userId: string) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { error } = await this.supabase
      .from('teams')
      .delete()
      .eq('id', teamId)
      .eq('league_id', leagueId);

    return { success: !error, error };
  }

  /** Add AI teams to fill a league (commissioner only) */
  async addAITeams(leagueId: string, userId: string, teamNames: string[]) {
    await this.membership.requireCommissioner(leagueId, userId);

    if (!teamNames.length) return { teams: [], error: null };

    const rows = teamNames.map(name => ({
      league_id: leagueId,
      team_name: name,
      owner_id: null,
    }));

    const { data, error } = await this.supabase
      .from('teams')
      .insert(rows)
      .select('id, team_name');

    // F14(a) (2026-08-03): AI teams have null owner_id; no user's
    // isMember flips as a result of THIS write. But the cache-clear
    // is called anyway per architect ruling — "the failure mode of
    // scoping tighter is exactly F14's species: a write path added
    // later that forgets." clearCache with no userId is a no-op on
    // an unknown key today, and future maintenance is protected.
    // (Global clear is not called here — that would nuke every
    // league's cache for a single-league admin action.)
    return { teams: data || [], error };
  }

  /** Update league settings (generic) */
  async updateSettings(leagueId: string, userId: string, settings: Record<string, any>, scoringSettings?: Record<string, any>) {
    await this.membership.requireCommissioner(leagueId, userId);

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (settings !== undefined) updatePayload.settings = settings;
    if (scoringSettings !== undefined) updatePayload.scoring_settings = scoringSettings;

    const { data, error } = await this.supabase
      .from('leagues')
      .update(updatePayload)
      .eq('id', leagueId)
      .select(COLUMNS.LEAGUE)
      .single();

    return { league: data, error };
  }

  /**
   * League standings, DERIVED from matchups.
   *
   * WHAT THIS USED TO DO, AND WHY IT WAS A PERMANENT 500 (fixed 2026-09-03):
   *
   *   .select('id, team_name, owner_id, wins, losses, ties, points_for, points_against')
   *
   * `teams` has six columns and always has: id, league_id, owner_id,
   * team_name, created_at, updated_at (verified against production
   * 2026-09-03; COLUMNS.TEAM says the same). There are no W/L/T columns and
   * nothing writes any. Every call therefore came back 42703 'column "wins"
   * does not exist' and GET /api/leagues/:leagueId/standings answered 500 on
   * every request it has ever served. The web app never noticed because
   * `leagueApi.getStandings` has no call sites in apps/web/src -- but the
   * route is live and documented, so a native client could hit it on day one.
   *
   * Removing the route would be a product decision and the wrong one for a
   * client that may already call it, so it now computes the same answer the
   * web app shows.
   *
   * THE RULE IS NOT WRITTEN HERE. `deriveStandings` in @citrus/shared is the
   * one implementation, and apps/web/src/services/StandingsService.ts calls
   * the same function over the same COLUMNS.MATCHUP rows. Same input, same
   * function, same output: this endpoint and the Standings page cannot
   * disagree about a league. Read packages/shared/src/utils/standings.ts
   * before changing what counts as a played week.
   */
  async getStandings(leagueId: string) {
    const [teamsRes, matchupsRes] = await Promise.all([
      this.supabase
        .from('teams')
        .select(COLUMNS.TEAM)
        .eq('league_id', leagueId),
      this.supabase
        .from('matchups')
        .select(COLUMNS.MATCHUP)
        .eq('league_id', leagueId),
    ]);

    if (teamsRes.error) return { standings: [], error: teamsRes.error };
    // A matchup read failure is not a standings failure: the league still has
    // teams, and 0-0-0 rows are truthful for a league with no results. Failing
    // the whole request here would put the route back where it started.
    if (matchupsRes.error) {
      logger.error('[LeagueService] standings: matchup read failed:', matchupsRes.error);
    }

    const teams = (teamsRes.data || []) as unknown as StandingsTeamRef[];
    const matchups = (matchupsRes.data || []) as unknown as StandingsMatchup[];

    const records = deriveStandings(
      teams.map((team) => team.id),
      matchups,
      getTodayMST(),
    );

    return { standings: rankStandings(teams, records), error: null };
  }

  /**
   * Fetch transactions for the league's Transactions tab.
   *
   * Returns processed roster moves from `transaction_ledger` PLUS pending and
   * failed waiver claims from `waiver_claims` so the tab reflects the full
   * activity a manager cares about (not just the subset that already settled).
   * Each row carries an explicit `status` (processed/pending/failed) so the
   * UI can badge them correctly.
   */
  async fetchTransactions(leagueId: string) {
    const [ledgerRes, waiverRes] = await Promise.all([
      this.supabase
        .from('transaction_ledger')
        .select(`${COLUMNS.TRANSACTION_LEDGER}, teams(team_name), profiles(username, first_name, last_name)`)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(50),
      // Pull the full waiver claim payload for pending/failed rows so the
      // Transactions tab can render the same rich "clears at / processes at"
      // card that the Waiver Wire page shows. priority + bid_amount +
      // drop_player_id + is_conditional_drop are needed to match the layout.
      this.supabase
        .from('waiver_claims')
        .select('id, league_id, team_id, player_id, drop_player_id, priority, bid_amount, is_conditional_drop, status, failure_reason, created_at, processed_at, teams(team_name)')
        .eq('league_id', leagueId)
        .in('status', ['pending', 'failed'])
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (ledgerRes.error) return { transactions: [], error: ledgerRes.error };

    type LedgerRow = Record<string, unknown> & { created_at: string };
    const ledgerRows: LedgerRow[] = ((ledgerRes.data || []) as unknown as LedgerRow[]).map((row) => ({
      ...row,
      status: 'processed',
      source_type: 'ledger',
    }));

    type WaiverRow = {
      id: string;
      league_id: string;
      team_id: string;
      player_id: string | number;
      drop_player_id: string | number | null;
      priority: number | null;
      bid_amount: number | null;
      is_conditional_drop: boolean | null;
      status: string;
      failure_reason: string | null;
      created_at: string;
      processed_at: string | null;
      // Supabase returns the joined table as either an object or an array
      // depending on the relationship. Tolerate both shapes.
      teams: { team_name: string } | { team_name: string }[] | null;
    };

    // Enrich pending waiver rows with waiver_clears_at + league waiver timing
    // using the same logic as WaiverService.enrichClaimsWithClearTime so the
    // Transactions tab can mirror the Waiver Wire "Active Waiver Claims" card.
    const waiverRawRows = ((waiverRes.data || []) as unknown as WaiverRow[]);
    const pendingWaiverRows = waiverRawRows.filter((r) => r.status === 'pending');
    const pendingPlayerIds = Array.from(new Set(
      pendingWaiverRows.map((r) => Number(r.player_id)).filter((n) => Number.isFinite(n))
    ));

    let periodHours = 48;
    let processTime = '02:00:00';
    const droppedAtByPlayer = new Map<number, string>();

    if (pendingPlayerIds.length > 0) {
      const admin = getSupabaseAdmin();
      const [waiverStatusRes, leagueRes] = await Promise.all([
        admin
          .from('player_waiver_status')
          .select('player_id, dropped_at, cleared_at')
          .eq('league_id', leagueId)
          .is('cleared_at', null)
          .in('player_id', pendingPlayerIds),
        admin
          .from('leagues')
          .select('waiver_period_hours, waiver_process_time')
          .eq('id', leagueId)
          .single(),
      ]);

      const leagueData = leagueRes.data as { waiver_period_hours?: number; waiver_process_time?: string } | null;
      if (leagueData?.waiver_period_hours != null) periodHours = leagueData.waiver_period_hours;
      if (leagueData?.waiver_process_time) processTime = leagueData.waiver_process_time;

      for (const row of ((waiverStatusRes.data || []) as Array<{ player_id: number; dropped_at: string }>)) {
        const prev = droppedAtByPlayer.get(row.player_id);
        if (!prev || new Date(row.dropped_at) > new Date(prev)) {
          droppedAtByPlayer.set(row.player_id, row.dropped_at);
        }
      }
    }

    const waiverRows: LedgerRow[] = waiverRawRows.map((row) => {
      const teams = Array.isArray(row.teams) ? (row.teams[0] ?? null) : row.teams;
      const droppedAt = droppedAtByPlayer.get(Number(row.player_id));
      const clearsAt = droppedAt
        ? new Date(new Date(droppedAt).getTime() + periodHours * 3600 * 1000).toISOString()
        : null;
      return {
        id: `wc-${row.id}`,
        league_id: row.league_id,
        user_id: null,
        team_id: row.team_id,
        type: row.status === 'failed' ? 'WAIVER_FAILED' : 'WAIVER_PENDING',
        player_id: String(row.player_id),
        drop_player_id: row.drop_player_id !== null ? String(row.drop_player_id) : null,
        source: 'Waiver Claim',
        created_at: row.created_at,
        teams,
        profiles: null,
        status: row.status,
        failure_reason: row.failure_reason,
        source_type: 'waiver_claim',
        priority: row.priority,
        bid_amount: row.bid_amount,
        is_conditional_drop: row.is_conditional_drop,
        waiver_dropped_at: droppedAt || null,
        waiver_clears_at: clearsAt,
        league_waiver_period_hours: periodHours,
        league_waiver_process_time: processTime,
      };
    });

    const combined = [...ledgerRows, ...waiverRows]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50);

    return { transactions: combined, error: null };
  }

  /** Update keeper/dynasty settings (commissioner only, locked after draft) */
  async updateKeeperSettings(
    leagueId: string,
    userId: string,
    keeperSettings: { keeperEnabled: boolean; keeperCount: number; keeperPenalty: string; dynastyMode: boolean },
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings, draft_status')
      .eq('id', leagueId)
      .single();

    if (league?.draft_status === 'completed') {
      return { success: false, error: 'Keeper settings cannot be changed after the draft is completed' };
    }

    const currentSettings = league?.settings || {};
    const { error } = await this.supabase
      .from('leagues')
      .update({
        settings: {
          ...currentSettings,
          keeperEnabled: keeperSettings.keeperEnabled,
          keeperCount: keeperSettings.keeperCount,
          keeperPenalty: keeperSettings.keeperPenalty,
          dynastyMode: keeperSettings.dynastyMode,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, 'Commissioner updated keeper/dynasty settings.');
    }

    return { success: !error, error };
  }

  /** Update category settings (commissioner only, locked after draft) */
  async updateCategorySettings(
    leagueId: string,
    userId: string,
    categories: string[],
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    if (!categories || categories.length < 2) {
      return { success: false, error: 'At least 2 categories are required' };
    }

    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings, draft_status')
      .eq('id', leagueId)
      .single();

    if (league?.draft_status === 'completed') {
      return { success: false, error: 'Category settings cannot be changed after the draft is completed' };
    }

    const currentSettings = league?.settings || {};
    const { error } = await this.supabase
      .from('leagues')
      .update({
        settings: { ...currentSettings, categories },
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, `Commissioner updated stat categories (${categories.length} categories).`);
    }

    return { success: !error, error };
  }

  /** Notify all league members via RPC (with fallback) */
  async notifyLeagueMembers(leagueId: string, message: string, title?: string) {
    try {
      await this.supabase.rpc('notify_league_members', {
        p_league_id: leagueId,
        p_message: message,
        p_title: title || 'League Update',
      });
    } catch {
      // Fallback: insert notifications directly for each team owner
      try {
        const { data: teams } = await this.supabase
          .from('teams')
          .select('owner_id')
          .eq('league_id', leagueId);

        if (teams && teams.length > 0) {
          const notifications = teams.map((t: { owner_id: string }) => ({
            user_id: t.owner_id,
            league_id: leagueId,
            type: 'SYSTEM',
            title: title || 'League Update',
            message,
          }));
          await this.supabase.from('notifications').insert(notifications);
        }
      } catch {
        // Silent fail — notifications are best-effort
      }
    }
  }
}

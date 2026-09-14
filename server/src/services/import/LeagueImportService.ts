/**
 * Orchestrates one league import: job row, raw payloads, per-season writes,
 * player crosswalk, trophy recompute.
 *
 * The writer is source-agnostic: it takes ImportedSeason. The two ESPN entry
 * points (discover, run) are thin: fetch, store raw, parse, write. A Yahoo
 * pair lands beside them on its own branch.
 *
 * Idempotent by construction. Every write keys on (league_id, platform,
 * external ids); re-running an import updates and never duplicates. A locked
 * league (history_locked) skips seasons it already has and only adds new ones.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { logger } from '@citrus/shared';
import type { ImportedSeason, ImportedPlayerRef, ImportPlatform } from '../../import/types';
import { NeedsCredentialsError, SourceThrottledError } from '../../import/types';
import { EspnClient, ESPN_VIEWS, type EspnCredentials } from '../../import/espn/client';
import { parseEspnSeason, type EspnPlayerInfo } from '../../import/espn/parse';
import { citrusSeasonToEspn, espnSeasonToCitrus } from '../../import/espn/maps';
import { ExternalIdentityService } from './ExternalIdentityService';
import { PlayerCrosswalkService } from './PlayerCrosswalkService';
import { TrophyService } from './TrophyService';

export type ImportJobStatus = 'queued' | 'discovering' | 'importing' | 'matching' | 'computing' | 'done' | 'partial' | 'failed' | 'needs_credentials';

export interface ImportJobRow {
  id: string; league_id: string; platform: string; external_league_id: string; requested_by: string;
  status: ImportJobStatus; seasons_discovered: number[]; seasons_imported: number[]; seasons_needing_credentials: number[];
  progress: Record<string, unknown>; error: Record<string, unknown> | null; started_at: string | null; finished_at: string | null; created_at: string;
}

export interface SeasonWriteResult {
  season: number; members_created: number; teams: number; matchups: number; picks: number; unmatched_players: number; warnings: string[];
}

export interface EspnRunOptions {
  leagueId: string; externalLeagueId: string; requestedBy: string; client: EspnClient;
  creds?: EspnCredentials; importerSwid?: string | null;
  /** Citrus start years to import; every discovered season when omitted. */
  seasons?: number[];
  /** ESPN seasonId the discover step already found, so the run does not probe for it again. */
  latestEspnSeason?: number;
  playerLookup?: (espnSeason: number, ids: number[]) => Promise<Map<number, EspnPlayerInfo>>;
}

export interface EspnDiscovery {
  leagueName: string | null;
  /** Citrus start year of the newest season found. */
  latestSeason: number;
  /** ESPN seasonId of that season; hand it back to the run so it skips the probe. */
  latestEspnSeason: number;
  seasons: number[];
  isPublic: boolean | null;
  scoringType: string;
  teamCount: number;
}

const JOB_COLUMNS = 'id, league_id, platform, external_league_id, requested_by, status, seasons_discovered, seasons_imported, seasons_needing_credentials, progress, error, started_at, finished_at, created_at';

export class LeagueImportService {
  private readonly identity: ExternalIdentityService;
  private readonly crosswalk: PlayerCrosswalkService;
  private readonly trophies: TrophyService;

  /**
   * @param supabase   user-scoped client (RLS enforced: the caller must be the commissioner)
   * @param admin      service-role client for the shared crosswalk table only
   */
  constructor(private readonly supabase: SupabaseClient, admin: SupabaseClient, deps?: { identity?: ExternalIdentityService; crosswalk?: PlayerCrosswalkService; trophies?: TrophyService }) {
    this.identity = deps?.identity ?? new ExternalIdentityService(supabase);
    this.crosswalk = deps?.crosswalk ?? new PlayerCrosswalkService(admin);
    this.trophies = deps?.trophies ?? new TrophyService(supabase);
  }

  // ---- jobs -----------------------------------------------------------------

  async createJob(leagueId: string, platform: ImportPlatform, externalLeagueId: string, requestedBy: string): Promise<ImportJobRow> {
    const { data, error } = await this.supabase
      .from('import_jobs')
      .insert({ league_id: leagueId, platform, external_league_id: externalLeagueId, requested_by: requestedBy, status: 'queued' })
      .select(JOB_COLUMNS)
      .single();
    if (error) throw new Error(`import_jobs insert failed: ${error.message}`);
    return data as ImportJobRow;
  }

  async getJob(jobId: string): Promise<ImportJobRow | null> {
    const { data, error } = await this.supabase.from('import_jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle();
    if (error) throw new Error(`import_jobs read failed: ${error.message}`);
    return (data as ImportJobRow | null) ?? null;
  }

  async updateJob(jobId: string, patch: Partial<Omit<ImportJobRow, 'id'>>): Promise<void> {
    const { error } = await this.supabase.from('import_jobs').update(patch).eq('id', jobId);
    if (error) throw new Error(`import_jobs update failed: ${error.message}`);
  }

  async storeRawPayload(jobId: string, leagueId: string, platform: ImportPlatform, endpoint: string, seasonKey: string | null, payload: unknown): Promise<void> {
    const text = JSON.stringify(payload ?? null);
    const sha = createHash('sha256').update(text).digest('hex');
    const { error } = await this.supabase
      .from('import_raw_payloads')
      .insert({ job_id: jobId, league_id: leagueId, platform, endpoint, external_season_key: seasonKey, payload: payload ?? null, payload_sha256: sha });
    if (error) throw new Error(`import_raw_payloads insert failed: ${error.message}`);
  }

  // ---- the writer (source-agnostic) ------------------------------------------

  async isHistoryLocked(leagueId: string): Promise<boolean> {
    const { data, error } = await this.supabase.from('leagues').select('id, history_locked').eq('id', leagueId).maybeSingle();
    if (error) throw new Error(`leagues read failed: ${error.message}`);
    return Boolean((data as { history_locked?: boolean } | null)?.history_locked);
  }

  async seasonExists(leagueId: string, season: number): Promise<boolean> {
    const { data, error } = await this.supabase.from('league_seasons').select('league_id, season').eq('league_id', leagueId).eq('season', season).maybeSingle();
    if (error) throw new Error(`league_seasons read failed: ${error.message}`);
    return data != null;
  }

  async writeSeason(
    leagueId: string, jobId: string, season: ImportedSeason,
    opts: { importerUserId: string; importerExternalId?: string | null; locked?: boolean },
  ): Promise<SeasonWriteResult> {
    const warnings = [...season.warnings];
    if (opts.locked && (await this.seasonExists(leagueId, season.season))) {
      return { season: season.season, members_created: 0, teams: 0, matchups: 0, picks: 0, unmatched_players: 0, warnings: [...warnings, 'League history is locked; existing season left untouched.'] };
    }

    const ids = await this.identity.resolveSeason(leagueId, season, { importerUserId: opts.importerUserId, importerExternalId: opts.importerExternalId ?? null });

    const memberFor = (teamId: string | null): string | null => (teamId ? ids.byTeamId.get(teamId) ?? null : null);
    // A season still in play has no champion, whatever the current standings say.
    // Otherwise the source's final standings name the champion (they carry a
    // commissioner's override when there was one); the bracket final is the
    // fallback, and the two are compared so a disagreement is flagged for a
    // person rather than silently resolved either way.
    const finished = season.isFinished;
    const rankOne = season.teams.find((t) => t.finalRank === 1) ?? null;
    const champTeam = finished ? rankOne ?? season.teams.find((t) => t.playoffFinish === 1) ?? null : null;
    const runnerTeam = finished ? season.teams.find((t) => t.finalRank === 2) ?? season.teams.find((t) => t.playoffFinish === 2) ?? null : null;
    const regularTeam = finished ? season.teams.find((t) => t.playoffSeed === 1) ?? null : null;
    const champFromBracket = season.matchups.find((m) => m.isChampionship && m.winner && m.winner !== 'tie');
    const bracketWinnerTeam = champFromBracket ? (champFromBracket.winner === 'home' ? champFromBracket.homeExternalTeamId : champFromBracket.awayExternalTeamId) : null;
    const verified = rankOne && bracketWinnerTeam ? rankOne.externalTeamId === bracketWinnerTeam : null;

    // league_seasons
    const { error: sErr } = await this.supabase.from('league_seasons').upsert({
      league_id: leagueId, season: season.season, platform: season.platform,
      external_league_id: season.externalLeagueId, external_season_key: season.externalSeasonKey,
      team_count: season.teams.length, scoring_type: season.settings.scoringType,
      champion_member_id: champTeam ? memberFor(champTeam.externalTeamId) : null,
      runner_up_member_id: runnerTeam ? memberFor(runnerTeam.externalTeamId) : null,
      regular_winner_id: regularTeam ? memberFor(regularTeam.externalTeamId) : null,
      champion_source: champTeam ? 'imported' : null,
      is_verified_by_bracket: verified,
      is_finished: finished,
      import_job_id: jobId, imported_by: opts.importerUserId, imported_at: new Date().toISOString(),
    }, { onConflict: 'league_id,season' });
    if (sErr) throw new Error(`league_seasons upsert failed: ${sErr.message}`);

    // league_season_teams
    const teamRows = season.teams.map((t) => ({
      league_id: leagueId, season: season.season, member_id: memberFor(t.externalTeamId),
      team_name: t.teamName, rank: t.finalRank, wins: t.wins, losses: t.losses, ties: t.ties,
      points_for: t.pointsFor, points_against: t.pointsAgainst, made_playoffs: t.madePlayoffs, playoff_finish: t.playoffFinish,
      external_team_id: t.externalTeamId, playoff_seed: t.playoffSeed, category_record: t.categoryRecord, final_rank_source: t.finalRankSource,
    })).filter((r) => r.member_id);
    if (teamRows.length) {
      const { error } = await this.supabase.from('league_season_teams').upsert(teamRows, { onConflict: 'league_id,season,member_id' });
      if (error) throw new Error(`league_season_teams upsert failed: ${error.message}`);
    }

    // league_season_matchups
    const matchupRows = season.matchups.map((m) => {
      const home = memberFor(m.homeExternalTeamId);
      const away = memberFor(m.awayExternalTeamId);
      if (!home) return null;
      const winner = m.winner === 'home' ? home : m.winner === 'away' ? away : null;
      return {
        league_id: leagueId, season: season.season, week: m.week,
        home_member_id: home, away_member_id: away,
        home_score: m.homeScore, away_score: m.awayScore,
        home_cat_wins: m.homeCatWins, home_cat_losses: m.homeCatLosses, home_cat_ties: m.homeCatTies,
        category_results: m.categoryResults,
        is_playoff: m.isPlayoff, is_consolation: m.isConsolation, is_championship: m.isChampionship,
        winner_member_id: winner, is_tie: m.winner === 'tie', source: season.platform, external_matchup_id: m.externalMatchupId,
      };
    }).filter((r): r is NonNullable<typeof r> => r != null);
    if (matchupRows.length) {
      const { error } = await this.supabase.from('league_season_matchups').upsert(matchupRows, { onConflict: 'league_id,season,week,home_member_id' });
      if (error) throw new Error(`league_season_matchups upsert failed: ${error.message}`);
    }

    // player crosswalk for picks and keeper designations
    const refs: ImportedPlayerRef[] = [...season.picks.map((p) => p.player), ...season.keepers.map((k) => k.player)];
    const resolved = refs.length ? await this.crosswalk.resolve(season.platform, refs, season.season) : new Map();
    let unmatched = 0;
    for (const r of resolved.values()) if (r.nhlPlayerId == null) unmatched += 1;

    const pickRows = season.picks.map((p) => ({
      league_id: leagueId, season: season.season, overall_pick: p.overallPick, round: p.round, pick_in_round: p.pickInRound,
      member_id: memberFor(p.externalTeamId), nhl_player_id: resolved.get(p.player.externalPlayerId)?.nhlPlayerId ?? null,
      external_player_id: p.player.externalPlayerId, external_player_name: p.player.name || null,
      is_keeper: p.isKeeper, keeper_cost: p.keeperCost, auction_cost: p.auctionCost, source: season.platform,
    }));
    if (pickRows.length) {
      const { error } = await this.supabase.from('league_season_drafts').upsert(pickRows, { onConflict: 'league_id,season,overall_pick' });
      if (error) throw new Error(`league_season_drafts upsert failed: ${error.message}`);
    }

    // external_league_links
    const { error: lErr } = await this.supabase.from('external_league_links').upsert({
      league_id: leagueId, platform: season.platform, external_league_id: season.externalLeagueId, external_season_key: season.externalSeasonKey,
      season: season.season, scoring_type: season.settings.scoringType, is_public_source: season.settings.isPublic, imported_by: opts.importerUserId,
      settings: season.settings,
    }, { onConflict: 'league_id,platform,external_league_id,external_season_key' });
    if (lErr) throw new Error(`external_league_links upsert failed: ${lErr.message}`);

    return { season: season.season, members_created: ids.created, teams: teamRows.length, matchups: matchupRows.length, picks: pickRows.length, unmatched_players: unmatched, warnings };
  }

  // ---- ESPN --------------------------------------------------------------------

  /**
   * Read the latest season's core view to learn what exists. No credentials
   * needed for a public league. In the weeks before a league is renewed for
   * the coming season ESPN has no row for it yet, so a plain miss on the
   * current season falls back one year; a credentials demand does not.
   */
  async discoverEspn(externalLeagueId: string, client: EspnClient, creds?: EspnCredentials, latestEspnSeason?: number): Promise<EspnDiscovery> {
    const espnSeason = latestEspnSeason ?? citrusSeasonToEspn(currentCitrusSeason());
    let core;
    try {
      core = await client.fetchSeason(externalLeagueId, espnSeason, [...ESPN_VIEWS.core], creds);
    } catch (e) {
      if (e instanceof NeedsCredentialsError || e instanceof SourceThrottledError || latestEspnSeason != null) throw e;
      logger.info('[import] espn current season missing, trying the previous one', { externalLeagueId, espnSeason, message: (e as Error).message });
      core = await client.fetchSeason(externalLeagueId, espnSeason - 1, [...ESPN_VIEWS.core], creds);
    }
    const parsed = parseEspnSeason(externalLeagueId, { core: core.body });
    const seasons = Array.from(new Set([...parsed.previousSeasons, parsed.season])).sort((a, b) => a - b);
    return {
      leagueName: parsed.settings.leagueName || null,
      latestSeason: parsed.season,
      latestEspnSeason: citrusSeasonToEspn(parsed.season),
      seasons,
      isPublic: parsed.settings.isPublic,
      scoringType: parsed.settings.scoringType,
      teamCount: parsed.teams.length,
    };
  }

  /**
   * Import every reachable season of an ESPN league into a Citrus league.
   * Seasons ESPN keeps behind a login are recorded on the job as
   * needing credentials; everything reachable is written and trophies computed.
   */
  async runEspn(opts: EspnRunOptions): Promise<ImportJobRow> {
    const job = await this.createJob(opts.leagueId, 'espn', opts.externalLeagueId, opts.requestedBy);
    return this.runEspnJob(job, opts);
  }

  /**
   * Create the job and return it immediately; the import continues in the
   * background of this persistent server process. The client polls getJob.
   * Credentials in opts live only in this closure and die with it.
   */
  async startEspn(opts: EspnRunOptions): Promise<ImportJobRow> {
    const job = await this.createJob(opts.leagueId, 'espn', opts.externalLeagueId, opts.requestedBy);
    void this.runEspnJob(job, opts).catch((e) => logger.error('[import] background espn job crashed', { jobId: job.id, message: (e as Error).message }));
    return job;
  }

  async runEspnJob(job: ImportJobRow, opts: EspnRunOptions): Promise<ImportJobRow> {
    const results: SeasonWriteResult[] = [];
    const needsCreds: number[] = [];
    const imported: number[] = [];
    const locked = await this.isHistoryLocked(opts.leagueId);
    try {
      await this.updateJob(job.id, { status: 'discovering', started_at: new Date().toISOString() });
      const discovery = await this.discoverEspn(opts.externalLeagueId, opts.client, opts.creds, opts.latestEspnSeason);
      const seasons = (opts.seasons?.length ? opts.seasons : discovery.seasons).sort((a, b) => a - b);
      await this.updateJob(job.id, { status: 'importing', seasons_discovered: seasons });

      for (const season of seasons) {
        const espnSeason = citrusSeasonToEspn(season);
        try {
          const core = await opts.client.fetchSeason(opts.externalLeagueId, espnSeason, [...ESPN_VIEWS.core], opts.creds);
          await this.storeRawPayload(job.id, opts.leagueId, 'espn', core.endpoint, String(espnSeason), core.body);
          let schedule: unknown = undefined;
          let draft: unknown = undefined;
          try {
            const s = await opts.client.fetchSeason(opts.externalLeagueId, espnSeason, [...ESPN_VIEWS.schedule], opts.creds);
            await this.storeRawPayload(job.id, opts.leagueId, 'espn', s.endpoint, String(espnSeason), s.body);
            schedule = s.body;
          } catch (e) {
            logger.warn('[import] espn schedule view unavailable', { season, message: (e as Error).message });
          }
          try {
            const d = await opts.client.fetchSeason(opts.externalLeagueId, espnSeason, [...ESPN_VIEWS.draft], opts.creds);
            await this.storeRawPayload(job.id, opts.leagueId, 'espn', d.endpoint, String(espnSeason), d.body);
            draft = d.body;
          } catch (e) {
            logger.warn('[import] espn draft view unavailable', { season, message: (e as Error).message });
          }
          let playersById: Map<number, EspnPlayerInfo> | undefined;
          if (opts.playerLookup) {
            const ids = collectPlayerIds(draft, core.body);
            if (ids.length) playersById = await opts.playerLookup(espnSeason, ids);
          }
          const parsed = parseEspnSeason(opts.externalLeagueId, { core: core.body, schedule, draft, playersById });
          const r = await this.writeSeason(opts.leagueId, job.id, parsed, { importerUserId: opts.requestedBy, importerExternalId: opts.importerSwid ?? null, locked });
          results.push(r);
          imported.push(season);
          await this.updateJob(job.id, { seasons_imported: imported, progress: { seasons: results } });
        } catch (e) {
          if (e instanceof NeedsCredentialsError) {
            needsCreds.push(season);
            await this.updateJob(job.id, { seasons_needing_credentials: needsCreds });
            continue;
          }
          if (e instanceof SourceThrottledError) {
            await this.updateJob(job.id, { status: 'partial', seasons_imported: imported, seasons_needing_credentials: needsCreds, error: { code: 'THROTTLED', message: e.message, retry_after_ms: e.retryAfterMs, season } });
            return (await this.getJob(job.id))!;
          }
          throw e;
        }
      }

      await this.updateJob(job.id, { status: 'computing' });
      await this.trophies.recompute(opts.leagueId, job.id);
      await this.markFounded(opts.leagueId, imported, 'espn');

      const status: ImportJobStatus = imported.length === 0 && needsCreds.length > 0 ? 'needs_credentials' : needsCreds.length > 0 ? 'partial' : 'done';
      await this.updateJob(job.id, { status, seasons_imported: imported, seasons_needing_credentials: needsCreds, progress: { seasons: results, discovery }, finished_at: new Date().toISOString() });
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      logger.error('[import] espn run failed', { jobId: job.id, message });
      await this.updateJob(job.id, { status: 'failed', seasons_imported: imported, error: { code: 'IMPORT_FAILED', message }, finished_at: new Date().toISOString() });
    }
    return (await this.getJob(job.id))!;
  }

  async markFounded(leagueId: string, seasons: number[], platform: ImportPlatform): Promise<void> {
    if (!seasons.length) return;
    const founded = Math.min(...seasons);
    const { data, error } = await this.supabase.from('leagues').select('id, founded_season').eq('id', leagueId).maybeSingle();
    if (error) throw new Error(`leagues read failed: ${error.message}`);
    const current = (data as { founded_season?: number | null } | null)?.founded_season ?? null;
    const patch: Record<string, unknown> = { imported_from: platform };
    if (current == null || founded < current) patch.founded_season = founded;
    const { error: uErr } = await this.supabase.from('leagues').update(patch).eq('id', leagueId);
    if (uErr) throw new Error(`leagues update failed: ${uErr.message}`);
  }
}

/** Ids that will need names: every pick and every keeper designation. */
export function collectPlayerIds(draft: unknown, core: unknown): number[] {
  const ids = new Set<number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = draft, c: any = core;
  for (const p of d?.draftDetail?.picks ?? []) if (p?.playerId != null) ids.add(Number(p.playerId));
  for (const t of c?.teams ?? []) for (const id of t?.draftStrategy?.keeperPlayerIds ?? []) ids.add(Number(id));
  return Array.from(ids).filter((n) => Number.isFinite(n));
}

/** Citrus start year of the season currently in play or about to start. */
export function currentCitrusSeason(now = new Date()): number {
  // NHL seasons start in October; treat July onward as the coming season.
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? y : y - 1;
}

export { espnSeasonToCitrus };

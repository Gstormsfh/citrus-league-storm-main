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
import type { YahooClient } from '../../import/yahoo/client';
import { parseYahooSeason, mapYahooScoringType, playerIdFromKey, type YahooPlayerInfo } from '../../import/yahoo/parse';
import { renewToLeagueKey, splitLeagueKey } from '../../import/yahoo/maps';
import { asList, num, bool, str } from '../../import/yahoo/normalize';
import { ExternalIdentityService } from './ExternalIdentityService';
import { PlayerCrosswalkService } from './PlayerCrosswalkService';
import { TrophyService } from './TrophyService';

export type ImportJobStatus = 'queued' | 'discovering' | 'importing' | 'matching' | 'computing' | 'done' | 'partial' | 'failed' | 'needs_credentials';

export type ImportJobMethod = 'api' | 'screenshot' | 'paste';

export interface ImportJobRow {
  id: string; league_id: string; platform: string; external_league_id: string; requested_by: string; method: ImportJobMethod;
  status: ImportJobStatus; seasons_discovered: number[]; seasons_imported: number[]; seasons_needing_credentials: number[];
  progress: Record<string, unknown>; error: Record<string, unknown> | null; started_at: string | null; finished_at: string | null; created_at: string;
}

export interface SeasonWriteResult {
  season: number; members_created: number; teams: number; matchups: number; picks: number; transactions: number; unmatched_players: number; warnings: string[];
  /** Future picks recorded as having changed hands (screenshot imports; API parsers cannot see them). */
  pick_ownership?: number;
  /** The league's own named awards written for this season. */
  awards?: number;
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

export interface YahooRunOptions {
  leagueId: string;
  /** The league_key of whichever season the user picked; the chain is walked from there. */
  leagueKey: string;
  requestedBy: string;
  client: YahooClient;
  /** The importer's Yahoo guid, from the connection, so their own row is claimed on the spot. */
  importerGuid?: string | null;
  /** Citrus start years to import; every season in the chain when omitted. */
  seasons?: number[];
}

export interface YahooLeagueSeason {
  leagueKey: string; leagueId: string; gameId: string; season: number; name: string;
  isFinished: boolean; scoringType: string; numTeams: number | null; renew: string | null; renewed: string | null;
}

export interface YahooChain {
  /** league_key of the newest season; what the client sends back to start an import. */
  key: string;
  name: string;
  latestSeason: number;
  scoringType: string;
  numTeams: number | null;
  seasons: YahooLeagueSeason[];
}

export interface YahooDiscovery {
  guid: string | null;
  chains: YahooChain[];
}

const JOB_COLUMNS = 'id, league_id, platform, external_league_id, requested_by, method, status, seasons_discovered, seasons_imported, seasons_needing_credentials, progress, error, started_at, finished_at, created_at';

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

  async createJob(leagueId: string, platform: ImportPlatform, externalLeagueId: string, requestedBy: string, method: ImportJobMethod = 'api'): Promise<ImportJobRow> {
    const { data, error } = await this.supabase
      .from('import_jobs')
      .insert({ league_id: leagueId, platform, external_league_id: externalLeagueId, requested_by: requestedBy, status: 'queued', method })
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
      return { season: season.season, members_created: 0, teams: 0, matchups: 0, picks: 0, transactions: 0, unmatched_players: 0, pick_ownership: 0, warnings: [...warnings, 'League history is locked; existing season left untouched.'] };
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

    // league_season_keepers: the keeper list as the source showed it, kept for
    // the carry-over into the next Citrus draft. Replaced as a set per season
    // and source; a keeper the crosswalk could not place keeps its name.
    if (season.keepers.length) {
      const keeperRows = season.keepers.map((k) => ({
        league_id: leagueId, season: season.season, member_id: memberFor(k.externalTeamId),
        external_player_id: k.player.externalPlayerId, external_player_name: k.player.name || null,
        nhl_player_id: resolved.get(k.player.externalPlayerId)?.nhlPlayerId ?? null,
        round: k.round, round_next: k.roundNext, years_kept: null, source: season.platform,
      })).filter((r): r is typeof r & { member_id: string } => Boolean(r.member_id));
      const { error: kdErr } = await this.supabase.from('league_season_keepers').delete().eq('league_id', leagueId).eq('season', season.season).eq('source', season.platform);
      if (kdErr) throw new Error(`league_season_keepers replace failed: ${kdErr.message}`);
      if (keeperRows.length) {
        const { error: kErr } = await this.supabase.from('league_season_keepers').upsert(keeperRows, { onConflict: 'league_id,season,member_id,external_player_id' });
        if (kErr) throw new Error(`league_season_keepers upsert failed: ${kErr.message}`);
      }
    }

    // league_season_transactions: the dedupe index is an expression index, which
    // PostgREST's on_conflict cannot target, so a season's rows from this source
    // are replaced as a set. They are source facts, re-derivable from the raw payload.
    let transactionRows = 0;
    if (season.transactions.length) {
      const txRefs = season.transactions.map((t) => t.player).filter((p): p is ImportedPlayerRef => p != null && Boolean(p.externalPlayerId));
      const txResolved = txRefs.length ? await this.crosswalk.resolve(season.platform, txRefs, season.season) : new Map();
      const rows = season.transactions.map((t) => ({
        league_id: leagueId, season: season.season, occurred_at: t.occurredAt, type: t.type,
        member_id: memberFor(t.externalTeamId), counterparty_member_id: memberFor(t.counterpartyExternalTeamId),
        nhl_player_id: t.player ? txResolved.get(t.player.externalPlayerId)?.nhlPlayerId ?? null : null,
        external_player_id: t.player?.externalPlayerId ?? null, external_player_name: t.player?.name || null,
        // A traded draft pick is an asset like any other; dynasty trades are mostly picks.
        pick_season: t.pick?.season ?? null, pick_round: t.pick?.round ?? null,
        pick_original_member_id: t.pick?.originalExternalTeamId ? memberFor(t.pick.originalExternalTeamId) : null,
        faab_bid: t.faabBid, external_transaction_id: t.externalTransactionId, source: season.platform,
      }));
      const { error: dErr } = await this.supabase.from('league_season_transactions').delete().eq('league_id', leagueId).eq('season', season.season).eq('source', season.platform);
      if (dErr) throw new Error(`league_season_transactions replace failed: ${dErr.message}`);
      const { error: iErr } = await this.supabase.from('league_season_transactions').insert(rows);
      if (iErr) throw new Error(`league_season_transactions insert failed: ${iErr.message}`);
      transactionRows = rows.length;
    }

    // league_pick_ownership: who owns which future pick, the state a dynasty
    // league carries into its next draft. A page of traded picks is a full
    // snapshot for the draft seasons it shows, so this source's unapplied rows
    // for those seasons are replaced as a set; a row already applied to a
    // Citrus draft order is history and stays.
    let ownershipRows = 0;
    if (season.pickOwnership?.length) {
      const rows = season.pickOwnership.map((o) => ({
        league_id: leagueId, draft_season: o.draftSeason, round: o.round,
        original_member_id: memberFor(o.originalExternalTeamId), owner_member_id: memberFor(o.ownerExternalTeamId), source: season.platform,
      })).filter((r): r is typeof r & { original_member_id: string; owner_member_id: string } => Boolean(r.original_member_id && r.owner_member_id));
      const draftSeasons = Array.from(new Set(rows.map((r) => r.draft_season)));
      if (draftSeasons.length) {
        const { error: dErr } = await this.supabase.from('league_pick_ownership').delete().eq('league_id', leagueId).eq('source', season.platform).in('draft_season', draftSeasons).is('applied_at', null);
        if (dErr) throw new Error(`league_pick_ownership replace failed: ${dErr.message}`);
      }
      if (rows.length) {
        const { error: oErr } = await this.supabase.from('league_pick_ownership').upsert(rows, { onConflict: 'league_id,draft_season,round,original_member_id' });
        if (oErr) throw new Error(`league_pick_ownership upsert failed: ${oErr.message}`);
      }
      ownershipRows = rows.length;
      if (rows.length < season.pickOwnership.length) warnings.push(`${season.pickOwnership.length - rows.length} traded pick(s) named a team no manager matched and were not recorded.`);
    }

    // league_trophies: the league's own awards, under the league's own names.
    // trophy_key 'custom' with source 'imported'; a recompute leaves these
    // alone (nothing in the season tables could rebuild them). Re-importing
    // the same season replaces its imported awards; all-time awards (season
    // null) are replaced as a set too, since they ride on one page.
    let awardRows = 0;
    if (season.awards?.length) {
      const dated = season.awards.filter((a) => a.season != null);
      const allTime = season.awards.filter((a) => a.season == null);
      const retire = async (seasonFilter: number | null) => {
        let q = this.supabase.from('league_trophies').update({ retired_at: new Date().toISOString() })
          .eq('league_id', leagueId).eq('trophy_key', 'custom').eq('source', 'imported').is('retired_at', null);
        q = seasonFilter == null ? q.is('season', null) : q.eq('season', seasonFilter);
        const { error } = await q;
        if (error) throw new Error(`league_trophies retire failed: ${error.message}`);
      };
      if (dated.length) await retire(season.season);
      if (allTime.length) await retire(null);
      const rows = [...dated, ...allTime].map((a) => ({
        league_id: leagueId, season: a.season, member_id: a.externalTeamId ? memberFor(a.externalTeamId) : null,
        trophy_key: 'custom', rank: null, value: null, source: 'imported', computed_from_job_id: jobId,
        display_name: a.name, detail: { award: a.name, winner_name: a.winnerName, note: a.note, platform: season.platform },
      }));
      const { error: aErr } = await this.supabase.from('league_trophies').insert(rows);
      if (aErr) throw new Error(`league_trophies insert failed: ${aErr.message}`);
      awardRows = rows.length;
    }

    // external_league_links
    const { error: lErr } = await this.supabase.from('external_league_links').upsert({
      league_id: leagueId, platform: season.platform, external_league_id: season.externalLeagueId, external_season_key: season.externalSeasonKey,
      season: season.season, scoring_type: season.settings.scoringType, is_public_source: season.settings.isPublic, imported_by: opts.importerUserId,
      settings: season.settings,
    }, { onConflict: 'league_id,platform,external_league_id,external_season_key' });
    if (lErr) throw new Error(`external_league_links upsert failed: ${lErr.message}`);

    return { season: season.season, members_created: ids.created, teams: teamRows.length, matchups: matchupRows.length, picks: pickRows.length, transactions: transactionRows, unmatched_players: unmatched, pick_ownership: ownershipRows, awards: awardRows, warnings };
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
      const credentials = e instanceof NeedsCredentialsError;
      await this.updateJob(job.id, { status: credentials ? 'needs_credentials' : 'failed', seasons_imported: imported, error: { code: credentials ? 'NEEDS_CREDENTIALS' : 'IMPORT_FAILED', message }, finished_at: new Date().toISOString() });
    }
    return (await this.getJob(job.id))!;
  }

  /** The record book, recomputed from the season tables; every import path ends here. */
  async recomputeTrophies(leagueId: string, jobId: string): Promise<void> {
    await this.trophies.recompute(leagueId, jobId);
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

  // ---- Yahoo -------------------------------------------------------------------

  /**
   * Every NHL league the connected Yahoo account has been in, grouped into
   * chains by renew/renewed so "The Puck Stops Here" shows once with its
   * eleven seasons rather than eleven times.
   */
  async discoverYahoo(client: YahooClient): Promise<YahooDiscovery> {
    const res = await client.userLeagues();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any = res.content ?? {};
    const user = asList<any>(content.users)[0] ?? {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    const guid = str(user.guid);
    const leagues = new Map<string, YahooLeagueSeason>();
    for (const game of asList<any>(user.games)) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (str(game?.code) && str(game.code) !== 'nhl') continue;
      for (const l of asList<any>(game?.leagues)) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const key = str(l?.league_key);
        const parts = key ? splitLeagueKey(key) : null;
        const season = num(l?.season) ?? num(game?.season);
        if (!key || !parts || season == null) continue;
        leagues.set(key, {
          leagueKey: key, leagueId: parts.leagueId, gameId: parts.gameId, season, name: str(l.name) ?? 'Untitled league',
          isFinished: bool(l.is_finished) ?? false, scoringType: mapYahooScoringType(str(l.scoring_type)),
          numTeams: num(l.num_teams), renew: renewToLeagueKey(l.renew), renewed: renewToLeagueKey(l.renewed),
        });
      }
    }
    return { guid, chains: chainYahooLeagues(Array.from(leagues.values())) };
  }

  async runYahoo(opts: YahooRunOptions): Promise<ImportJobRow> {
    const job = await this.createJob(opts.leagueId, 'yahoo', opts.leagueKey, opts.requestedBy);
    return this.runYahooJob(job, opts);
  }

  async startYahoo(opts: YahooRunOptions): Promise<ImportJobRow> {
    const job = await this.createJob(opts.leagueId, 'yahoo', opts.leagueKey, opts.requestedBy);
    void this.runYahooJob(job, opts).catch((e) => logger.error('[import] background yahoo job crashed', { jobId: job.id, message: (e as Error).message }));
    return job;
  }

  /**
   * Walk the renew chain from the picked season to the league's first season,
   * then import every season oldest first: one bundle, one scoreboard per
   * week, the keeper list, player names for the draft, the transaction log.
   */
  async runYahooJob(job: ImportJobRow, opts: YahooRunOptions): Promise<ImportJobRow> {
    const results: SeasonWriteResult[] = [];
    const needsCreds: number[] = [];
    const imported: number[] = [];
    const locked = await this.isHistoryLocked(opts.leagueId);
    try {
      await this.updateJob(job.id, { status: 'discovering', started_at: new Date().toISOString() });
      const chain = await this.walkYahooChain(job, opts);
      const wanted = new Set(opts.seasons ?? []);
      const seasons = chain.filter((s) => !wanted.size || wanted.has(s.season)).sort((a, b) => a.season - b.season);
      await this.updateJob(job.id, { status: 'importing', seasons_discovered: seasons.map((s) => s.season) });

      for (const s of seasons) {
        try {
          const bundle = await opts.client.league(s.leagueKey);
          await this.storeRawPayload(job.id, opts.leagueId, 'yahoo', bundle.endpoint, s.gameId, bundle.raw);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const league: any = (bundle.content as any)?.league ?? {};
          const scoringType = mapYahooScoringType(str(league.scoring_type) ?? str(league.settings?.scoring_type));
          const hasMatchups = scoringType === 'h2h_categories' || scoringType === 'h2h_one_win' || scoringType === 'h2h_points';

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const scoreboards: any[] = [];
          if (hasMatchups) {
            const start = num(league.start_week) ?? 1;
            const end = num(league.end_week) ?? num(league.current_week) ?? start;
            for (let w = start; w <= end; w++) {
              const sb = await opts.client.scoreboard(s.leagueKey, w);
              await this.storeRawPayload(job.id, opts.leagueId, 'yahoo', sb.endpoint, s.gameId, sb.raw);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              scoreboards.push((sb.content as any)?.league ?? {});
            }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let keepers: any = undefined;
          try {
            const k = await opts.client.keepers(s.leagueKey);
            await this.storeRawPayload(job.id, opts.leagueId, 'yahoo', k.endpoint, s.gameId, k.raw);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            keepers = (k.content as any)?.league;
          } catch (e) {
            if (e instanceof SourceThrottledError) throw e;
            logger.warn('[import] yahoo keeper list unavailable', { season: s.season, message: (e as Error).message });
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let transactions: any = undefined;
          try {
            const t = await opts.client.transactions(s.leagueKey);
            await this.storeRawPayload(job.id, opts.leagueId, 'yahoo', t.endpoint, s.gameId, t.raw);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transactions = (t.content as any)?.league;
          } catch (e) {
            if (e instanceof SourceThrottledError) throw e;
            logger.warn('[import] yahoo transactions unavailable', { season: s.season, message: (e as Error).message });
          }

          // Draft picks carry only player keys; fetch the names the crosswalk needs.
          const playerKeys = Array.from(new Set(asList<any>(league.draft_results).map((p) => str(p?.player_key)).filter((k): k is string => Boolean(k)))); // eslint-disable-line @typescript-eslint/no-explicit-any
          const playersById = new Map<string, YahooPlayerInfo>();
          if (playerKeys.length) {
            try {
              for (const page of await opts.client.players(s.leagueKey, playerKeys)) {
                await this.storeRawPayload(job.id, opts.leagueId, 'yahoo', page.endpoint, s.gameId, page.raw);
                for (const p of asList<any>((page.content as any)?.league?.players)) { // eslint-disable-line @typescript-eslint/no-explicit-any
                  const id = str(p?.player_id) ?? playerIdFromKey(p?.player_key);
                  if (!id) continue;
                  playersById.set(id, {
                    playerId: id, fullName: str(p?.name?.full) ?? '', teamAbbr: str(p?.editorial_team_abbr),
                    uniformNumber: str(p?.uniform_number), position: str(p?.display_position) ?? str(p?.primary_position),
                  });
                }
              }
            } catch (e) {
              if (e instanceof SourceThrottledError) throw e;
              logger.warn('[import] yahoo player names unavailable', { season: s.season, message: (e as Error).message });
            }
          }

          const parsed = parseYahooSeason({ league, scoreboards, keepers, transactions, playersById });
          const r = await this.writeSeason(opts.leagueId, job.id, parsed, { importerUserId: opts.requestedBy, importerExternalId: opts.importerGuid ?? null, locked });
          results.push(r);
          imported.push(s.season);
          await this.updateJob(job.id, { seasons_imported: imported, progress: { seasons: results } });
        } catch (e) {
          if (e instanceof NeedsCredentialsError) {
            needsCreds.push(s.season);
            await this.updateJob(job.id, { seasons_needing_credentials: needsCreds });
            continue;
          }
          if (e instanceof SourceThrottledError) {
            await this.updateJob(job.id, { status: 'partial', seasons_imported: imported, seasons_needing_credentials: needsCreds, error: { code: 'THROTTLED', message: e.message, retry_after_ms: e.retryAfterMs, season: s.season } });
            return (await this.getJob(job.id))!;
          }
          throw e;
        }
      }

      await this.updateJob(job.id, { status: 'computing' });
      await this.trophies.recompute(opts.leagueId, job.id);
      await this.markFounded(opts.leagueId, imported, 'yahoo');

      const status: ImportJobStatus = imported.length === 0 && needsCreds.length > 0 ? 'needs_credentials' : needsCreds.length > 0 ? 'partial' : 'done';
      await this.updateJob(job.id, { status, seasons_imported: imported, seasons_needing_credentials: needsCreds, progress: { seasons: results, chain: chain.map((c) => ({ leagueKey: c.leagueKey, season: c.season, name: c.name })) }, finished_at: new Date().toISOString() });
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      logger.error('[import] yahoo run failed', { jobId: job.id, message });
      const code = e instanceof NeedsCredentialsError ? 'NEEDS_CREDENTIALS' : 'IMPORT_FAILED';
      await this.updateJob(job.id, { status: e instanceof NeedsCredentialsError ? 'needs_credentials' : 'failed', seasons_imported: imported, error: { code, message }, finished_at: new Date().toISOString() });
    }
    return (await this.getJob(job.id))!;
  }

  /** Every season of the league, oldest first, by following renew backward and renewed forward from the picked key. */
  private async walkYahooChain(job: ImportJobRow, opts: YahooRunOptions): Promise<YahooLeagueSeason[]> {
    const seen = new Map<string, YahooLeagueSeason>();
    const read = async (key: string): Promise<YahooLeagueSeason | null> => {
      if (seen.has(key)) return seen.get(key)!;
      const res = await opts.client.leagueMeta(key);
      const parts = splitLeagueKey(key);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const l: any = (res.content as any)?.league ?? {};
      const season = num(l.season);
      if (!parts || season == null) return null;
      await this.storeRawPayload(job.id, opts.leagueId, 'yahoo', res.endpoint, parts.gameId, res.raw);
      const row: YahooLeagueSeason = {
        leagueKey: key, leagueId: parts.leagueId, gameId: parts.gameId, season, name: str(l.name) ?? '',
        isFinished: bool(l.is_finished) ?? false, scoringType: mapYahooScoringType(str(l.scoring_type)),
        numTeams: num(l.num_teams), renew: renewToLeagueKey(l.renew), renewed: renewToLeagueKey(l.renewed),
      };
      seen.set(key, row);
      return row;
    };
    const start = await read(opts.leagueKey);
    if (!start) throw new Error(`Yahoo league ${opts.leagueKey} could not be read`);
    for (let prev = start.renew, hops = 0; prev && hops < 40; hops++) {
      const row = await read(prev);
      if (!row) break;
      prev = row.renew;
    }
    for (let next = start.renewed, hops = 0; next && hops < 40; hops++) {
      const row = await read(next);
      if (!row) break;
      next = row.renewed;
    }
    return Array.from(seen.values()).sort((a, b) => a.season - b.season);
  }
}

/** Group seasons into leagues by their renew/renewed links; newest chain first. */
export function chainYahooLeagues(leagues: YahooLeagueSeason[]): YahooChain[] {
  const byKey = new Map(leagues.map((l) => [l.leagueKey, l]));
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const l of leagues) {
    parent.set(l.leagueKey, find(l.leagueKey));
    if (l.renew && byKey.has(l.renew)) union(l.leagueKey, l.renew);
    if (l.renewed && byKey.has(l.renewed)) union(l.leagueKey, l.renewed);
  }
  const groups = new Map<string, YahooLeagueSeason[]>();
  for (const l of leagues) {
    const root = find(l.leagueKey);
    groups.set(root, [...(groups.get(root) ?? []), l]);
  }
  return Array.from(groups.values())
    .map((seasons) => {
      const sorted = [...seasons].sort((a, b) => a.season - b.season);
      const latest = sorted[sorted.length - 1];
      return { key: latest.leagueKey, name: latest.name, latestSeason: latest.season, scoringType: latest.scoringType, numTeams: latest.numTeams, seasons: sorted };
    })
    .sort((a, b) => b.latestSeason - a.latestSeason || a.name.localeCompare(b.name));
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

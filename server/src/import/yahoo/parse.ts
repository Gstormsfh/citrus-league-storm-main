/**
 * Yahoo Fantasy Hockey payloads (already through `unpack`) -> ImportedSeason.
 *
 * Everything Yahoo-specific lives here. Field names follow the Yahoo Fantasy
 * Sports API resource docs and the yfpy / yahoo_fantasy_api models; shapes
 * were checked against captured responses (see fixtures/yahoo). Where a
 * field is absent the parser degrades and records a warning rather than
 * inventing a value.
 *
 * Conventions:
 *   - Yahoo `season` for hockey is the START year (2023 = 2023-24), which is
 *     Citrus's convention, so no conversion.
 *   - A league is a different object every season (new league_key, new
 *     league_id). `externalLeagueId` is therefore the season's full
 *     league_key and `externalSeasonKey` its game id.
 *   - `head` leagues count categories in outcome_totals, exactly like ESPN's
 *     category record; the matchup record is derived from the scoreboard.
 *   - Player ids (`player_id`) are stable across seasons; player_keys are not.
 */
import type {
  ImportedSeason, ImportedTeam, ImportedMatchup, ImportedPick, ImportedKeeperDesignation,
  ImportedManager, ImportedScoringItem, ImportedScoringType, ImportedCategoryResult, ImportedPlayerRef, ImportedTransaction,
} from '../types';
import { num, bool, str, asList } from './normalize';
import { resolveYahooStat, REVERSE_KEYS, YAHOO_SCORING_TYPE, yahooSlot, splitLeagueKey } from './maps';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Yahoo payloads are untyped by nature
type Json = any;

export interface YahooSeasonPayloads {
  /** Unpacked `league/{key};out=metadata,settings,standings,teams,draftresults` -> the `league` object. Required. */
  league: Json;
  /** Unpacked scoreboard `league` objects, one per week (each carries `scoreboard.week` and `scoreboard.matchups`). */
  scoreboards?: Json[];
  /** Unpacked `league/{key}/players;status=K;out=ownership` -> the `league` object. Optional. */
  keepers?: Json;
  /** Unpacked `league/{key}/transactions` -> the `league` object. Optional. */
  transactions?: Json;
  /** player_id -> details, for picks and keepers whose names are not in the payloads. Optional. */
  playersById?: Map<string, YahooPlayerInfo>;
}

export interface YahooPlayerInfo {
  playerId: string;
  fullName: string;
  teamAbbr?: string | null;
  uniformNumber?: string | null;
  position?: string | null;
}

export function mapYahooScoringType(raw: string | null | undefined): ImportedScoringType {
  return (raw && YAHOO_SCORING_TYPE[raw]) || 'unknown';
}

/** "388.l.27081.t.4" -> "4" */
export function teamIdFromKey(teamKey: string | null | undefined): string | null {
  const m = (teamKey ?? '').match(/\.t\.(\d+)$/);
  return m ? m[1] : null;
}

/** "388.p.6743" -> "6743" */
export function playerIdFromKey(playerKey: string | null | undefined): string | null {
  const m = (playerKey ?? '').match(/\.p\.(\d+)$/);
  return m ? m[1] : null;
}

export function yahooPlayerRef(p: Json, info?: YahooPlayerInfo): ImportedPlayerRef {
  const id = str(p?.player_id) ?? playerIdFromKey(p?.player_key) ?? info?.playerId ?? '';
  const position = str(p?.display_position) ?? str(p?.primary_position) ?? info?.position ?? null;
  return {
    externalPlayerId: id,
    name: str(p?.name?.full) ?? info?.fullName ?? '',
    teamAbbr: str(p?.editorial_team_abbr) ?? info?.teamAbbr ?? null,
    jerseyNumber: str(p?.uniform_number) ?? info?.uniformNumber ?? null,
    position: position ? position.split(',')[0].trim() : null,
  };
}

function managersOf(team: Json): ImportedManager[] {
  const list = asList<Json>(team?.managers).filter((m) => m && str(m.guid));
  // Yahoo lists the primary manager first; make sure a co-manager never leads.
  const primary = list.filter((m) => !bool(m.is_comanager));
  const co = list.filter((m) => bool(m.is_comanager));
  // nickname and guid only. Yahoo includes an email for the signed-in manager;
  // it is deliberately not carried: claiming works by token or list-pick.
  return [...primary, ...co].map((m) => ({
    externalManagerId: String(m.guid),
    displayName: str(m.nickname) ?? 'Unknown manager',
  }));
}

export function parseYahooSeason(payloads: YahooSeasonPayloads): ImportedSeason {
  const league = payloads.league ?? {};
  const warnings: string[] = [];
  const leagueKey = str(league.league_key);
  if (!leagueKey) throw new Error('Yahoo league payload has no league_key');
  const parts = splitLeagueKey(leagueKey);
  if (!parts) throw new Error(`Yahoo league_key "${leagueKey}" is not {game}.l.{id}`);
  const season = num(league.season);
  if (season == null) throw new Error('Yahoo league payload has no season');

  const settings = league.settings ?? {};
  const scoringTypeRaw = str(league.scoring_type) ?? str(settings.scoring_type);
  const scoringType = mapYahooScoringType(scoringTypeRaw);
  if (scoringType === 'unknown') warnings.push(`Unrecognised Yahoo scoring_type "${scoringTypeRaw}"; records are disabled for this season until a person confirms the format.`);
  const isCategories = scoringType === 'h2h_categories' || scoringType === 'h2h_one_win';
  const hasMatchups = scoringType === 'h2h_categories' || scoringType === 'h2h_one_win' || scoringType === 'h2h_points';

  // ---- settings -----------------------------------------------------------
  const modifiers = new Map<number, number>();
  for (const m of asList<Json>(settings.stat_modifiers?.stats)) {
    const id = num(m?.stat_id); const v = num(m?.value);
    if (id != null && v != null) modifiers.set(id, v);
  }
  const scoringItems: ImportedScoringItem[] = [];
  for (const s of asList<Json>(settings.stat_categories?.stats)) {
    const id = num(s?.stat_id);
    if (id == null) continue;
    if (bool(s.is_only_display_stat)) continue; // shown on the page, never scored
    const def = resolveYahooStat(id, str(s.display_name) ?? str(s.name), str(s.position_type));
    if (!def.known) warnings.push(`Yahoo stat id ${id} ("${str(s.display_name) ?? str(s.name) ?? '?'}") is not in the translation table; carried as ${def.citrusKey}.`);
    const sortOrder = num(s.sort_order);
    scoringItems.push({
      sourceStatId: String(id),
      citrusKey: def.citrusKey,
      group: def.group,
      points: isCategories || scoringType === 'roto' ? null : (modifiers.get(id) ?? null),
      reverse: sortOrder === 0 || (sortOrder == null && REVERSE_KEYS.has(def.citrusKey)),
      enabled: bool(s.enabled) ?? true,
    });
  }
  const rosterSlots = asList<Json>(settings.roster_positions)
    .map((r) => ({ slot: yahooSlot(String(r?.position ?? '')), count: num(r?.count) ?? 0 }))
    .filter((r) => r.slot && r.count > 0);

  const startWeek = num(league.start_week) ?? num(settings.start_week) ?? 1;
  const endWeek = num(league.end_week) ?? num(settings.end_week) ?? null;
  const playoffStart = num(settings.playoff_start_week);
  const usesPlayoff = bool(settings.uses_playoff) ?? (playoffStart != null);
  const multiweekFinal = bool(settings.has_multiweek_championship) ?? false;
  const regularSeasonWeeks = playoffStart != null && usesPlayoff ? playoffStart - startWeek : endWeek != null ? endWeek - startWeek + 1 : null;
  const playoffWeeks = playoffStart != null && endWeek != null && usesPlayoff ? endWeek - playoffStart + 1 : null;
  const isAuction = bool(settings.is_auction_draft) ?? false;
  const draftTypeRaw = str(settings.draft_type);
  const draftType = isAuction ? 'AUCTION' : draftTypeRaw === 'live' ? 'SNAKE' : draftTypeRaw === 'offline' ? 'OFFLINE' : draftTypeRaw ? draftTypeRaw.toUpperCase() : null;

  // ---- teams --------------------------------------------------------------
  const isFinished = bool(league.is_finished) ?? false;
  const teamsRaw: Json[] = asList<Json>(league.standings?.teams).length ? asList<Json>(league.standings.teams) : asList<Json>(league.teams);
  if (!teamsRaw.length) warnings.push('No teams in the Yahoo payload for this season.');

  // ---- scoreboard ---------------------------------------------------------
  const matchups: ImportedMatchup[] = [];
  const matchupRecord = new Map<string, { w: number; l: number; t: number }>();
  const bump = (teamId: string, key: 'w' | 'l' | 't') => {
    const r = matchupRecord.get(teamId) ?? { w: 0, l: 0, t: 0 };
    r[key] += 1;
    matchupRecord.set(teamId, r);
  };
  const statKeyOf = (statId: number) => {
    const item = scoringItems.find((i) => i.sourceStatId === String(statId));
    return item?.citrusKey ?? resolveYahooStat(statId, null).citrusKey;
  };

  for (const sbLeague of payloads.scoreboards ?? []) {
    const sb = sbLeague?.scoreboard ?? sbLeague;
    const weekOfBoard = num(sb?.week);
    for (const m of asList<Json>(sb?.matchups)) {
      const week = num(m?.week) ?? weekOfBoard;
      const teams = asList<Json>(m?.teams);
      if (week == null || teams.length === 0) continue;
      const home = teams[0]; const away = teams[1] ?? null;
      const homeId = teamIdFromKey(home?.team_key);
      if (!homeId) continue;
      const awayId = away ? teamIdFromKey(away.team_key) : null;
      const isPlayoff = bool(m.is_playoffs) ?? (playoffStart != null && usesPlayoff && week >= playoffStart);
      const isConsolation = bool(m.is_consolation) ?? false;
      const isChampionship = isPlayoff && !isConsolation && endWeek != null && week === endWeek;
      const finished = str(m.status) ? str(m.status) === 'postevent' : true;

      let winner: ImportedMatchup['winner'] = null;
      if (finished) {
        if (bool(m.is_tied)) winner = 'tie';
        else {
          const w = teamIdFromKey(m.winner_team_key);
          winner = w == null ? null : w === homeId ? 'home' : w === awayId ? 'away' : null;
        }
      }

      let homeScore: number | null = null, awayScore: number | null = null;
      let homeCatWins: number | null = null, homeCatLosses: number | null = null, homeCatTies: number | null = null;
      let categoryResults: ImportedCategoryResult[] | null = null;
      if (isCategories) {
        const homeStats = new Map<number, number | null>(asList<Json>(home?.team_stats?.stats).map((s) => [num(s?.stat_id) ?? -1, num(s?.value)]));
        const awayStats = new Map<number, number | null>(asList<Json>(away?.team_stats?.stats).map((s) => [num(s?.stat_id) ?? -1, num(s?.value)]));
        const winners = asList<Json>(m.stat_winners);
        categoryResults = winners.map((sw) => {
          const id = num(sw?.stat_id) ?? -1;
          const wk = teamIdFromKey(sw?.winner_team_key);
          const res: ImportedCategoryResult['winner'] = bool(sw?.is_tied) ? 'tie' : wk === homeId ? 'home' : wk === awayId ? 'away' : null;
          return { statKey: statKeyOf(id), home: homeStats.get(id) ?? null, away: awayStats.get(id) ?? null, winner: res };
        });
        if (winners.length) {
          homeCatWins = categoryResults.filter((c) => c.winner === 'home').length;
          homeCatLosses = categoryResults.filter((c) => c.winner === 'away').length;
          homeCatTies = categoryResults.filter((c) => c.winner === 'tie').length;
        } else {
          // Without stat_winners, team_points.total in a category league is the category-win count.
          homeCatWins = num(home?.team_points?.total);
          homeCatLosses = num(away?.team_points?.total);
          homeCatTies = null;
          if (finished) warnings.push(`Week ${week}: Yahoo returned no per-category winners; category ties for that week are unknown.`);
        }
      } else {
        homeScore = num(home?.team_points?.total);
        awayScore = num(away?.team_points?.total);
      }

      if (awayId && winner && !isConsolation) {
        if (winner === 'home') { bump(homeId, 'w'); bump(awayId, 'l'); }
        else if (winner === 'away') { bump(awayId, 'w'); bump(homeId, 'l'); }
        else { bump(homeId, 't'); bump(awayId, 't'); }
      }

      matchups.push({
        week, homeExternalTeamId: homeId, awayExternalTeamId: awayId,
        homeScore, awayScore, homeCatWins, homeCatLosses, homeCatTies, categoryResults,
        isPlayoff, isConsolation, isChampionship, winner,
        externalMatchupId: null,
      });
    }
  }
  if (hasMatchups && (payloads.scoreboards?.length ?? 0) === 0) warnings.push('No scoreboard weeks in the Yahoo payload; weekly results not imported.');
  if (multiweekFinal && matchups.some((m) => m.isChampionship)) warnings.push('This league plays a two-week championship; the final is recorded as its last week.');

  const champMatch = matchups.find((m) => m.isChampionship && m.winner && m.winner !== 'tie');
  const bracketChampion = champMatch ? (champMatch.winner === 'home' ? champMatch.homeExternalTeamId : champMatch.awayExternalTeamId) : null;
  const bracketRunnerUp = champMatch ? (champMatch.winner === 'home' ? champMatch.awayExternalTeamId : champMatch.homeExternalTeamId) : null;

  const teams: ImportedTeam[] = teamsRaw.map((t) => {
    const id = str(t.team_id) ?? teamIdFromKey(t.team_key) ?? '';
    const st = t.team_standings ?? {};
    const rank = isFinished ? num(st.rank) : null;
    const totals = st.outcome_totals ?? {};
    const rec = matchupRecord.get(id);
    const seed = num(st.playoff_seed);
    const playoffTeams = num(settings.num_playoff_teams);
    const clinched = bool(t.clinched_playoffs);
    const playoffFinish = bracketChampion === id ? 1 : bracketRunnerUp === id ? 2 : (rank === 1 && !champMatch ? 1 : rank === 2 && !champMatch ? 2 : null);
    return {
      externalTeamId: id,
      teamName: str(t.name) ?? `Team ${id}`,
      managers: managersOf(t),
      finalRank: rank,
      finalRankSource: rank != null ? 'source_final' : null,
      playoffSeed: seed && seed > 0 ? seed : null,
      wins: isCategories ? (rec?.w ?? null) : num(totals.wins),
      losses: isCategories ? (rec?.l ?? null) : num(totals.losses),
      ties: isCategories ? (rec?.t ?? null) : num(totals.ties),
      pointsFor: isCategories ? null : (num(st.points_for) ?? num(t.team_points?.total)),
      pointsAgainst: isCategories ? null : num(st.points_against),
      categoryRecord: isCategories && totals.wins != null ? `${num(totals.wins) ?? 0}-${num(totals.losses) ?? 0}-${num(totals.ties) ?? 0}` : null,
      // clinched_playoffs is present only on teams that clinched; once the season is over, absent means no.
      madePlayoffs: clinched ?? (seed != null && playoffTeams != null ? seed > 0 && seed <= playoffTeams : isFinished ? false : null),
      playoffFinish,
    };
  });

  const rankOne = teams.find((t) => t.finalRank === 1);
  if (champMatch && rankOne && bracketChampion !== rankOne.externalTeamId) {
    warnings.push(`Final standings say team ${rankOne.externalTeamId} finished first but the playoff final was won by team ${bracketChampion}. Champion left unverified for a person to confirm.`);
  }

  // ---- keepers ------------------------------------------------------------
  const keepers: ImportedKeeperDesignation[] = [];
  const keeperByPlayerId = new Map<string, { cost: string | null; teamId: string | null }>();
  // Yahoo's is_keeper flags are "1" / "" in practice; any non-empty value that is not a plain no counts.
  const flagOn = (v: unknown) => bool(v) ?? (str(v) != null);
  for (const p of asList<Json>(payloads.keepers?.players)) {
    const flag = p?.is_keeper;
    if (!flag || !(flagOn(flag.status) || flagOn(flag.kept))) continue;
    const ref = yahooPlayerRef(p, payloads.playersById?.get(str(p.player_id) ?? ''));
    if (!ref.externalPlayerId) continue;
    const teamId = teamIdFromKey(p?.ownership?.owner_team_key);
    const cost = str(flag.cost);
    keeperByPlayerId.set(ref.externalPlayerId, { cost, teamId });
    if (teamId) keepers.push({ externalTeamId: teamId, player: ref, round: num(flag.cost), roundNext: null });
  }

  // ---- draft --------------------------------------------------------------
  const picksRaw = asList<Json>(league.draft_results);
  const picks: ImportedPick[] = picksRaw
    .filter((p) => p && p.player_key)
    .map((p) => {
      const playerId = playerIdFromKey(p.player_key) ?? '';
      const keeper = keeperByPlayerId.get(playerId);
      const teamId = teamIdFromKey(p.team_key);
      if (keeper && !keeper.teamId && teamId) {
        // The keepers list did not say whose player it is; the draft does.
        keeper.teamId = teamId;
        keepers.push({ externalTeamId: teamId, player: yahooPlayerRef({ player_key: p.player_key }, payloads.playersById?.get(playerId)), round: num(keeper.cost), roundNext: null });
      }
      return {
        overallPick: num(p.pick) ?? 0,
        round: num(p.round),
        pickInRound: null,
        externalTeamId: teamId,
        player: yahooPlayerRef({ player_key: p.player_key }, payloads.playersById?.get(playerId)),
        isKeeper: keeper != null,
        keeperCost: keeper?.cost ? `round ${keeper.cost}` : null,
        auctionCost: num(p.cost) || null,
      };
    })
    .filter((p) => p.overallPick > 0)
    .sort((a, b) => a.overallPick - b.overallPick);
  if (!picksRaw.length) warnings.push('No draft results in the Yahoo payload for this season; picks not imported.');

  // ---- transactions -------------------------------------------------------
  const transactions: ImportedTransaction[] = [];
  for (const tr of asList<Json>(payloads.transactions?.transactions)) {
    const type = str(tr?.type);
    const kind: ImportedTransaction['type'] = type === 'trade' ? 'trade' : type === 'add' ? 'add' : type === 'drop' ? 'drop' : type === 'add/drop' ? 'add' : type === 'commish' ? 'commish' : 'unknown';
    const at = num(tr?.timestamp);
    const players = asList<Json>(tr?.players);
    if (!players.length) {
      transactions.push({ externalTransactionId: str(tr?.transaction_id), occurredAt: at != null ? new Date(at * 1000).toISOString() : null, type: kind, externalTeamId: teamIdFromKey(tr?.trader_team_key), counterpartyExternalTeamId: teamIdFromKey(tr?.tradee_team_key), player: null, faabBid: num(tr?.faab_bid) });
      continue;
    }
    for (const p of players) {
      const td = p?.transaction_data ?? {};
      const moveType = str(td.type);
      const t: ImportedTransaction['type'] = kind === 'trade' ? 'trade' : moveType === 'add' ? 'add' : moveType === 'drop' ? 'drop' : kind;
      const from = teamIdFromKey(td.source_team_key);
      const to = teamIdFromKey(td.destination_team_key);
      transactions.push({
        externalTransactionId: str(tr?.transaction_id),
        occurredAt: at != null ? new Date(at * 1000).toISOString() : null,
        type: t === 'add' && str(td.source_type) === 'waivers' ? 'waiver' : t,
        externalTeamId: t === 'drop' ? from : to ?? from,
        counterpartyExternalTeamId: kind === 'trade' ? (t === 'drop' ? to : from) : null,
        player: yahooPlayerRef(p),
        faabBid: num(tr?.faab_bid),
      });
    }
  }

  return {
    platform: 'yahoo',
    externalLeagueId: leagueKey,
    externalSeasonKey: parts.gameId,
    season,
    isFinished,
    settings: {
      leagueName: str(league.name) ?? '',
      scoringType,
      scoringItems,
      rosterSlots,
      regularSeasonWeeks,
      playoffTeamCount: usesPlayoff ? num(settings.num_playoff_teams) : null,
      playoffWeeks,
      keeperCount: keepers.length && teams.length ? Math.max(...teams.map((t) => keepers.filter((k) => k.externalTeamId === t.externalTeamId).length)) : null,
      keeperOrderType: null,
      draftType,
      usesFaab: bool(settings.uses_faab),
      isPublic: str(league.league_type) ? str(league.league_type) === 'public' : null,
    },
    teams,
    matchups,
    picks,
    keepers,
    transactions,
    previousSeasons: [],
    warnings,
  };
}

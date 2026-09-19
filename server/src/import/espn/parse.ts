/**
 * ESPN fhl payloads -> ImportedSeason.
 *
 * Everything ESPN-specific lives here. Field names were confirmed against a
 * real 2020 hockey keeper-league payload (location/nickname era) and the
 * documented current shape (name era, rankCalculatedFinal/rankFinal,
 * playoffTierType only in mMatchupScore). Where a field is absent the parser
 * degrades and records a warning rather than inventing a value.
 */
import type {
  ImportedSeason, ImportedTeam, ImportedMatchup, ImportedPick, ImportedKeeperDesignation,
  ImportedManager, ImportedScoringItem, ImportedScoringType, ImportedCategoryResult, ImportedPlayerRef,
} from '../types';
import { ESPN_STAT_MAP, ESPN_SLOT_MAP, ESPN_PRO_TEAM_MAP, ESPN_POSITION_MAP, espnSeasonToCitrus } from './maps';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ESPN payloads are untyped by nature
type Json = any;

export interface EspnPlayerInfo {
  id: number;
  fullName: string;
  proTeamId?: number;
  defaultPositionId?: number;
  jersey?: string | number;
}

export interface EspnSeasonPayloads {
  /** mSettings + mTeam (one request). Required. */
  core: Json;
  /** mMatchupScore. Optional; without it playoff tiers are inferred. */
  schedule?: Json;
  /** mDraftDetail. Optional. */
  draft?: Json;
  /** Player lookups for ids that appear in picks/keepers. Optional. */
  playersById?: Map<number, EspnPlayerInfo>;
}

export function mapEspnScoringType(raw: string | undefined): ImportedScoringType {
  switch (raw) {
    case 'H2H_CATEGORY': return 'h2h_categories';
    case 'H2H_POINTS': return 'h2h_points';
    case 'H2H_MOST_CATEGORIES': return 'h2h_one_win';
    case 'ROTO': return 'roto';
    case 'TOTAL_SEASON_POINTS': return 'points';
    default: return 'unknown';
  }
}

export function espnTeamName(team: Json): string {
  const name = typeof team?.name === 'string' ? team.name.trim() : '';
  if (name) return name;
  const loc = typeof team?.location === 'string' ? team.location.trim() : '';
  const nick = typeof team?.nickname === 'string' ? team.nickname.trim() : '';
  return `${loc} ${nick}`.trim() || `Team ${team?.id ?? '?'}`;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function playerRef(id: number, info: EspnPlayerInfo | undefined): ImportedPlayerRef {
  return {
    externalPlayerId: String(id),
    name: info?.fullName ?? '',
    teamAbbr: info?.proTeamId != null ? (ESPN_PRO_TEAM_MAP[info.proTeamId] ?? null) : null,
    jerseyNumber: info?.jersey != null ? String(info.jersey) : null,
    position: info?.defaultPositionId != null ? (ESPN_POSITION_MAP[info.defaultPositionId] ?? null) : null,
  };
}

export function parseEspnSeason(leagueId: string, payloads: EspnSeasonPayloads): ImportedSeason {
  const core = payloads.core ?? {};
  const warnings: string[] = [];
  const espnSeasonId = Number(core.seasonId);
  if (!Number.isFinite(espnSeasonId)) {
    throw new Error('ESPN payload has no seasonId');
  }
  const season = espnSeasonToCitrus(espnSeasonId);
  const settingsRaw = core.settings ?? {};
  const scoringType = mapEspnScoringType(settingsRaw?.scoringSettings?.scoringType);
  if (scoringType === 'unknown') {
    warnings.push(`Unrecognised ESPN scoringType "${settingsRaw?.scoringSettings?.scoringType}"; records are disabled for this season until a person confirms the format.`);
  }
  const isCategories = scoringType === 'h2h_categories' || scoringType === 'h2h_one_win';

  // ---- settings -----------------------------------------------------------
  const scoringItems: ImportedScoringItem[] = [];
  for (const item of settingsRaw?.scoringSettings?.scoringItems ?? []) {
    const id = Number(item.statId);
    const def = ESPN_STAT_MAP[id];
    if (!def) warnings.push(`ESPN stat id ${id} is not in the translation table; carried as unknown_espn_${id}.`);
    scoringItems.push({
      sourceStatId: String(id),
      citrusKey: def?.citrusKey ?? `unknown_espn_${id}`,
      group: def?.group ?? 'unknown',
      points: isCategories ? null : toNum(item.points),
      reverse: Boolean(item.isReverseItem),
      enabled: true,
    });
  }
  const rosterSlots = Object.entries(settingsRaw?.rosterSettings?.lineupSlotCounts ?? {})
    .map(([slotId, count]) => ({ slot: ESPN_SLOT_MAP[Number(slotId)] ?? `slot_${slotId}`, count: Number(count) }))
    .filter((s) => s.count > 0);

  const sched = settingsRaw?.scheduleSettings ?? {};
  const regularSeasonWeeks = toNum(sched.matchupPeriodCount);
  const draftSettings = settingsRaw?.draftSettings ?? {};

  // ---- members / teams ----------------------------------------------------
  const membersById = new Map<string, ImportedManager>();
  for (const m of core.members ?? []) {
    if (!m?.id) continue;
    membersById.set(String(m.id), {
      externalManagerId: String(m.id),
      // displayName only. ESPN returns firstName/lastName even for public
      // leagues; we deliberately do not carry them for unclaimed members.
      displayName: String(m.displayName ?? '').trim() || 'Unknown manager',
    });
  }

  const teamsRaw: Json[] = core.teams ?? [];
  const teamRankOne = teamsRaw.find((t) => finalRankOf(t).rank === 1);

  // Matchup W-L-T per team from the schedule, needed for category leagues
  // where ESPN's record.overall counts categories rather than games.
  const scheduleRaw: Json[] = (payloads.schedule?.schedule ?? core.schedule ?? []) as Json[];
  const hasTiers = scheduleRaw.some((s) => typeof s?.playoffTierType === 'string');
  const maxWinnersPeriod = hasTiers
    ? Math.max(0, ...scheduleRaw.filter((s) => s.playoffTierType === 'WINNERS_BRACKET').map((s) => Number(s.matchupPeriodId) || 0))
    : Math.max(0, ...scheduleRaw.map((s) => Number(s.matchupPeriodId) || 0));

  const matchupRecord = new Map<string, { w: number; l: number; t: number }>();
  const bump = (teamId: string, key: 'w' | 'l' | 't') => {
    const r = matchupRecord.get(teamId) ?? { w: 0, l: 0, t: 0 };
    r[key] += 1;
    matchupRecord.set(teamId, r);
  };

  const matchups: ImportedMatchup[] = [];
  for (const s of scheduleRaw) {
    const week = Number(s?.matchupPeriodId);
    if (!Number.isFinite(week) || !s?.home?.teamId) continue;
    const homeId = String(s.home.teamId);
    const awayId = s.away?.teamId != null ? String(s.away.teamId) : null;
    const tier: string | undefined = s.playoffTierType;
    const isPlayoff = hasTiers ? (tier !== undefined && tier !== 'NONE') : (regularSeasonWeeks != null && week > regularSeasonWeeks);
    const isConsolation = tier === 'WINNERS_CONSOLATION_LADDER' || tier === 'LOSERS_CONSOLATION_LADDER';
    let isChampionship = false;
    if (hasTiers) {
      isChampionship = tier === 'WINNERS_BRACKET' && week === maxWinnersPeriod;
    } else if (isPlayoff && week === maxWinnersPeriod && teamRankOne) {
      // No tier data: the final is the last-week matchup involving the rank-1 team.
      const r1 = String(teamRankOne.id);
      isChampionship = homeId === r1 || awayId === r1;
    }

    let winner: ImportedMatchup['winner'] = null;
    switch (s.winner) {
      case 'HOME': winner = 'home'; break;
      case 'AWAY': winner = 'away'; break;
      case 'TIE': winner = 'tie'; break;
      default: winner = null;
    }

    let homeScore: number | null = null;
    let awayScore: number | null = null;
    let homeCatWins: number | null = null;
    let homeCatLosses: number | null = null;
    let homeCatTies: number | null = null;
    let categoryResults: ImportedCategoryResult[] | null = null;

    if (isCategories) {
      const cs = s.home?.cumulativeScore ?? {};
      homeCatWins = toNum(cs.wins);
      homeCatLosses = toNum(cs.losses);
      homeCatTies = toNum(cs.ties);
      const byStat = cs.scoreByStat ?? {};
      const awayByStat = s.away?.cumulativeScore?.scoreByStat ?? {};
      categoryResults = Object.entries(byStat)
        .filter(([, v]: [string, Json]) => v && v.result !== null && v.result !== undefined)
        .map(([statId, v]: [string, Json]) => ({
          statKey: ESPN_STAT_MAP[Number(statId)]?.citrusKey ?? `unknown_espn_${statId}`,
          home: toNum(v.score),
          away: toNum(awayByStat?.[statId]?.score),
          winner: v.result === 'WIN' ? 'home' : v.result === 'LOSS' ? 'away' : v.result === 'TIE' ? 'tie' : null,
        }));
    } else {
      homeScore = toNum(s.home?.totalPoints);
      awayScore = toNum(s.away?.totalPoints);
    }

    if (awayId && winner && !isConsolation) {
      // Regular-season and winners-bracket games count toward the matchup record.
      if (winner === 'home') { bump(homeId, 'w'); bump(awayId, 'l'); }
      else if (winner === 'away') { bump(awayId, 'w'); bump(homeId, 'l'); }
      else { bump(homeId, 't'); bump(awayId, 't'); }
    }

    matchups.push({
      week, homeExternalTeamId: homeId, awayExternalTeamId: awayId,
      homeScore, awayScore, homeCatWins, homeCatLosses, homeCatTies, categoryResults,
      isPlayoff, isConsolation, isChampionship, winner,
      externalMatchupId: s.id != null ? String(s.id) : null,
    });
  }

  // Bracket-derived placements: winner of the championship matchup is 1,
  // loser is 2. Used to verify the rank field and to fill playoffFinish.
  const champMatch = matchups.find((m) => m.isChampionship && m.winner && m.winner !== 'tie');
  const bracketChampion = champMatch ? (champMatch.winner === 'home' ? champMatch.homeExternalTeamId : champMatch.awayExternalTeamId) : null;
  const bracketRunnerUp = champMatch ? (champMatch.winner === 'home' ? champMatch.awayExternalTeamId : champMatch.homeExternalTeamId) : null;
  if (champMatch && teamRankOne && bracketChampion !== String(teamRankOne.id)) {
    warnings.push(`Final standings say team ${teamRankOne.id} finished first but the bracket final was won by team ${bracketChampion}. Champion left unverified for a person to confirm.`);
  }

  const teams: ImportedTeam[] = teamsRaw.map((t) => {
    const id = String(t.id);
    const ownerIds: string[] = Array.isArray(t.owners) ? t.owners.map(String) : [];
    const ordered = t.primaryOwner ? [String(t.primaryOwner), ...ownerIds.filter((o) => o !== String(t.primaryOwner))] : ownerIds;
    const managers = ordered.map((oid) => membersById.get(oid) ?? { externalManagerId: oid, displayName: 'Unknown manager' });
    const { rank, source } = finalRankOf(t);
    const overall = t.record?.overall ?? {};
    const rec = matchupRecord.get(id);
    const playoffFinish = bracketChampion === id ? 1 : bracketRunnerUp === id ? 2 : (rank === 1 && !champMatch ? 1 : rank === 2 && !champMatch ? 2 : null);
    const seed = toNum(t.playoffSeed);
    const playoffTeamCount = toNum(sched.playoffTeamCount);
    return {
      externalTeamId: id,
      teamName: espnTeamName(t),
      managers,
      finalRank: rank,
      finalRankSource: source,
      playoffSeed: seed && seed > 0 ? seed : null,
      wins: isCategories ? (rec?.w ?? null) : toNum(overall.wins),
      losses: isCategories ? (rec?.l ?? null) : toNum(overall.losses),
      ties: isCategories ? (rec?.t ?? null) : toNum(overall.ties),
      pointsFor: isCategories ? null : toNum(overall.pointsFor),
      pointsAgainst: isCategories ? null : toNum(overall.pointsAgainst),
      categoryRecord: isCategories && overall.wins != null ? `${overall.wins}-${overall.losses}-${overall.ties}` : null,
      madePlayoffs: seed != null && playoffTeamCount != null ? (seed > 0 && seed <= playoffTeamCount) : null,
      playoffFinish,
    };
  });

  // ---- draft and keepers --------------------------------------------------
  const picksRaw: Json[] = payloads.draft?.draftDetail?.picks ?? core.draftDetail?.picks ?? [];
  const picks: ImportedPick[] = picksRaw
    // ESPN preallocates future draft slots with playerId -1. Those are not
    // selections and must never become phantom historical players.
    .filter((p) => p && Number.isSafeInteger(Number(p.playerId)) && Number(p.playerId) > 0)
    .map((p) => ({
      overallPick: Number(p.overallPickNumber ?? p.id ?? 0),
      round: toNum(p.roundId),
      pickInRound: toNum(p.roundPickNumber),
      externalTeamId: p.teamId != null ? String(p.teamId) : null,
      player: playerRef(Number(p.playerId), payloads.playersById?.get(Number(p.playerId))),
      isKeeper: Boolean(p.keeper),
      keeperCost: p.keeper && p.roundId != null ? `round ${p.roundId}` : null,
      auctionCost: toNum(p.bidAmount) || null,
    }))
    .filter((p) => p.overallPick > 0)
    .sort((a, b) => a.overallPick - b.overallPick);
  if (!picksRaw.length) warnings.push('No draft detail in the ESPN payload for this season; picks not imported.');

  const keepers: ImportedKeeperDesignation[] = [];
  for (const t of teamsRaw) {
    const ids: number[] = t?.draftStrategy?.keeperPlayerIds ?? [];
    for (const pid of ids) {
      keepers.push({
        externalTeamId: String(t.id),
        player: playerRef(Number(pid), payloads.playersById?.get(Number(pid))),
        round: null,
        roundNext: null,
      });
    }
  }

  const previousSeasons: number[] = (core.status?.previousSeasons ?? [])
    .map((y: unknown) => espnSeasonToCitrus(Number(y)))
    .filter((y: number) => Number.isFinite(y));

  const allRanked = teamsRaw.length > 0 && teamsRaw.every((t) => finalRankOf(t).rank != null);
  const isFinished = allRanked || core.status?.isActive === false;

  return {
    platform: 'espn',
    externalLeagueId: String(leagueId),
    externalSeasonKey: String(espnSeasonId),
    season,
    isFinished,
    settings: {
      leagueName: String(settingsRaw.name ?? '').trim(),
      scoringType,
      scoringItems,
      rosterSlots,
      regularSeasonWeeks,
      playoffTeamCount: toNum(sched.playoffTeamCount),
      playoffWeeks: toNum(sched.playoffMatchupPeriodLength),
      keeperCount: toNum(draftSettings.keeperCount),
      keeperOrderType: draftSettings.keeperOrderType ?? null,
      draftType: draftSettings.type ?? null,
      usesFaab: settingsRaw?.acquisitionSettings?.acquisitionType === 'WAIVERS_CONTINUOUS' ? false
        : settingsRaw?.acquisitionSettings?.acquisitionType != null ? String(settingsRaw.acquisitionSettings.acquisitionType).includes('FAAB') || Number(settingsRaw.acquisitionSettings.acquisitionBudget) > 0 : null,
      isPublic: typeof settingsRaw.isPublic === 'boolean' ? settingsRaw.isPublic : null,
    },
    teams,
    matchups,
    picks,
    keepers,
    transactions: [],
    previousSeasons,
    warnings,
  };
}

/**
 * ESPN keeps two rank fields. rankFinal is populated only when the commissioner
 * manually overrode final standings; rankCalculatedFinal is what ESPN computed.
 * Either is 0 while the season is unfinished.
 */
export function finalRankOf(team: Json): { rank: number | null; source: string | null } {
  const rf = Number(team?.rankFinal);
  if (Number.isFinite(rf) && rf > 0) return { rank: rf, source: 'commissioner' };
  const rc = Number(team?.rankCalculatedFinal);
  if (Number.isFinite(rc) && rc > 0) return { rank: rc, source: 'source_calculated' };
  return { rank: null, source: null };
}

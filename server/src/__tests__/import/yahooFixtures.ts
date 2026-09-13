/**
 * Builders that produce Yahoo's XML-as-JSON shapes (arrays of single-key
 * objects, numeric-keyed collections with `count`, numbers as strings) so the
 * parser tests run through `unpack` exactly as production does. Shapes follow
 * the captured payloads under fixtures/yahoo.
 */
import { YahooClient, type AccessTokenProvider, type FetchLike } from '../../import/yahoo/client';

export interface YTeam { id: number; name: string; guid: string; nickname?: string; rank: number; seed?: number; wins: number; losses: number; ties: number; pointsFor?: number; pointsAgainst?: number; coGuid?: string; clinched?: boolean; isCommissioner?: boolean }
export interface YStat { id: number; display: string; name?: string; positionType?: 'P' | 'G'; sortOrder?: 0 | 1; value?: number; displayOnly?: boolean }
export interface YPick { pick: number; round: number; teamId: number; playerId: number; cost?: number }

export interface YLeagueOpts {
  leagueKey: string; season: number; name?: string; scoringType?: 'head' | 'headpoint' | 'headone' | 'roto' | 'point';
  isFinished?: boolean; renew?: string; renewed?: string; leagueType?: 'private' | 'public';
  startWeek?: number; endWeek?: number; playoffStartWeek?: number; numPlayoffTeams?: number; multiweekFinal?: boolean;
  usesFaab?: boolean; draftType?: 'live' | 'offline'; isAuction?: boolean;
  teams: YTeam[]; stats: YStat[]; draft?: YPick[];
}

const teamKey = (leagueKey: string, id: number) => `${leagueKey}.t.${id}`;
const gameId = (leagueKey: string) => leagueKey.split('.')[0];

function leagueMeta(o: YLeagueOpts) {
  return {
    league_key: o.leagueKey, league_id: o.leagueKey.split('.l.')[1], name: o.name ?? 'Fixture League', draft_status: 'postdraft',
    num_teams: o.teams.length, scoring_type: o.scoringType ?? 'head', league_type: o.leagueType ?? 'private',
    renew: o.renew ?? '', renewed: o.renewed ?? '', current_week: String(o.endWeek ?? 22), start_week: String(o.startWeek ?? 1),
    end_week: String(o.endWeek ?? 22), is_finished: o.isFinished === false ? undefined : 1, game_code: 'nhl', season: String(o.season),
  };
}

function managers(t: YTeam) {
  const list = [{ manager: { manager_id: String(t.id), nickname: t.nickname ?? `mgr_${t.id}`, guid: t.guid, ...(t.isCommissioner ? { is_commissioner: '1' } : {}) } }];
  if (t.coGuid) list.push({ manager: { manager_id: String(t.id + 100), nickname: `co_${t.id}`, guid: t.coGuid, is_comanager: '1' } as any });
  return list;
}

function collection<T>(items: T[], singular: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  items.forEach((it, i) => { out[String(i)] = { [singular]: it }; });
  out.count = items.length;
  return out;
}

/** `league/{key};out=settings,standings,draftresults` */
export function yahooLeagueBundle(o: YLeagueOpts) {
  const isCats = (o.scoringType ?? 'head') === 'head' || o.scoringType === 'headone';
  const settings = {
    draft_type: o.draftType ?? 'live', is_auction_draft: o.isAuction ? '1' : '0', scoring_type: o.scoringType ?? 'head',
    uses_playoff: o.playoffStartWeek != null ? '1' : '0', has_playoff_consolation_games: 1, num_playoff_teams: String(o.numPlayoffTeams ?? 4),
    playoff_start_week: o.playoffStartWeek != null ? String(o.playoffStartWeek) : undefined, has_multiweek_championship: o.multiweekFinal ? 1 : 0,
    uses_faab: o.usesFaab ? '1' : '0', waiver_type: 'R', max_teams: String(o.teams.length),
    roster_positions: [{ roster_position: { position: 'C', position_type: 'P', count: 2 } }, { roster_position: { position: 'LW', position_type: 'P', count: 2 } }, { roster_position: { position: 'RW', position_type: 'P', count: 2 } }, { roster_position: { position: 'D', position_type: 'P', count: 4 } }, { roster_position: { position: 'G', position_type: 'G', count: 2 } }, { roster_position: { position: 'BN', count: 4 } }, { roster_position: { position: 'IR+', count: 2 } }],
    stat_categories: { stats: o.stats.map((s) => ({ stat: { stat_id: String(s.id), enabled: '1', name: s.name ?? s.display, display_name: s.display, sort_order: String(s.sortOrder ?? 1), position_type: s.positionType ?? 'P', ...(s.displayOnly ? { is_only_display_stat: '1' } : {}) } })) },
    stat_modifiers: { stats: o.stats.filter((s) => s.value != null).map((s) => ({ stat: { stat_id: String(s.id), value: String(s.value) } })) },
  };
  const standingsTeams = o.teams.map((t) => [
    [
      { team_key: teamKey(o.leagueKey, t.id) }, { team_id: String(t.id) }, { name: t.name }, [], { url: 'https://example.invalid' },
      { team_logos: [{ team_logo: { size: 'large', url: 'https://example.invalid/logo.png' } }] }, [], { waiver_priority: t.id }, [],
      { number_of_moves: '3' }, { number_of_trades: 0 }, ...(t.clinched ? [{ clinched_playoffs: 1 }] : []), { league_scoring_type: o.scoringType ?? 'head' }, [], [],
      { managers: managers(t) },
    ],
    { team_stats: { coverage_type: 'season', season: String(o.season), stats: [] }, team_points: { coverage_type: 'season', season: String(o.season), total: isCats ? String(t.wins) : String(t.pointsFor ?? 0) } },
    { team_standings: { rank: t.rank, playoff_seed: t.seed != null ? String(t.seed) : undefined, outcome_totals: { wins: String(t.wins), losses: String(t.losses), ties: String(t.ties), percentage: '.500' }, ...(isCats ? {} : { points_for: String(t.pointsFor ?? 0), points_against: String(t.pointsAgainst ?? 0) }), games_back: '-' } },
  ]);
  const parts: unknown[] = [leagueMeta(o), { settings: [settings] }, { standings: [{ teams: collection(standingsTeams, 'team') }] }];
  if (o.draft) parts.push({ draft_results: collection(o.draft.map((p) => ({ pick: p.pick, round: p.round, team_key: teamKey(o.leagueKey, p.teamId), player_key: `${gameId(o.leagueKey)}.p.${p.playerId}`, ...(p.cost != null ? { cost: String(p.cost) } : {}) })), 'draft_result') });
  return { fantasy_content: { 'xml:lang': 'en-US', 'yahoo:uri': `/fantasy/v2/league/${o.leagueKey};out=settings,standings,draftresults`, league: parts } };
}

/** `league/{key}/metadata` */
export function yahooLeagueMetadata(o: YLeagueOpts) {
  return { fantasy_content: { league: [leagueMeta(o)] } };
}

export interface YMatchup { home: number; away: number; homePts?: number; awayPts?: number; isPlayoffs?: boolean; isConsolation?: boolean; winner?: 'home' | 'away' | 'tie'; status?: 'postevent' | 'midevent'; statWinners?: Array<{ statId: number; winner: 'home' | 'away' | 'tie' }>; homeStats?: Record<number, number | string>; awayStats?: Record<number, number | string> }

/** `league/{key}/scoreboard;week=N` */
export function yahooScoreboard(o: YLeagueOpts, week: number, matchups: YMatchup[]) {
  const side = (id: number, pts: number | undefined, stats: Record<number, number | string> | undefined) => [
    [{ team_key: teamKey(o.leagueKey, id) }, { team_id: String(id) }, { name: o.teams.find((t) => t.id === id)?.name ?? `Team ${id}` }, { managers: managers(o.teams.find((t) => t.id === id)!) }],
    { team_stats: { coverage_type: 'week', week: String(week), stats: Object.entries(stats ?? {}).map(([k, v]) => ({ stat: { stat_id: k, value: v } })) }, team_points: { coverage_type: 'week', week: String(week), total: pts ?? 0 } },
  ];
  const items = matchups.map((m) => {
    const status = m.status ?? 'postevent';
    const winnerKey = m.winner === 'home' ? teamKey(o.leagueKey, m.home) : m.winner === 'away' ? teamKey(o.leagueKey, m.away) : undefined;
    return {
      week: String(week), week_start: '2024-01-01', week_end: '2024-01-07', status, is_playoffs: m.isPlayoffs ? '1' : '0', is_consolation: m.isConsolation ? '1' : '0',
      ...(status === 'postevent' ? { is_tied: m.winner === 'tie' ? 1 : 0, ...(winnerKey ? { winner_team_key: winnerKey } : {}) } : {}),
      ...(m.statWinners ? { stat_winners: m.statWinners.map((w) => ({ stat_winner: w.winner === 'tie' ? { stat_id: String(w.statId), is_tied: 1 } : { stat_id: String(w.statId), winner_team_key: teamKey(o.leagueKey, w.winner === 'home' ? m.home : m.away) } })) } : {}),
      0: { teams: collection([side(m.home, m.homePts, m.homeStats), side(m.away, m.awayPts, m.awayStats)], 'team') },
    };
  });
  return { fantasy_content: { league: [leagueMeta(o), { scoreboard: { week: String(week), 0: { matchups: collection(items, 'matchup') } } }] } };
}

export interface YPlayer { playerId: number; name: string; team: string; number?: string; position: string; ownerTeamId?: number; keeper?: { status?: boolean; cost?: number; kept?: boolean } }

/** `league/{key}/players;status=K;out=ownership` or `league/{key}/players;player_keys=...` */
export function yahooPlayers(o: YLeagueOpts, players: YPlayer[]) {
  const items = players.map((p) => [
    [
      { player_key: `${gameId(o.leagueKey)}.p.${p.playerId}` }, { player_id: String(p.playerId) },
      { name: { full: p.name, first: p.name.split(' ')[0], last: p.name.split(' ').slice(1).join(' ') } },
      { editorial_team_abbr: p.team }, ...(p.number ? [{ uniform_number: p.number }] : []), { display_position: p.position }, { position_type: p.position === 'G' ? 'G' : 'P' },
      ...(p.keeper ? [{ is_keeper: { status: p.keeper.status === false ? '' : '1', cost: p.keeper.cost != null ? String(p.keeper.cost) : '', kept: p.keeper.kept ? '1' : '' } }] : []),
    ],
    ...(p.ownerTeamId != null ? [{ ownership: { ownership_type: 'team', owner_team_key: teamKey(o.leagueKey, p.ownerTeamId), owner_team_name: 'x' } }] : []),
  ]);
  return { fantasy_content: { league: [leagueMeta(o), { players: collection(items, 'player') }] } };
}

export interface YTransaction { id: number; type: 'add' | 'drop' | 'add/drop' | 'trade'; timestamp: number; moves: Array<{ playerId: number; name: string; team: string; position: string; kind: 'add' | 'drop' | 'trade'; from?: number; to?: number; fromWaivers?: boolean }>; traderTeamId?: number; tradeeTeamId?: number; faab?: number }

/** `league/{key}/transactions` */
export function yahooTransactions(o: YLeagueOpts, txs: YTransaction[]) {
  const items = txs.map((tx) => [
    { transaction_key: `${o.leagueKey}.tr.${tx.id}`, transaction_id: String(tx.id), type: tx.type, status: 'successful', timestamp: String(tx.timestamp), ...(tx.traderTeamId != null ? { trader_team_key: teamKey(o.leagueKey, tx.traderTeamId), tradee_team_key: teamKey(o.leagueKey, tx.tradeeTeamId!) } : {}), ...(tx.faab != null ? { faab_bid: String(tx.faab) } : {}) },
    { players: collection(tx.moves.map((mv) => [
      [{ player_key: `${gameId(o.leagueKey)}.p.${mv.playerId}` }, { player_id: String(mv.playerId) }, { name: { full: mv.name } }, { editorial_team_abbr: mv.team }, { display_position: mv.position }],
      { transaction_data: [{ type: mv.kind, ...(mv.from != null ? { source_type: 'team', source_team_key: teamKey(o.leagueKey, mv.from) } : { source_type: mv.fromWaivers ? 'waivers' : 'freeagents' }), ...(mv.to != null ? { destination_type: 'team', destination_team_key: teamKey(o.leagueKey, mv.to) } : { destination_type: 'waivers' }) }] },
    ]), 'player') },
  ]);
  return { fantasy_content: { league: [leagueMeta(o), { transactions: collection(items, 'transaction') }] } };
}

export interface YUserLeague { leagueKey: string; name: string; season: number; renew?: string; renewed?: string; isFinished?: boolean; scoringType?: string; numTeams?: number }

/** `users;use_login=1/games;game_codes=nhl;game_types=full/leagues` */
export function yahooUserLeagues(guid: string, games: Array<{ gameId: string; season: number; code?: string; leagues: YUserLeague[] }>) {
  const gameItems = games.map((g) => [
    { game_key: g.gameId, game_id: g.gameId, name: 'Hockey', code: g.code ?? 'nhl', type: 'full', season: String(g.season), is_game_over: 1 },
    { leagues: collection(g.leagues.map((l) => [{ league_key: l.leagueKey, league_id: l.leagueKey.split('.l.')[1], name: l.name, num_teams: l.numTeams ?? 10, scoring_type: l.scoringType ?? 'head', league_type: 'private', renew: l.renew ?? '', renewed: l.renewed ?? '', ...(l.isFinished === false ? {} : { is_finished: 1 }), season: String(l.season), game_code: g.code ?? 'nhl' }]), 'league') },
  ]);
  return { fantasy_content: { users: { 0: { user: [{ guid }, { games: collection(gameItems, 'game') }] }, count: 1 } } };
}

/** A token provider that never refreshes. */
export const staticTokens = (token = 'access-token'): AccessTokenProvider => ({ get: async () => token, invalidate: () => undefined });

export type YRoute = { status: number; body?: unknown };

/**
 * A routed fetch for the YahooClient keyed on the decoded resource path
 * (everything after /fantasy/v2/, before ?format=json). A key may be an exact
 * path or a prefix ending in "*". Missing keys answer 404.
 */
export function yahooRouter(routes: Record<string, YRoute>, tokens: AccessTokenProvider = staticTokens()) {
  const requested: string[] = [];
  const impl: FetchLike = async (url, init) => {
    const u = new URL(url);
    const resource = decodeURIComponent(u.pathname.replace(/^\/fantasy\/v2\//, ''));
    requested.push(resource);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (!auth?.startsWith('Bearer ')) return { status: 401, json: async () => null } as unknown as Response;
    const exact = routes[resource];
    const prefix = Object.keys(routes).filter((k) => k.endsWith('*') && resource.startsWith(k.slice(0, -1))).sort((a, b) => b.length - a.length)[0];
    const route = exact ?? (prefix ? routes[prefix] : undefined) ?? { status: 404 };
    return { status: route.status, json: async () => route.body } as unknown as Response;
  };
  return { client: new YahooClient(tokens, impl), requested, impl };
}

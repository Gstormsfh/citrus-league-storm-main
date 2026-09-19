import { createHash } from 'node:crypto';
import { AppError } from '../lib/errors';
import { asList } from '../import/yahoo/normalize';
import type { YahooClient } from '../import/yahoo/client';
import type { EspnClient, EspnCredentials } from '../import/espn/client';
import type { CrosswalkResult } from './import/PlayerCrosswalkService';

export type ExternalDraftPlatform = 'yahoo' | 'espn';
export interface ExternalDraftPick {
  externalPlayerId: string;
  externalTeamId: string;
  overallPick: number | null;
  keeper: boolean;
}
export interface ExternalDraftSnapshot {
  platform: ExternalDraftPlatform;
  leagueId: string;
  season: number;
  status: 'waiting' | 'in_progress' | 'finished' | 'unknown';
  picks: ExternalDraftPick[];
}
type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): string | null => /^(?:[1-9]\d{0,11})$/.test(String(value)) ? String(value) : null;
const invalid = () => AppError.badGateway('The draft source returned an incomplete or inconsistent snapshot. Previous picks have not been cleared.');

/** Require an explicit collection. Missing data is not an empty board or an undo. */
function collection(value: unknown): RecordValue[] {
  if (object(value) && typeof value.player_key === 'string') return [value];
  if (!Array.isArray(value) && !(object(value) && Object.keys(value).length === 0)
    && !(object(value) && value.count === 0 && Object.keys(value).length === 1)) throw invalid();
  const rows = Array.isArray(value) ? value : [];
  if (rows.length > 2000 || rows.some(row => !object(row))) throw invalid();
  return rows;
}

function validatePicks(picks: ExternalDraftPick[]): ExternalDraftPick[] {
  const players = new Set<string>(), slots = new Set<number>();
  for (const p of picks) {
    if (!p.externalPlayerId || !p.externalTeamId || players.has(p.externalPlayerId)
      || (p.overallPick !== null && (!Number.isSafeInteger(p.overallPick) || p.overallPick <= 0 || slots.has(p.overallPick)))) throw invalid();
    players.add(p.externalPlayerId);
    if (p.overallPick !== null) slots.add(p.overallPick);
  }
  return picks.sort((a,b) => (a.overallPick ?? 0) - (b.overallPick ?? 0) || a.externalPlayerId.localeCompare(b.externalPlayerId));
}

/** YahooClient has already normalized Yahoo's XML-shaped JSON. */
export function yahooDraftSnapshot(content: unknown, keeperContent: unknown, leagueId: string, season: number): ExternalDraftSnapshot {
  if (!object(content) || !object(content.league) || !object(keeperContent) || !object(keeperContent.league)) throw invalid();
  const league = content.league, keeperLeague = keeperContent.league;
  if (league.league_key !== leagueId || Number(league.season) !== season || keeperLeague.league_key !== leagueId
    || (league.game_code !== undefined && league.game_code !== 'nhl')) throw invalid();
  const game = leagueId.split('.')[0];
  const playerId = (key: unknown) => typeof key === 'string' && key.startsWith(`${game}.p.`) ? id(key.slice(game.length + 3)) : null;
  const teamId = (key: unknown) => typeof key === 'string' && key.startsWith(`${leagueId}.t.`) ? id(key.slice(leagueId.length + 3)) : null;
  const picks: ExternalDraftPick[] = collection(league.draft_results).map(row => {
    const player = playerId(row.player_key), team = teamId(row.team_key);
    if (!player || !team) throw invalid();
    return { externalPlayerId: player, externalTeamId: team, overallPick: Number(row.pick), keeper: false };
  });
  for (const row of collection(keeperLeague.players)) {
    const player = playerId(row.player_key);
    const owners = asList<RecordValue>(row.ownership);
    const team = owners.length === 1 && object(owners[0]) ? teamId(owners[0].owner_team_key) : null;
    if (!player || !team) throw invalid();
    const existing = picks.find(p => p.externalPlayerId === player);
    if (existing) { if (existing.externalTeamId !== team || existing.keeper) throw invalid(); existing.keeper = true; }
    else picks.push({ externalPlayerId: player, externalTeamId: team, overallPick: null, keeper: true });
  }
  const status = ({ predraft: 'waiting', drafting: 'in_progress', postdraft: 'finished' } as const)[String(league.draft_status) as 'predraft'];
  return { platform: 'yahoo', leagueId, season, status: status ?? 'unknown', picks: validatePicks(picks) };
}

export function espnDraftSnapshot(body: unknown, leagueId: string, season: number): ExternalDraftSnapshot {
  if (!object(body) || String(body.id) !== leagueId || body.seasonId !== season + 1 || !object(body.draftDetail)) throw invalid();
  const detail = body.draftDetail;
  for (const flag of ['drafted', 'inProgress']) {
    if (detail[flag] !== undefined && typeof detail[flag] !== 'boolean') throw invalid();
  }
  const slots = new Set<number>();
  const picks: ExternalDraftPick[] = collection(detail.picks).flatMap(row => {
    const player = id(row.playerId), team = id(row.teamId);
    const slot = Number(row.overallPickNumber);
    if (!team || !Number.isSafeInteger(slot) || slot <= 0 || slots.has(slot)
      || (row.keeper !== undefined && typeof row.keeper !== 'boolean')) throw invalid();
    slots.add(slot);
    // Verified against the disposable 2027 ESPN league: unfilled draft slots
    // are explicit playerId -1 records, not missing data or selected players.
    if (row.playerId === -1 && row.keeper === false && detail.drafted === false) return [];
    if (!player) throw invalid();
    return [{ externalPlayerId: player, externalTeamId: team, overallPick: slot, keeper: row.keeper === true }];
  });
  // Keeper availability can exist before the keeper's assigned draft slot appears.
  for (const team of collection(body.teams)) {
    const teamId = id(team.id);
    if (!teamId) throw invalid();
    const noKeepers = object(body.settings) && object(body.settings.draftSettings) && body.settings.draftSettings.keeperCount === 0;
    const keeperIds = object(team.draftStrategy) ? team.draftStrategy.keeperPlayerIds : noKeepers ? [] : null;
    if (!Array.isArray(keeperIds)) throw invalid();
    for (const rawId of keeperIds) {
      const player = id(rawId); if (!player) throw invalid();
      const existing = picks.find(p => p.externalPlayerId === player);
      if (existing) { if (existing.externalTeamId !== teamId) throw invalid(); existing.keeper = true; }
      else picks.push({ externalPlayerId: player, externalTeamId: teamId, overallPick: null, keeper: true });
    }
  }
  // Do not infer a running draft or completion from pick count or wall-clock time.
  return { platform: 'espn', leagueId, season, status: detail.drafted === true ? 'finished' : detail.inProgress === true ? 'in_progress' : detail.drafted === false && detail.inProgress === false ? 'waiting' : 'unknown', picks: validatePicks(picks) };
}

/** Read-only provider adapters. No Citrus draft, roster, or projection writes. */
export class ExternalDraftSnapshotService {
  async yahoo(client: YahooClient, leagueId: string, season: number) {
    if (!/^\d{1,6}\.l\.[1-9]\d{0,11}$/.test(leagueId) || !Number.isInteger(season) || season < 2000 || season > 2100) throw AppError.badRequest('Invalid Yahoo league or season.');
    const league = await client.league(leagueId, ['metadata', 'draftresults']);
    const keepers = await client.keepers(leagueId);
    return yahooDraftSnapshot(league.content, keepers.content, leagueId, season);
  }
  async espn(client: EspnClient, leagueId: string, season: number, credentials?: EspnCredentials) {
    if (!id(leagueId) || !Number.isInteger(season) || season < 2000 || season > 2100) throw AppError.badRequest('Invalid ESPN league or season.');
    // Non-keeper leagues omit team.draftStrategy. Explicit keeperCount from
    // mSettings is required to distinguish no keepers from missing data.
    const result = await client.fetchSeason(leagueId, season + 1, ['mDraftDetail', 'mTeam', 'mSettings'], credentials);
    return espnDraftSnapshot(result.body, leagueId, season);
  }
}

/** Only established IDs can mark a Citrus player unavailable. Never fuzzy-match names. */
export function resolveDraftSnapshot(snapshot: ExternalDraftSnapshot, known: Map<string, CrosswalkResult>, receivedAt: string) {
  if (!Number.isFinite(Date.parse(receivedAt))) throw invalid();
  const unresolved: string[] = [], unavailableIds = new Set<string>();
  for (const pick of snapshot.picks) {
    const match = known.get(pick.externalPlayerId);
    if (!match || match.isAmbiguous || !id(match.nhlPlayerId)
      || !['manual', 'exact_name_team_number', 'name_team'].includes(match.matchMethod)) {
      unresolved.push(pick.externalPlayerId); continue;
    }
    if (unavailableIds.has(String(match.nhlPlayerId))) throw invalid();
    unavailableIds.add(String(match.nhlPlayerId));
  }
  return { ...snapshot, receivedAt, unavailableIds: [...unavailableIds], unresolved,
    complete: unresolved.length === 0,
    revision: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
}

/**
 * Maps a source platform's player ids to NHL player ids.
 *
 * League-independent: once Yahoo 6743 = NHL 8478402 (McDavid) is resolved for
 * one league it is resolved for every league, so the first read is always the
 * shared external_player_ids table. What is still unknown is matched against
 * player_directory for the season in question, in a strict ladder:
 *
 *   exact_name_team_number  name + team + jersey agree         confidence 0.98
 *   name_team               name + team agree                  confidence 0.90
 *   name_only               name agrees, one candidate         confidence 0.70
 *   unmatched               nothing, or more than one candidate at the same rung
 *
 * An ambiguous match is FLAGGED, never resolved. Two Sebastian Ahos exist. The
 * draft kit found four first-name merges in one roster file this week, and the
 * same corruption exists in source data. A wrong silent match puts the wrong
 * player on someone's keeper list; an unmatched row just shows the name until
 * the commissioner picks.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportedPlayerRef, ImportPlatform } from '../../import/types';
import { normalizeName, normalizeTeamAbbr } from '../../import/names';

export type MatchMethod = 'exact_name_team_number' | 'name_team' | 'name_only' | 'manual' | 'unmatched';

export interface CrosswalkResult {
  externalPlayerId: string;
  nhlPlayerId: number | null;
  matchMethod: MatchMethod;
  confidence: number;
  isAmbiguous: boolean;
  candidates: number[];
}

export interface DirectoryRow {
  player_id: number;
  full_name: string;
  team_abbrev: string | null;
  jersey_number: string | null;
  position_code: string | null;
  season?: number;
}

const DIRECTORY_COLUMNS = 'player_id, full_name, team_abbrev, jersey_number, position_code, season';
const EXTERNAL_COLUMNS = 'platform, external_player_id, nhl_player_id, match_method, confidence, is_ambiguous';

/** Pure ladder. Exported so it is unit-testable without a database. */
export function matchAgainstDirectory(ref: ImportedPlayerRef, directory: DirectoryRow[]): CrosswalkResult {
  const name = normalizeName(ref.name);
  const base: CrosswalkResult = {
    externalPlayerId: ref.externalPlayerId, nhlPlayerId: null, matchMethod: 'unmatched', confidence: 0, isAmbiguous: false, candidates: [],
  };
  if (!name) return base;

  const byName = directory.filter((d) => normalizeName(d.full_name) === name);
  if (byName.length === 0) return base;

  const team = normalizeTeamAbbr(ref.teamAbbr);
  const number = ref.jerseyNumber != null ? String(ref.jerseyNumber).trim() : null;

  if (team && number) {
    const exact = byName.filter((d) => normalizeTeamAbbr(d.team_abbrev) === team && String(d.jersey_number ?? '').trim() === number);
    if (exact.length === 1) return { ...base, nhlPlayerId: exact[0].player_id, matchMethod: 'exact_name_team_number', confidence: 0.98, candidates: [exact[0].player_id] };
    if (exact.length > 1) return { ...base, isAmbiguous: true, candidates: exact.map((d) => d.player_id) };
  }
  if (team) {
    const byTeam = byName.filter((d) => normalizeTeamAbbr(d.team_abbrev) === team);
    if (byTeam.length === 1) return { ...base, nhlPlayerId: byTeam[0].player_id, matchMethod: 'name_team', confidence: 0.9, candidates: [byTeam[0].player_id] };
    if (byTeam.length > 1) return { ...base, isAmbiguous: true, candidates: byTeam.map((d) => d.player_id) };
  }
  const distinct = Array.from(new Set(byName.map((d) => d.player_id)));
  if (distinct.length === 1) return { ...base, nhlPlayerId: distinct[0], matchMethod: 'name_only', confidence: 0.7, candidates: distinct };
  return { ...base, isAmbiguous: true, candidates: distinct };
}

export class PlayerCrosswalkService {
  private readonly directoryCache = new Map<number, DirectoryRow[]>();

  constructor(private readonly supabase: SupabaseClient) {}

  /** Already-resolved ids from the shared table. */
  async lookupKnown(platform: ImportPlatform, externalIds: string[]): Promise<Map<string, CrosswalkResult>> {
    const out = new Map<string, CrosswalkResult>();
    if (externalIds.length === 0) return out;
    const { data, error } = await this.supabase
      .from('external_player_ids')
      .select(EXTERNAL_COLUMNS)
      .eq('platform', platform)
      .in('external_player_id', externalIds);
    if (error) throw new Error(`external_player_ids read failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{ external_player_id: string; nhl_player_id: number | null; match_method: MatchMethod; confidence: number; is_ambiguous: boolean }>) {
      out.set(row.external_player_id, {
        externalPlayerId: row.external_player_id,
        nhlPlayerId: row.nhl_player_id,
        matchMethod: row.match_method,
        confidence: Number(row.confidence ?? 0),
        isAmbiguous: Boolean(row.is_ambiguous),
        candidates: row.nhl_player_id != null ? [row.nhl_player_id] : [],
      });
    }
    return out;
  }

  /**
   * The directory for one season. One query; matching happens in memory.
   *
   * player_directory carries the current season only, so a 2015 keeper would
   * find an empty directory. When the season asked for has no rows the newest
   * season is used instead: names are stable, clubs are not, and the ladder
   * already drops to name-only when the club does not agree. Players who
   * retired before the current directory stay unmatched, name intact, until a
   * commissioner picks them. Cached per instance so a ten-season import reads
   * the directory once.
   */
  async loadDirectory(season: number): Promise<DirectoryRow[]> {
    const cached = this.directoryCache.get(season);
    if (cached) return cached;
    const { data, error } = await this.supabase
      .from('player_directory')
      .select(DIRECTORY_COLUMNS)
      .eq('season', season);
    if (error) throw new Error(`player_directory read failed: ${error.message}`);
    let rows = (data ?? []) as DirectoryRow[];
    if (rows.length === 0) {
      const { data: newest, error: nErr } = await this.supabase
        .from('player_directory')
        .select('season')
        .order('season', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (nErr) throw new Error(`player_directory read failed: ${nErr.message}`);
      const fallback = (newest as { season: number } | null)?.season ?? null;
      if (fallback != null && fallback !== season) rows = await this.loadDirectory(fallback);
    }
    this.directoryCache.set(season, rows);
    return rows;
  }

  /**
   * Resolve every ref. Known ids are returned as stored (a manual resolution
   * is never overridden by a fresh guess). Unknown ids are matched against the
   * season's directory and the result persisted, including unmatched and
   * ambiguous outcomes, so the commissioner's unresolved list is queryable.
   */
  async resolve(platform: ImportPlatform, refs: ImportedPlayerRef[], season: number): Promise<Map<string, CrosswalkResult>> {
    const unique = new Map<string, ImportedPlayerRef>();
    for (const r of refs) if (r.externalPlayerId && !unique.has(r.externalPlayerId)) unique.set(r.externalPlayerId, r);
    const ids = Array.from(unique.keys());
    const results = await this.lookupKnown(platform, ids);

    const pending = ids.filter((id) => {
      const k = results.get(id);
      // Re-attempt unmatched rows (the directory may have grown); never touch manual or resolved ones.
      return !k || (k.nhlPlayerId == null && k.matchMethod !== 'manual');
    });
    if (pending.length === 0) return results;

    const directory = await this.loadDirectory(season);
    const upserts: Array<Record<string, unknown>> = [];
    for (const id of pending) {
      const ref = unique.get(id)!;
      const m = matchAgainstDirectory(ref, directory);
      results.set(id, m);
      upserts.push({
        platform,
        external_player_id: id,
        nhl_player_id: m.nhlPlayerId,
        match_method: m.matchMethod,
        confidence: m.confidence,
        is_ambiguous: m.isAmbiguous,
        external_name: ref.name || null,
        external_team_abbr: ref.teamAbbr,
        external_number: ref.jerseyNumber,
        external_position: ref.position,
        first_seen_season: season,
        last_seen_season: season,
      });
    }
    if (upserts.length) {
      const { error } = await this.supabase
        .from('external_player_ids')
        .upsert(upserts, { onConflict: 'platform,external_player_id' });
      if (error) throw new Error(`external_player_ids write failed: ${error.message}`);
    }
    return results;
  }

  /** Commissioner picked the right player from a search. Final word. */
  async resolveManually(platform: ImportPlatform, externalPlayerId: string, nhlPlayerId: number, resolvedBy: string): Promise<void> {
    const { error } = await this.supabase
      .from('external_player_ids')
      .upsert({
        platform, external_player_id: externalPlayerId, nhl_player_id: nhlPlayerId,
        match_method: 'manual', confidence: 1, is_ambiguous: false,
        resolved_by: resolvedBy, resolved_at: new Date().toISOString(),
      }, { onConflict: 'platform,external_player_id' });
    if (error) throw new Error(`manual resolution failed: ${error.message}`);
  }
}

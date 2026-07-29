// DR-3 chunk (2026-07-29) — v1 → v2 prop adapters.
//
// Pure functions mapping the v2 rail's `DerivedDraftState` + fetched
// teams + pre-loaded players into the exact prop shapes the v1 draft
// components already expect. Zero-touch to v1 component internals per
// architect ratification (all-ADAPT, no forks).
//
// The two v1 shapes we build:
//
//   DraftPick { id, teamId, teamName, playerId (string), playerName,
//               position, round, pick, timestamp, playerTeam? }
//     — DraftBoard.tsx, DraftHistory.tsx, TeamRosters.tsx all share
//       this shape (verified interfaces match).
//
//   Team      { id, name, owner, color, picks: DraftPick[] }
//     — DraftBoard.tsx and TeamRosters.tsx consume.
//
// Unresolved-player fallback: playerName renders as `#${playerId}`,
// position renders as `?`, playerTeam stays undefined. This is the
// permanent-fallback per architect ratification 1b: fixture IDs sit
// in NHL id space but not all resolve; both paths must render well.

import type { Player } from '@/services/PlayerService';
import type { DerivedDraftState, RosterEntry } from './deriveDraftState';

// ── v1 shape mirrors (kept in-file to avoid cross-import; the v1
// components define these shapes privately, so we recreate the same
// contract here.) ────────────────────────────────────────────────────

export interface V1DraftPick {
  id: string;
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  position: string;
  round: number;
  pick: number;
  timestamp: number;
  playerTeam?: string;
}

export interface V1Team {
  id: string;
  name: string;
  owner: string;
  color: string;
  picks: V1DraftPick[];
}

/**
 * Fetched team row from GET /api/leagues/:leagueId/teams. Only the
 * fields the adapter consumes are typed; the endpoint returns more.
 */
export interface FetchedTeam {
  id: string;
  team_name: string;
  owner_name?: string | null;
  owner_id?: string | null;
}

// ── Palette for team card accent colors ───────────────────────────
//
// v1's Team.color is a decorative property (border stripe, avatar
// tint). v1 rooms feed hex values; v2 doesn't have per-team color
// stored, so we assign a stable rotation keyed on team index. Same
// leagueId → same team ordering → same color assignments = stable
// across renders.
const TEAM_COLOR_PALETTE = [
  '#F97316', // orange (Citrus primary)
  '#22C55E', // green
  '#3B82F6', // blue
  '#EAB308', // yellow
  '#EC4899', // pink
  '#8B5CF6', // violet
  '#14B8A6', // teal
  '#EF4444', // red
  '#A3E635', // lime
  '#6366F1', // indigo
  '#F59E0B', // amber
  '#06B6D4', // cyan
];

function pickTeamColor(teamIndex: number): string {
  return TEAM_COLOR_PALETTE[teamIndex % TEAM_COLOR_PALETTE.length];
}

// ── Player resolution ─────────────────────────────────────────────

/**
 * Resolve a numeric player id to display strings. Returns the
 * `#<id>` fallback triple when the id is not in the lookup map —
 * matches the DR-3 fallback-rendering test's contract.
 */
export function resolvePlayerDisplay(
  playerId: number,
  playersById: ReadonlyMap<string, Player>,
): { playerName: string; position: string; playerTeam?: string } {
  const idStr = String(playerId);
  const p = playersById.get(idStr);
  if (p === undefined) {
    return { playerName: `#${idStr}`, position: '?' };
  }
  return {
    playerName: p.full_name || `#${idStr}`,
    position: p.position || '?',
    playerTeam: p.team ?? undefined,
  };
}

// ── Adapters ──────────────────────────────────────────────────────

/**
 * Convert one RosterEntry + team context into a v1 DraftPick.
 *
 * `timestamp` uses the entry's seq * 1000 as a stable, monotonic
 * ordering key — the v1 components use `timestamp` to sort or key
 * lists, never as a real wall-clock. Real wall-clock is unavailable
 * for the derived roster entries; using seq gives correct ordering
 * without a false clock reading.
 */
export function rosterEntryToDraftPick(
  entry: RosterEntry,
  teamId: string,
  teamName: string,
  playersById: ReadonlyMap<string, Player>,
): V1DraftPick {
  const display = resolvePlayerDisplay(entry.playerId, playersById);
  return {
    id: `${teamId}-${entry.seq}`,
    teamId,
    teamName,
    playerId: String(entry.playerId),
    playerName: display.playerName,
    position: display.position,
    round: entry.roundNumber,
    pick: entry.pickNumber,
    timestamp: entry.seq * 1000,
    ...(display.playerTeam !== undefined
      ? { playerTeam: display.playerTeam }
      : {}),
  };
}

/**
 * Build the v1 Team[] array from fetched teams + derived rosters.
 * Every team gets a stable color from the palette (index rotation).
 * `owner` falls back to 'Manager' when no name is present.
 */
export function toV1Teams(
  fetchedTeams: ReadonlyArray<FetchedTeam>,
  derived: DerivedDraftState,
  playersById: ReadonlyMap<string, Player>,
): V1Team[] {
  return fetchedTeams.map((t, index) => {
    const roster = derived.teamRosters.get(t.id) ?? [];
    const picks = roster.map((entry) =>
      rosterEntryToDraftPick(entry, t.id, t.team_name, playersById),
    );
    return {
      id: t.id,
      name: t.team_name,
      owner: t.owner_name ?? 'Manager',
      color: pickTeamColor(index),
      picks,
    };
  });
}

/**
 * Build the flat draft-history array (chronological, ascending by
 * pick number). v1 DraftHistory + DraftBoard consume this directly.
 */
export function toDraftHistory(
  fetchedTeams: ReadonlyArray<FetchedTeam>,
  derived: DerivedDraftState,
  playersById: ReadonlyMap<string, Player>,
): V1DraftPick[] {
  const teamNameById = new Map(
    fetchedTeams.map((t) => [t.id, t.team_name] as const),
  );
  const flat: V1DraftPick[] = [];
  derived.teamRosters.forEach((roster, teamId) => {
    const teamName = teamNameById.get(teamId) ?? teamId.slice(0, 8);
    for (const entry of roster) {
      flat.push(rosterEntryToDraftPick(entry, teamId, teamName, playersById));
    }
  });
  flat.sort((a, b) => a.pick - b.pick);
  return flat;
}

/**
 * Set of drafted player IDs (as strings) — feeds PlayerPool.draftedPlayers
 * and DraftQueue.draftedPlayers. Set semantics matter: v1 uses `.has`
 * for O(1) drafted-lookups per row.
 */
export function toDraftedPlayerIds(derived: DerivedDraftState): string[] {
  const out: string[] = [];
  derived.teamRosters.forEach((roster) => {
    for (const entry of roster) {
      out.push(String(entry.playerId));
    }
  });
  return out;
}

/**
 * Filter the full player index down to the pool's `availablePlayers`
 * array — everything not yet drafted.
 */
export function toAvailablePlayers(
  playersById: ReadonlyMap<string, Player>,
  derived: DerivedDraftState,
): Player[] {
  const drafted = new Set(toDraftedPlayerIds(derived));
  const out: Player[] = [];
  playersById.forEach((p) => {
    if (!drafted.has(p.id)) out.push(p);
  });
  return out;
}

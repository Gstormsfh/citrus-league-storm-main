/**
 * ROSTER PAYLOAD -> PRESS BOX ROWS (2026-09-04).
 *
 * The one piece of logic between `Roster.tsx`'s data and the Press Box list.
 * It is a pure function on purpose: the page keeps every fetch, the row keeps
 * every pixel, and the mapping between them — which slot holds whom, what the
 * game line says, whether tonight's figure is a fact or a forecast — is the
 * part with edge cases, so it is the part that gets tests.
 *
 * WHAT IT REFUSES TO INVENT. The spec's meta line reads `vs TOR 3RD` and
 * `FINAL 4–2 · 2A 3S +1`. This payload has `nextGame.gameStatus`
 * (`scheduled | live | intermission | final`), `nextGame.score` and
 * `nextGame.gameTime`, and NOT the period, so:
 *
 *   * live         -> `vs TOR 2-1` when there is a score, else `vs TOR LIVE`
 *   * intermission -> `vs TOR INT 2-1`
 *   * final        -> `FINAL 4-2`, or bare `FINAL` with no score
 *   * scheduled    -> `@ DAL 8:30 PM`, or bare `@ DAL` with no time
 *
 * "3RD" would be a period nobody sent us. `+1` in the stat line would be a
 * plus/minus the daily stats object does not carry. Neither is printed.
 *
 * THE DAY TOGGLE IS THE PAGE'S. `days` and `activeDay` pass straight through:
 * the roster payload is already for a chosen day, so this module never
 * re-filters by date and cannot disagree with the page about which day is on
 * screen.
 */
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { multiPositionLabel } from '@/components/roster/positions';
import type { SlotConfig } from '@/components/roster/slotConfig';

import type { PressBoxRosterRowPlayer } from './RosterRow';
import type { PressBoxRosterSlotRow } from './RosterList';

const LIVE_STATES = new Set(['live', 'intermission', 'final']);

const isGoalie = (p: HockeyPlayer) => p.position === 'Goalie' || p.position === 'G';

/** `1G 2A 4 SOG` — actual stats only, and only once a game has started. */
export function statLineFor(p: HockeyPlayer): string | null {
  const status = p.nextGame?.gameStatus;
  if (!status || !LIVE_STATES.has(status) || !p.daily_actual_stats) return null;
  const s = p.daily_actual_stats;
  const parts: string[] = [];
  if (isGoalie(p)) {
    if (s.saves) parts.push(`${s.saves} SV`);
    if (s.goals_against != null) parts.push(`${s.goals_against} GA`);
    if (s.wins) parts.push('W');
  } else {
    if (s.goals) parts.push(`${s.goals}G`);
    if (s.assists) parts.push(`${s.assists}A`);
    if (s.shots_on_goal) parts.push(`${s.shots_on_goal} SOG`);
    if (s.hits) parts.push(`${s.hits} HIT`);
  }
  return parts.length ? parts.join(' ') : null;
}

/** The game segment of the meta line. Never a period, never a placeholder. */
export function gameLabelFor(p: HockeyPlayer): string | undefined {
  const g = p.nextGame;
  if (!g) return undefined;
  const opp = g.opponent?.trim();
  switch (g.gameStatus) {
    case 'final':
      return g.score ? `FINAL ${g.score}` : 'FINAL';
    case 'live':
      return [opp, g.score || 'LIVE'].filter(Boolean).join(' ') || undefined;
    case 'intermission':
      return [opp, 'INT', g.score].filter(Boolean).join(' ') || undefined;
    default:
      return [opp, g.gameTime].filter(Boolean).join(' ') || undefined;
  }
}

/** Tonight's projection, whichever projection object this player carries. */
export function projectionFor(p: HockeyPlayer): number | null {
  const proj = isGoalie(p) ? p.goalieProjection : p.daily_projection;
  return proj?.total_projected_points ?? null;
}

/** One roster player, flattened to exactly what the row draws. */
export function toRowPlayer(p: HockeyPlayer): PressBoxRosterRowPlayer {
  const status = p.nextGame?.gameStatus;
  const live = !!status && LIVE_STATES.has(status);
  const positions = multiPositionLabel(p);
  return {
    ...p,
    id: p.id,
    name: p.name,
    teamAbbreviation:
      p.teamAbbreviation || p.team?.split(' ').pop()?.slice(0, 3).toUpperCase() || undefined,
    // Only when there is more than one: a single-position row printing "C"
    // beside a "C" chip is noise, and the chip is the SLOT, not the player.
    positionsLabel: positions && positions.includes('/') ? positions : undefined,
    status: p.status ?? null,
    gameLabel: gameLabelFor(p),
    statLine: statLineFor(p) ?? undefined,
    isLiveOrFinal: live,
    todayActual: live ? (p.daily_actual_points ?? 0) : null,
    todayProjection: projectionFor(p),
    // No per-player week total exists on this payload; the column is off.
    weekPoints: null,
  };
}

export interface BuildRosterRowsInput {
  starters: HockeyPlayer[];
  bench: HockeyPlayer[];
  slotConfig: SlotConfig;
  /** `playerId -> slotId`, straight from the page. */
  slotAssignments: Record<string | number, string>;
  lockedPlayerIds?: Set<string>;
  tapSelectedPlayerId?: string | number | null;
  tapEligibleSlots?: Set<string>;
}

export interface BuildRosterRowsResult {
  starters: PressBoxRosterSlotRow[];
  bench: PressBoxRosterSlotRow[];
  /** Starter slots that actually hold a player. */
  startersFilled: number;
  /** Starter slots the league defines. */
  startersRequired: number;
  /** Bench players with a game on the day being shown. */
  benchPlayingCount: number;
}

/** A player is day-to-day / out: the row tints and the meta turns grapefruit. */
const isDtd = (p: HockeyPlayer) => p.status === 'GTD' || p.status === 'IR' || p.status === 'SUSP';

export function buildRosterRows({
  starters,
  bench,
  slotConfig,
  slotAssignments,
  lockedPlayerIds = new Set(),
  tapSelectedPlayerId = null,
  tapEligibleSlots = new Set(),
}: BuildRosterRowsInput): BuildRosterRowsResult {
  // `slotAssignments` is keyed by player id and VALUED by slot id, so the
  // lookup has to be inverted once rather than scanned per slot -- a 13-slot
  // roster scanning a 20-key object thirteen times is the kind of thing that
  // is invisible until someone opens a 30-team dynasty league.
  const bySlot = new Map<string, HockeyPlayer>();
  for (const [playerId, slotId] of Object.entries(slotAssignments)) {
    const p = starters.find((s) => String(s.id) === String(playerId));
    if (p) bySlot.set(slotId, p);
  }

  const starterRows: PressBoxRosterSlotRow[] = slotConfig.allSlots.map((slotId) => {
    const p = bySlot.get(slotId) ?? null;
    const selected = p != null && String(p.id) === String(tapSelectedPlayerId ?? '');
    return {
      slotId,
      slot: slotConfig.labels[slotId] || 'UTIL',
      player: p ? toRowPlayer(p) : null,
      locked: p ? lockedPlayerIds.has(String(p.id)) : false,
      dtd: p ? isDtd(p) : false,
      selected,
      eligibleTarget: tapSelectedPlayerId != null && tapEligibleSlots.has(slotId) && !selected,
    };
  });

  const benchRows: PressBoxRosterSlotRow[] = bench.map((p, i) => ({
    slotId: `bench-${p.id ?? i}`,
    slot: 'BN',
    player: toRowPlayer(p),
    locked: lockedPlayerIds.has(String(p.id)),
    dtd: isDtd(p),
    selected: String(p.id) === String(tapSelectedPlayerId ?? ''),
    eligibleTarget: false,
  }));

  return {
    starters: starterRows,
    bench: benchRows,
    startersFilled: starterRows.filter((r) => r.player != null).length,
    startersRequired: slotConfig.allSlots.length,
    // "Playing tonight" means the schedule has a line for him today, not that
    // he has a projection: a scratched player can carry a stale projection and
    // a confirmed starter on a team with no game must not be counted.
    benchPlayingCount: bench.filter((p) => p.nextGame?.isToday === true).length,
  };
}

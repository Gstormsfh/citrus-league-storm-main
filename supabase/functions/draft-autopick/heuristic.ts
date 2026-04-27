// Phase 4 autopick heuristic — pure FPTS + positional-need scoring.
//
// VERBATIM PORT of v1's autopick fallback (apps/web/src/pages/
// DraftRoom.tsx:2410-2524). Used by the Phase 4 worker
// (supabase/functions/draft-autopick/index.ts) when the on-the-clock
// team has no `draft_queues` row OR every queued player is already
// drafted. Algorithm parity with v1 is intentional: v2 must not
// behave WORSE than v1 from an owner's perspective when their queue
// runs out.
//
// Design contract:
//   - PURE function. No I/O, no Date.now(), no randomness, no
//     globals. Same input → same output.
//   - Side-effect-free. No logging, no metric writes. The worker
//     handles observability.
//   - Deno-compatible. Only depends on `../_shared/citrus_shared.ts`,
//     which re-exports `ScoringCalculator` from `@citrus/shared` —
//     identical FPTS values to the v1 web client and the v2 server
//     pick path.
//
// Algorithm (per v1):
//   1. Determine league position format ('forward' = F/D/G;
//      'individual' = C/LW/RW/D/G). Default 'individual' if missing.
//   2. Compute current team's positional counts from prior picks
//      (positions normalized to league format).
//   3. Build starting-needs map from leagueRosterSlots, falling back
//      to format-aware defaults if a position's slot count is
//      missing or zero.
//   4. Identify unfilled starter positions.
//   5. If all starters are full, EXPAND unfilledPositions by depth
//      bonus (skaters +1-2, D +2, G +1) — this is what gives the
//      autopick "bench awareness" v1 originally lacked.
//   6. Score every undrafted player: FPTS via shared
//      ScoringCalculator (skater stat path or goalie stat path
//      based on `player.position === 'G'`). Apply 15% positional
//      boost if the player's normalized position is in
//      unfilledPositions.
//   7. Return the highest-scored player. Null only when
//      undraftedPlayers is empty.

import {
  DEFAULT_SCORING,
  ScoringCalculator,
  type ScoringSettings,
} from '../_shared/citrus_shared.ts';

export interface HeuristicPlayer {
  /** Player primary key (matches draft_picks_v2.player_id, int). */
  id: number;
  /** Raw NHL position; 'C' | 'LW' | 'RW' | 'D' | 'G' | null. */
  position: string | null;
  // Skater stat fields (subset consumed by ScoringCalculator):
  goals?:    number | null;
  assists?:  number | null;
  shots?:    number | null;
  blocks?:   number | null;
  hits?:     number | null;
  pim?:      number | null;
  ppp?:      number | null;
  shp?:      number | null;
  // Goalie stat fields:
  wins?:           number | null;
  saves?:          number | null;
  shutouts?:       number | null;
  goals_against?:  number | null;
}

export interface HeuristicLeagueSettings {
  positionType?: 'individual' | 'forward';
  rosterSlots?:  Record<string, number>;
}

export interface HeuristicInput {
  /** Pre-filtered to undrafted (caller's responsibility). */
  undraftedPlayers: HeuristicPlayer[];
  /**
   * Just the (raw NHL) position strings of players already on the
   * on-the-clock team. `null` is allowed and is normalized like any
   * unknown position.
   */
  teamPriorPositions: Array<string | null>;
  /** League scoring; falls back to DEFAULT_SCORING if absent/null. */
  leagueScoring?:  ScoringSettings | null;
  leagueSettings?: HeuristicLeagueSettings;
}

export interface HeuristicResult {
  selected: HeuristicPlayer;
  /** Raw FPTS (no boost applied). */
  fpts: number;
  /** Score used for sorting: fpts × 1.15 if positionBoosted, else fpts. */
  score: number;
  /** True when the 15% positional boost was applied. */
  positionBoosted: boolean;
}

/**
 * Pick the next autopick selection by FPTS + positional need.
 * Returns `null` ONLY when `undraftedPlayers` is empty. A list of
 * players that all score 0 still returns the first one (matching v1
 * behavior — caller decides whether to fall through to a different
 * strategy).
 */
export function selectByHeuristic(
  input: HeuristicInput,
): HeuristicResult | null {
  const {
    undraftedPlayers,
    teamPriorPositions,
    leagueScoring,
    leagueSettings,
  } = input;

  if (undraftedPlayers.length === 0) return null;

  const scorer = new ScoringCalculator(leagueScoring ?? DEFAULT_SCORING);

  const positionType: 'individual' | 'forward' =
    leagueSettings?.positionType === 'forward' ? 'forward' : 'individual';
  const leagueRosterSlots = leagueSettings?.rosterSlots ?? {};

  // Normalize raw position to league position-format key. Two formats
  // supported per v1: 'individual' (C/LW/RW/D/G) and 'forward' (F/D/G,
  // where C/LW/RW collapse into F).
  const toLeaguePos = (rawPos: string | null | undefined): string => {
    const p = rawPos ?? (positionType === 'forward' ? 'F' : 'C');
    if (positionType === 'forward' && (p === 'C' || p === 'LW' || p === 'RW')) {
      return 'F';
    }
    return p;
  };

  // Position counts from team's prior picks (normalized).
  const positionCounts: Record<string, number> = {};
  for (const rawPos of teamPriorPositions) {
    const pos = toLeaguePos(rawPos);
    positionCounts[pos] = (positionCounts[pos] ?? 0) + 1;
  }

  // Configured league positions + format-aware fallback starter needs
  // (in case rosterSlots is missing or zero for a position).
  const configuredPositions = positionType === 'forward'
    ? ['F', 'D', 'G']
    : ['C', 'LW', 'RW', 'D', 'G'];
  const fallbackNeeds: Record<string, number> = positionType === 'forward'
    ? { F: 6, D: 4, G: 2 }
    : { C: 2, LW: 2, RW: 2, D: 4, G: 2 };

  const startingNeeds: Record<string, number> = {};
  for (const pos of configuredPositions) {
    const slotCount = leagueRosterSlots[pos];
    startingNeeds[pos] = typeof slotCount === 'number' && slotCount > 0
      ? slotCount
      : (fallbackNeeds[pos] ?? 0);
  }

  // Unfilled starter positions get the 15% boost.
  const unfilledPositions = new Set<string>();
  for (const [pos, need] of Object.entries(startingNeeds)) {
    if ((positionCounts[pos] ?? 0) < need) {
      unfilledPositions.add(pos);
    }
  }

  // Bench awareness: when all starters are full, EXTEND the boost set
  // to positions that haven't yet hit (starter + depth) capacity.
  // Without this, v1 was greedily picking the highest-FPTS player
  // regardless of whether the team already had 4 RWs and 0 backup
  // goalies — which made autopicks look "random" to owners.
  const allStartersFull = unfilledPositions.size === 0;
  if (allStartersFull) {
    const depthBonus: Record<string, number> = positionType === 'forward'
      ? { F: 4, D: 2, G: 1 }
      : { C: 1, LW: 1, RW: 1, D: 2, G: 1 };
    for (const pos of configuredPositions) {
      const cap = (startingNeeds[pos] ?? 0) + (depthBonus[pos] ?? 1);
      if ((positionCounts[pos] ?? 0) < cap) {
        unfilledPositions.add(pos);
      }
    }
  }

  // FPTS calc per player. Goalies and skaters use distinct stat
  // schemas via ScoringCalculator; selection is based on
  // `position === 'G'` exactly as v1 does.
  const calcFpts = (p: HeuristicPlayer): number => {
    const isGoalie = p.position === 'G';
    return scorer.calculatePoints(
      isGoalie
        ? {
            wins:          p.wins          ?? 0,
            saves:         p.saves         ?? 0,
            shutouts:      p.shutouts      ?? 0,
            goals_against: p.goals_against ?? 0,
          }
        : {
            goals:   p.goals   ?? 0,
            assists: p.assists ?? 0,
            shots:   p.shots   ?? 0,
            blocks:  p.blocks  ?? 0,
            hits:    p.hits    ?? 0,
            pim:     p.pim     ?? 0,
            ppp:     p.ppp     ?? 0,
            shp:     p.shp     ?? 0,
          },
      isGoalie,
    );
  };

  // Single-pass max. Stable: ties resolve to the first player seen.
  let best: HeuristicResult | null = null;
  for (const p of undraftedPlayers) {
    const fpts = calcFpts(p);
    const leaguePos = toLeaguePos(p.position);
    const positionBoosted = unfilledPositions.has(leaguePos);
    const score = positionBoosted ? fpts * 1.15 : fpts;
    if (best === null || score > best.score) {
      best = { selected: p, fpts, score, positionBoosted };
    }
  }

  return best;
}

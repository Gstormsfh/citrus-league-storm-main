/**
 * FREE-AGENT LIST -> PRESS BOX PLAYERS ROW (2026-09-04).
 *
 * The Free Agents page already owns the hard parts — which game is next
 * (`nextGameLine`), what the button should do (`freeAgentAction`), when a
 * waiver claim clears (`waiverClearsLabel`) — in `freeAgentRowKit.ts`, and
 * that module has its own tests. This maps its output onto the Press Box row
 * and adds nothing.
 *
 * WHY THE CALL SITES SWAPPED RATHER THAN `FreeAgentRow` BEING REWRITTEN.
 * That component carries 44 tests, and they cannot be run on the machine this
 * was written on — the file reaches the Supabase client, which opens a socket
 * at import and never settles under the offline runner. Rewriting a component
 * whose tests I cannot execute, on a submission day, is exactly the trade
 * that has already cost this branch two rounds. The page renders the Press Box
 * row; `FreeAgentRow` and its 44 green tests stay untouched until the screen
 * is signed off, and then both go together.
 *
 * ROSTERED % IS STILL ABSENT and still honest about it: there is no
 * league-wide ownership read anywhere in the app. `subLabel` (the page's
 * "3 games" / "1,204 adds") is what the artboard's ownership slot holds until
 * PR12 lands the aggregate.
 */
import type { NHLGame } from '@/services/ScheduleService';
import {
  nextGameLine,
  statusChipFor,
  waiverClearsLabel,
  type FreeAgentAction,
} from '@/components/freeagents/freeAgentRowKit';

import type { PressBoxPlayerAction, PressBoxPlayerRowPlayer } from './PlayerRow';

/** The directory shape every list on the Free Agents page carries. */
export interface FreeAgentLike {
  id: string | number;
  full_name: string;
  position: string;
  team: string;
  headshot_url?: string | null;
  status?: string | null;
  is_on_waivers?: boolean;
  waiver_clears_at?: string | null;
}

/** `FreeAgentAction` and `PressBoxPlayerAction` share their three names. */
export const toPressBoxAction = (a: FreeAgentAction): PressBoxPlayerAction => a;

export function toPlayerRow(
  p: FreeAgentLike,
  opts: {
    games?: readonly NHLGame[];
    todayStr: string;
    weekProjection?: number | null;
    gamesThisWeek?: number | null;
    rosteredPct?: number | null;
    startedPct?: number | null;
  },
): PressBoxPlayerRowPlayer {
  const game = nextGameLine(opts.games, p.team, opts.todayStr);
  return {
    id: p.id,
    name: p.full_name,
    image: p.headshot_url ?? undefined,
    team: p.team,
    teamAbbreviation: p.team,
    position: p.position,
    // `vs BOS 7:00 PM`, or nothing at all — never "No game" invented here.
    gameLabel: game ? [game.opponent, game.time].filter(Boolean).join(' ') : undefined,
    // Through `statusChipFor`, NOT raw. The directory sets `status: 'active'`
    // on everyone who is fine, and passing it straight through put an
    // "active" badge on every ordinary name in the pool -- which is the
    // opposite of what a status chip is for. That helper returns null for
    // ACTIVE and ACT and the real code otherwise; the legacy row used it and
    // so does this one.
    status: statusChipFor(p.status) ? String(p.status).toUpperCase() : null,
    rosteredPct: opts.rosteredPct ?? null,
    startedPct: opts.startedPct ?? null,
    weekProjection: opts.weekProjection ?? null,
    gamesThisWeek: opts.gamesThisWeek ?? null,
  };
}

/** `THU` under the W, when a claim is what the button does. */
export const claimDayFor = (p: FreeAgentLike, action: FreeAgentAction): string | null =>
  action === 'claim' ? (waiverClearsLabel(p.waiver_clears_at)?.replace(/^clears\s+/i, '') ?? null) : null;

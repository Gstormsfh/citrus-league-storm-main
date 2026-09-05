/**
 * League menu tiles — data, not JSX.
 *
 * Split from LeagueMenu.tsx for the reason positionChip.ts and
 * phoneRowScale.ts give: a module that exports both a component and plain
 * values breaks react-refresh, so editing the menu during dev would force a
 * full reload instead of a hot swap.
 *
 * `to` is REQUIRED. A tile that goes nowhere is the defect this type exists
 * to make unrepresentable -- the spec's rule is that every tap target routes,
 * and `linkGraphIntegrity` can only see targets that exist.
 */
import type { LucideIcon } from 'lucide-react';
import { Trophy, ArrowLeftRight, ClipboardList, CalendarDays, Shuffle } from 'lucide-react';

export interface LeagueMenuTile {
  key: string;
  title: string;
  /** Required: a tile that goes nowhere is the defect this type prevents. */
  to: string;
  Icon: LucideIcon;
  /**
   * The one live number that says whether you need to open this. Optional and
   * omitted when absent -- rule 9 of the handoff: build the aggregate or hide
   * the field, never a plausible number.
   */
  stat?: string | null;
}

/**
 * The tiles whose routes exist today. Verified against App.tsx on 2026-09-04:
 * /standings, /trade-analyzer, /waiver-wire, /schedule-manager all resolve.
 *
 * Missing ON PURPOSE, each needing a route AND a page before it can appear:
 * Commish note, Draft results, Scoring & legend, League history, Managers &
 * invites. The spec names ten tiles; six of them have nowhere to go in this
 * codebase yet. Shipping them as dead tiles would fail both linkGraphIntegrity
 * and the rule that every tap target routes. See PROGRESS.md.
 */
export function defaultLeagueTiles(leagueId: string): LeagueMenuTile[] {
  return [
    { key: 'standings', title: 'Standings', to: `/standings?league=${leagueId}`, Icon: Trophy },
    { key: 'trades', title: 'Trades', to: `/trade-analyzer?league=${leagueId}`, Icon: ArrowLeftRight },
    { key: 'waivers', title: 'Waivers', to: `/waiver-wire?league=${leagueId}`, Icon: ClipboardList },
    { key: 'schedule', title: 'Schedule', to: `/schedule-manager?league=${leagueId}`, Icon: CalendarDays },
    // A manager inside a league can reach the simulator (2026-09-04): the
    // old hamburger menu carried this link and is gone; the tile keeps the
    // way in. /armchair-gm is public and ungated (leagueSwitchAndMockDraftReach).
    { key: 'mockdraft', title: 'Mock draft', to: '/armchair-gm?tab=mockdraft', Icon: Shuffle },
  ];
}

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
import { Trophy, ArrowLeftRight, ClipboardList, CalendarDays, Shuffle, ScrollText, Users, SlidersHorizontal } from 'lucide-react';
import { placeOf, type StandingsLineRow } from '@/components/league/hqLines';
import { formatWaiverProcessTime } from '@/utils/timezoneUtils';

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
  return leagueMenuTiles({ leagueId });
}

/**
 * WHAT THE MENU KNOWS (2026-09-05, artboard 1a · League menu). Every field
 * is a read some league screen already makes -- the ranked standings, the
 * league's open trades, the waiver order, next week's matchup, the teams
 * -- handed in by `useLeagueMenuTiles` when the menu is open. A field not
 * in hand leaves its tile with a title and no line; nothing is invented.
 */
export interface LeagueMenuInput {
  leagueId: string;
  myTeamId?: string | null;
  /** Ranked, the way GET /api/leagues/:id/standings returns it. */
  standings?: Array<StandingsLineRow & { losses: number; ties?: number }> | null;
  /** The league's open offers. */
  pendingTrades?: Array<{ to_team_id?: string | null }> | null;
  /** The waiver order, 1 first. */
  waiverPriority?: Array<{ team_id: string; priority: number }> | null;
  /** `02:00:00`, the league's waiver_process_time. */
  waiverProcessTime?: string | null;
  /** Next week's matchup for the caller: the opponent's name, or null for a bye. */
  nextWeek?: { number: number; opponent: string | null } | null;
  draft?: { completed: boolean; type: string; rounds: number } | null;
  managers?: { count: number; max: number | null; canInvite: boolean } | null;
  commissioner?: boolean;
}

const DRAFT_LABEL: Record<string, string> = { snake: 'Snake', auction: 'Auction', linear: 'Linear', offline: 'Offline' };

/**
 * The tiles, in the artboard's order, each with the one live line the
 * input can honestly support. Routes verified against App.tsx on
 * 2026-09-05: /standings, /trade-analyzer, /waiver-wire,
 * /schedule-manager, /draft-v2/:leagueId, /league/:leagueId (the teams and
 * the invite control; `?settings=1` opens the commissioner's sheet),
 * /armchair-gm. Still missing, each needing a route AND a page: Commish
 * note, Scoring & legend, League history. See PROGRESS.md.
 */
export function leagueMenuTiles(input: LeagueMenuInput): LeagueMenuTile[] {
  const { leagueId, myTeamId } = input;

  let standingsStat: string | null = null;
  if (input.standings && myTeamId) {
    const place = placeOf(input.standings, myTeamId);
    const row = input.standings.find((r) => r.team_id === myTeamId);
    if (place && row) {
      const record = row.ties ? `${row.wins}–${row.losses}–${row.ties}` : `${row.wins}–${row.losses}`;
      standingsStat = `${place} · ${record}`;
    }
  }

  let tradesStat: string | null = null;
  if (input.pendingTrades) {
    const pending = input.pendingTrades.length;
    const waiting = myTeamId ? input.pendingTrades.filter((t) => t.to_team_id === myTeamId).length : 0;
    if (pending === 0) tradesStat = 'No open offers';
    else if (waiting > 0) tradesStat = `${waiting} offer${waiting === 1 ? '' : 's'} waiting on you · ${pending} pending`;
    else tradesStat = `${pending} pending`;
  }

  let waiversStat: string | null = null;
  if (input.waiverPriority && myTeamId) {
    const mine = input.waiverPriority.find((p) => p.team_id === myTeamId);
    if (mine) waiversStat = `You're #${mine.priority} · processes ${formatWaiverProcessTime(input.waiverProcessTime)}`;
  }

  let scheduleStat: string | null = null;
  if (input.nextWeek) {
    scheduleStat = input.nextWeek.opponent ? `Wk ${input.nextWeek.number} vs ${input.nextWeek.opponent}` : `Wk ${input.nextWeek.number} · bye`;
  }

  const tiles: LeagueMenuTile[] = [
    { key: 'standings', title: 'Standings', to: `/standings?league=${leagueId}`, Icon: Trophy, stat: standingsStat },
    { key: 'trades', title: 'Trades', to: `/trade-analyzer?league=${leagueId}`, Icon: ArrowLeftRight, stat: tradesStat },
    { key: 'waivers', title: 'Waivers', to: `/waiver-wire?league=${leagueId}`, Icon: ClipboardList, stat: waiversStat },
    { key: 'schedule', title: 'Schedule', to: `/schedule-manager?league=${leagueId}`, Icon: CalendarDays, stat: scheduleStat },
  ];

  if (input.draft?.completed) {
    tiles.push({
      key: 'draft',
      title: 'Draft results',
      to: `/draft-v2/${leagueId}`,
      Icon: ScrollText,
      stat: `${DRAFT_LABEL[input.draft.type] ?? 'Snake'} · ${input.draft.rounds} rds`,
    });
  }

  if (input.managers) {
    const { count, max, canInvite } = input.managers;
    tiles.push({
      key: 'managers',
      title: 'Managers & invites',
      to: `/league/${leagueId}`,
      Icon: Users,
      stat: [max ? `${count}/${max}` : `${count} teams`, canInvite ? 'share link' : null].filter(Boolean).join(' · '),
    });
  }

  if (input.commissioner) {
    tiles.push({
      key: 'settings',
      title: 'League settings',
      to: `/league/${leagueId}?settings=1`,
      Icon: SlidersHorizontal,
      stat: 'Commissioner · rosters, waivers, playoffs',
    });
  }

  // A manager inside a league can reach the simulator (2026-09-04): the
  // old hamburger menu carried this link and is gone; the tile keeps the
  // way in. /armchair-gm is public and ungated (leagueSwitchAndMockDraftReach).
  tiles.push({ key: 'mockdraft', title: 'Mock draft', to: '/armchair-gm?tab=mockdraft', Icon: Shuffle });
  return tiles;
}

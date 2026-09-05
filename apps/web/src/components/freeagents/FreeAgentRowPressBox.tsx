/**
 * The Free Agents phone row, in Press Box clothes.
 *
 * SAME PROPS AS `FreeAgentRow`, deliberately: the page has three call sites
 * with three different sub-labels, and a drop-in keeps the conversion to a
 * one-token change at each of them instead of three hand-rewritten prop
 * lists. It owns no logic — `freeAgentRowKit` still decides which game is
 * next, what the button does and when a claim clears, and that module has its
 * own tests.
 *
 * `FreeAgentRow` stays where it is, with its 44 green tests, until this screen
 * is signed off; then both go together. Rewriting a component whose tests
 * cannot be executed on this machine (that file reaches the Supabase client,
 * which opens a socket at import and never settles under the offline runner)
 * is the trade that has already cost this branch two rounds.
 */
import { PressBoxPlayerRow } from '@/components/pressbox';
import { claimDayFor, toPlayerRow, toPressBoxAction } from '@/components/pressbox/freeAgentRows';

import type { FreeAgentRowProps } from './FreeAgentRow';

/** Trending rows carry a 24-hour add count; the other two lists do not. */
type WithAdds = { adds?: number; gamesThisWeek?: number | null };

/**
 * PLAYERS PAGE (2026-09-04): what the 60px column holds when the list is not
 * the trending one. `movement` overrides the row's own `adds` (the DROPS
 * view passes a negative count; `null` prints no movement at all, and the
 * rank badge then shows no arrow). `figure` is a cream number for that same
 * column — the projection on AVAILABLE, the game count on GAMES — and
 * `seasonLine` is the second meta line while the projection is up in the
 * column, so it is never printed twice on one row.
 */
export interface FreeAgentRowPressBoxExtras {
  movement?: number | null;
  figure?: string | null;
  seasonLine?: string | null;
  /** The watch-list star over the rank; see `PressBoxPlayerRow.onStar`. */
  starred?: boolean;
  onStar?: () => void;
  /** `START 31%` beside the rostered figure (2026-09-05). */
  startedPct?: number | null;
}

export function FreeAgentRowPressBox({
  rank,
  player,
  projection,
  games,
  todayStr,
  action,
  rosteredPct,
  subLabel,
  disabled = false,
  onOpen,
  onAction,
  movement,
  figure = null,
  seasonLine = null,
  starred,
  onStar,
  startedPct,
}: FreeAgentRowProps & FreeAgentRowPressBoxExtras) {
  const extra = player as unknown as WithAdds;
  const adds24h =
    movement !== undefined ? movement : typeof extra.adds === 'number' ? extra.adds : null;
  return (
    <PressBoxPlayerRow
      rank={rank}
      player={toPlayerRow(player, {
        games,
        todayStr,
        weekProjection: projection,
        gamesThisWeek: extra.gamesThisWeek ?? null,
        rosteredPct: rosteredPct ?? null,
        startedPct: startedPct ?? null,
      })}
      // The movement column is the trending list's; elsewhere the page's own
      // sub-label ("3 games") takes the slot under it, which is what it had.
      adds24h={adds24h}
      figure={figure}
      seasonLine={seasonLine}
      starred={starred}
      onStar={onStar}
      destination={subLabel ?? null}
      action={toPressBoxAction(action)}
      claimDay={claimDayFor(player, action)}
      actionDisabled={disabled}
      onPress={onOpen}
      onAction={onAction}
    />
  );
}

export default FreeAgentRowPressBox;

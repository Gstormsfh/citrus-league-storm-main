/**
 * ONE SEASON QUESTION (2026-09-02, offseason audit).
 *
 * "Is there hockey right now?" was answered nowhere, which is why on
 * 2026-09-02 — 27 days before the season opens, 80 days after the last game —
 * the app said all of this at once:
 *
 *   Roster      "0/13 starters play · proj 0.0", above rows that each
 *               correctly read "No Game"
 *   Auto Lineup "Everyone with a game is already starting. Nothing to
 *               change tonight."
 *   Matchup     "Win chance 50%", "0 left", and "Final" over "0.0 - 0.0"
 *   Standings   a complete 0-0-0 / .000 table
 *
 * None of those components was broken. Every one of them asked "is the list
 * empty?" and got "no" — a drafted roster is thirteen real players and a
 * matchup is two real teams. The list was never the question. The SCHEDULE
 * was, and nothing on the client could see it.
 *
 * `Scores.tsx` was the exception, for one reason: its response carries
 * `nearestDateWithGames`, so it alone could say where the season went and
 * offer a tap to get there. This hook makes that fact ambient.
 *
 * Modelled on `useIsMobile` deliberately — same shape, same reasoning. One
 * question, one answer, read by every consumer, so the stylesheet and the
 * components cannot drift apart. That consolidation (audit M11) is why the
 * matchup row no longer measures the viewport eight different ways.
 */

import { useQuery } from '@tanstack/react-query';
import { seasonApi } from '@/api/season';
import { deriveSeasonStatus, dormantHeadline, type SeasonStatus } from '@citrus/shared';

/**
 * The schedule does not change during a session. An hour of staleness is
 * invisible to a reader and saves every screen a round trip; the only event
 * that matters — a day rolling over — is bounded by how long anyone leaves a
 * fantasy app open.
 */
const STALE_MS = 60 * 60 * 1000;

/** Never `unknown`, so no consumer has to null-check before rendering. */
const UNKNOWN: SeasonStatus = deriveSeasonStatus(null);

export interface UseSeasonStatus {
  status: SeasonStatus;
  /**
   * The one line a dormant screen shows in place of a number it cannot
   * justify. Null when there is hockey today, or when we cannot tell.
   */
  headline: string | null;
  /** True only once a real answer is in hand. */
  isLoaded: boolean;
}

/**
 * THE FAILURE DIRECTION MATTERS. While loading, and on any error, this
 * returns `unknown` — `isDormant: false`, `phase: 'unknown'` — so a screen
 * renders its normal self and asserts nothing about the season.
 *
 * The opposite default would be far worse than a blank strip: a failed fetch
 * in January would tell every user at once that the season is over. A screen
 * that briefly shows its ordinary chrome and then settles into an offseason
 * state is a flicker; a screen that confidently announces a fake offseason
 * is a support ticket.
 */
export function useSeasonStatus(): UseSeasonStatus {
  const { data, isSuccess } = useQuery({
    queryKey: ['season', 'status'],
    queryFn: () => seasonApi.getStatus(),
    staleTime: STALE_MS,
    gcTime: STALE_MS,
    // One retry: this is ambient context, not the page's content. Failing
    // fast to `unknown` beats holding every screen in a loading state.
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const status = isSuccess && data?.status ? data.status : UNKNOWN;

  return {
    status,
    headline: dormantHeadline(status),
    isLoaded: isSuccess,
  };
}

export default useSeasonStatus;

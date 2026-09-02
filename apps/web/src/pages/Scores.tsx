/**
 * Scores — the live NHL scoreboard, one day at a time.
 *
 * WHERE THE LAYOUT COMES FROM
 * The information architecture is taken from theScore, ESPN and the CBS
 * Sports NHL scoreboard: a horizontal date strip pinned above a list of game
 * rows, away team over home team, score right-aligned as the biggest number
 * in the row, and one status column on the right doing start time, live
 * clock, and Final. The reasoning for each borrowed piece is written down in
 * `components/scores/ScoreboardGameRow.tsx`, next to the code that does it.
 *
 * WHAT IS OURS
 * Two things. First, tapping expands the row in place instead of pushing to a
 * game page, because we hold no play-by-play to fill a page with. Second, the
 * space those apps give to betting lines is given to Citrus projections: who
 * matters in this game, what we project them for, and how confident we are.
 *
 * POLLING
 * The query only polls while a game on screen is actually live. Off-season
 * and a slate of finals cost one fetch and then nothing, which matters on a
 * phone. `nhl_games` has never held a live row, so the live path here is
 * written against what the pipeline writes and lights up the first night it
 * writes it.
 */

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { DarkLayout } from '@/components/citrus2/DarkLayout';
import { useLeague } from '@/contexts/LeagueContext';
import { scoresApi } from '@/api/scores';
import { getTodayMST } from '@/utils/timezoneUtils';
import type { ScoresDayResponse } from '@citrus/shared';
import {
  ScoresDateStrip,
  ScoresEmptyDay,
  ScoresList,
  compareGames,
  friendlyDateLabel,
} from '@/components/scores';

/** How often to refetch while at least one game on screen is live. */
const LIVE_POLL_MS = 20_000;

export default function Scores() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeLeagueId } = useLeague();

  const dateParam = searchParams.get('date');
  const selectedDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : getTodayMST();

  const [expandedGameId, setExpandedGameId] = useState<number | null>(null);

  const selectDate = useCallback(
    (date: string) => {
      setExpandedGameId(null);
      const next = new URLSearchParams(searchParams);
      next.set('date', date);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ScoresDayResponse>({
    queryKey: ['scores', 'day', selectedDate, activeLeagueId],
    queryFn: () => scoresApi.getDay({ date: selectedDate, leagueId: activeLeagueId }),
    staleTime: 10_000,
    // Poll only while something is actually being played.
    refetchInterval: (query) =>
      query.state.data?.games.some((g) => g.state === 'live') ? LIVE_POLL_MS : false,
  });

  /**
   * Ordered once per fetch, not per render, so rows cannot shuffle under a
   * thumb between ticks.
   */
  const games = useMemo(() => [...(data?.games ?? [])].sort(compareGames), [data]);

  const liveCount = games.filter((g) => g.state === 'live').length;

  const toggle = useCallback((gameId: number) => {
    setExpandedGameId((current) => (current === gameId ? null : gameId));
  }, []);

  const manualRefresh = useCallback(() => {
    scoresApi.clearCache();
    void refetch();
  }, [refetch]);

  return (
    <DarkLayout>
      <Navbar />

      <div className="relative z-10 max-w-2xl mx-auto pb-16">
        <header className="px-4 pt-4 pb-1 flex items-end justify-between">
          <div>
            <h1 className="font-varsity text-2xl text-pastel-cream leading-none">Scores</h1>
            <p className="font-display text-[11px] text-pastel-sage/70 mt-1">
              {liveCount > 0
                ? `${liveCount} live now`
                : `${friendlyDateLabel(selectedDate)} around the league`}
            </p>
          </div>
          <button
            type="button"
            onClick={manualRefresh}
            aria-label="Refresh scores"
            className="p-2 -mr-2 rounded-full text-pastel-sage/70 active:bg-pastel-surface-high touch-manipulation"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </header>

        <div className="sticky top-0 z-sticky-raised">
          <ScoresDateStrip selected={selectedDate} onSelect={selectDate} />
        </div>

        {isLoading ? (
          <div className="px-3 py-3 flex flex-col gap-2" data-testid="scores-loading">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[92px] rounded-2xl bg-pastel-surface-tile animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-6 py-12 text-center" data-testid="scores-error">
            <p className="font-varsity text-base text-pastel-cream">Scores did not load</p>
            <p className="font-display text-xs text-pastel-forest-dim mt-1.5">
              {(error as Error | undefined)?.message ?? 'Something went wrong on the way here.'}
            </p>
            <button
              type="button"
              onClick={manualRefresh}
              className="mt-4 px-4 py-2 rounded-full bg-pastel-orange text-pastel-surface font-display text-xs font-semibold touch-manipulation"
            >
              Try again
            </button>
          </div>
        ) : games.length === 0 ? (
          <ScoresEmptyDay
            nearest={data?.nearestDateWithGames ?? { before: null, after: null }}
            onSelect={selectDate}
          />
        ) : (
          <>
            <ScoresList
              games={games}
              leagueId={activeLeagueId}
              expandedGameId={expandedGameId}
              onToggle={toggle}
            />
            {data?.truncated ? (
              <p className="px-4 pb-4 font-display text-[10px] text-pastel-orange-soft">
                This day is incomplete: the read hit its row cap.
              </p>
            ) : null}
            {activeLeagueId && data && !data.league.rostersResolved ? (
              <p className="px-4 pb-4 font-display text-[10px] text-pastel-forest-dim">
                Your league has no rostered players yet, so nothing is marked as yours.
              </p>
            ) : null}
          </>
        )}
      </div>
    </DarkLayout>
  );
}

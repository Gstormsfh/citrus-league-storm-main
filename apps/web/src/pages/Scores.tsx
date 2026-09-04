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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { PressBoxAppHeader } from '@/components/pressbox/AppHeader';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { cn } from '@/lib/utils';
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
  const navigate = useNavigate();
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
    /*
     * PRESS BOX (2026-09-04). The SCORES tab of the app nav. No artboard
     * draws this screen, so it is built from the vocabulary the artboards
     * do: the Home screen's app header with the tab's name in it, the
     * Match screen's `‹ day ›` strip, and game tiles in the ticker's
     * colours — sage while a game is on, orange-soft for what is projected,
     * 45% for what is over. The desktop keeps the Navbar.
     */
    <div className={cn(PB_TYPE, 'min-h-screen bg-pressbox-surface text-pressbox-text')}>
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden pt-[env(safe-area-inset-top)]">
        <PressBoxAppHeader
          title="Scores"
          logoSrc="/favicon.svg"
          onSearch={() => navigate('/players')}
          onNotifications={() => navigate('/profile')}
        />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto pb-app-chrome lg:pt-24 lg:pb-8">
        <div className="sticky top-0 z-sticky-raised">
          <ScoresDateStrip selected={selectedDate} onSelect={selectDate} />
        </div>

        <div className="px-3.5 pt-3 flex items-center justify-between">
          <p className="font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45">
            {liveCount > 0
              ? `${liveCount} live now`
              : `${friendlyDateLabel(selectedDate)} around the league`}
          </p>
          <button
            type="button"
            onClick={manualRefresh}
            aria-label="Refresh scores"
            className="focus-citrus relative p-1 -mr-1 rounded-full text-pressbox-text/45 after:absolute after:-inset-2 after:content-['']"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {isLoading ? (
          <div className="px-3.5 py-3 flex flex-col gap-2" data-testid="scores-loading">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[92px] rounded-[12px] bg-pressbox-tile border border-white/[0.08] animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-6 py-12 text-center" data-testid="scores-error">
            <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">Scores did not load</p>
            <p className="font-barlow text-[12px] text-pressbox-text/45 mt-1.5">
              {(error as Error | undefined)?.message ?? 'Something went wrong on the way here.'}
            </p>
            <button
              type="button"
              onClick={manualRefresh}
              className="focus-citrus mt-4 px-4 py-2 rounded-full bg-pressbox-text text-pressbox-surface font-plex font-semibold text-[10px] tracking-[0.06em] touch-manipulation"
            >
              TRY AGAIN
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
              <p className="px-3.5 pb-4 font-barlow text-[11px] text-pressbox-orange-soft">
                This day is incomplete: the read hit its row cap.
              </p>
            ) : null}
            {activeLeagueId && data && !data.league.rostersResolved ? (
              <p className="px-3.5 pb-4 font-barlow text-[11px] text-pressbox-text/45">
                Your league has no rostered players yet, so nothing is marked as yours.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

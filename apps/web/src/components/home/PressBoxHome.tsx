/**
 * HOME — artboard 1a's first phone, the LEAGUES tab.
 *
 * The app's front door for a signed-in manager: tonight's NHL slate as a
 * ticker, every league they are in with the one line that says whether to
 * open it, and the players of theirs who play tonight. Three reads:
 *
 *   * `scoresApi.getDay(today, activeLeague)` — the ticker AND the tonight
 *     cards, because the scores endpoint already marks which players in
 *     each game are on the caller's roster (`roster.isMine`) for the league
 *     it is asked about.
 *   * `leagueApi.getMyTeam(id)` + `matchupApi.getLeagueMatchups(id, week)`
 *     per fantasy league whose season is on — the card's live scoreline.
 *     Two small reads per league, cached by react-query; a league with no
 *     week (pre-draft, offseason) makes neither.
 *
 * NOTHING IS INVENTED. The artboard prints a rank (`2ND`) in the meta line
 * and a `TRAILING 3 CATS` note; neither is a read this screen makes, so
 * neither is drawn. `LIVE` is drawn when the week's matchup is in progress
 * and an NHL game is live right now — both facts, neither a guess.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { LEAGUE_TYPE_LABELS } from '@citrus/shared';
import { scoresApi } from '@/api/scores';
import { leagueApi } from '@/api/leagues';
import { matchupApi } from '@/api/matchups';
import { useLeague } from '@/contexts/LeagueContext';
import { getLeagueFormat } from '@/services/LeagueService';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';
import { getTodayMST } from '@/utils/timezoneUtils';
import { isBye, scoreOf, teamNameOf, type WeekMatchupRow } from '@/components/matchup/scoreboard';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxAppHeader } from '@/components/pressbox/AppHeader';
import { PressBoxScoreTicker } from '@/components/pressbox/ScoreTicker';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { PressBoxLeagueCard } from '@/components/pressbox/LeagueCard';
import { PressBoxTonightCards } from '@/components/pressbox/TonightCard';
import { FORMAT_SHORT, crestOf, tickerGame, tonightPlayers, weekOf } from './homeFormat';
import { cn } from '@/lib/utils';

export interface PressBoxHomeProps {
  /** From `useSeasonStatus`: the season has no week right now. */
  inOffseason: boolean;
  className?: string;
}

export function PressBoxHome({ inOffseason, className }: PressBoxHomeProps) {
  const navigate = useNavigate();
  const league = useLeague();
  const leagues = league?.userLeagues ?? [];
  const activeLeagueId = league?.activeLeagueId ?? null;
  const today = getTodayMST();

  const dayQuery = useQuery({
    queryKey: ['scores', 'day', today, activeLeagueId],
    queryFn: () => scoresApi.getDay({ date: today, leagueId: activeLeagueId }),
    staleTime: 10_000,
    refetchInterval: (q) => (q.state.data?.games.some((g) => g.state === 'live') ? 30_000 : false),
  });

  const fantasy = useMemo(
    () => leagues.map((l) => ({ league: l, week: !isPoolLeague(getLeagueFormat(l).leagueType) ? weekOf(l, inOffseason) : null })),
    [leagues, inOffseason],
  );

  const teamQueries = useQueries({
    queries: fantasy.map(({ league: l, week }) => ({
      queryKey: ['home-my-team', l.id],
      enabled: week !== null,
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const res = await leagueApi.getMyTeam(l.id);
        return ((res as { data?: { id?: string } | null }).data ?? null) as { id?: string } | null;
      },
    })),
  });
  const weekQueries = useQueries({
    queries: fantasy.map(({ league: l, week }) => ({
      queryKey: ['league-hq-matchups', l.id, week],
      enabled: week !== null,
      staleTime: 60_000,
      queryFn: async () => {
        const res = await matchupApi.getLeagueMatchups(l.id, week!);
        const rows = ((res as { data?: unknown }).data ?? res) as unknown;
        return Array.isArray(rows) ? (rows as WeekMatchupRow[]) : [];
      },
    })),
  });

  const anyLive = dayQuery.data?.games.some((g) => g.state === 'live') ?? false;
  const ticker = useMemo(() => (dayQuery.data?.games ?? []).map(tickerGame), [dayQuery.data]);
  const tonight = useMemo(() => tonightPlayers(dayQuery.data), [dayQuery.data]);
  const weekLabel = useMemo(() => {
    const weeks = fantasy.map((f) => f.week).filter((w): w is number => w !== null);
    return weeks.length ? `WEEK ${Math.min(...weeks)}` : null;
  }, [fantasy]);

  return (
    <div className={cn(PB_TYPE, 'min-h-screen bg-pressbox-surface pb-app-chrome', className)} data-testid="pressbox-home">
      <PressBoxAppHeader
        logoSrc="/favicon.svg"
        onSearch={() => navigate('/players')}
        onAddLeague={() => navigate('/create-league')}
        onNotifications={() => navigate('/profile')}
      />

      <div className="px-3">
        {ticker.length > 0 && <PressBoxScoreTicker games={ticker} className="mt-1.5" />}

        <PressBoxSectionHead
          title="My leagues"
          className="px-1 pt-[18px] pb-2"
          action={
            <span className="font-plex font-medium text-[11px] text-pressbox-text/50">
              {leagues.length}{weekLabel ? ` · ${weekLabel}` : ''}
            </span>
          }
        />

        {leagues.length === 0 ? (
          <div className="rounded-[12px] bg-pressbox-tile border border-white/[0.08] p-4 text-center">
            <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">No leagues yet</p>
            <p className="mt-1 font-plex font-medium text-[10px] text-pressbox-text/45">Create one, or join with a code</p>
            <button
              type="button"
              onClick={() => navigate('/create-league')}
              className="focus-citrus mt-3 px-[11px] py-[5px] rounded-full bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold text-[13px] uppercase tracking-[0.1em]"
            >
              + League
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {fantasy.map(({ league: l, week }, i) => {
              const fmt = getLeagueFormat(l);
              const pool = isPoolLeague(fmt.leagueType);
              const teams = (l.settings as { teamsCount?: number } | null)?.teamsCount;
              const metaLine = [
                teams ? (pool ? `${teams} PLAYERS` : `${teams}-TEAM`) : null,
                pool
                  ? ((LEAGUE_TYPE_LABELS as Record<string, string>)[fmt.leagueType] ?? fmt.leagueType).replace(/\s+pool$/i, '').toUpperCase()
                  : FORMAT_SHORT[fmt.scoringFormat] ?? null,
                l.draft_status !== 'completed' && !pool ? (l.draft_status === 'in_progress' ? 'DRAFT LIVE' : 'PRE-DRAFT') : null,
              ]
                .filter(Boolean)
                .join(' · ');
              const to = pool ? getPoolRoute(fmt.leagueType, l.id) : `/league/${l.id}`;

              const myId = teamQueries[i]?.data?.id ?? null;
              const rows = weekQueries[i]?.data;
              const mine = myId && rows ? rows.find((r) => r.team1_id === myId || r.team2_id === myId) : undefined;
              const iAmTeam1 = mine ? mine.team1_id === myId : false;
              const youSide = mine ? (iAmTeam1 ? 'team1' : 'team2') : null;
              const themSide = mine ? (iAmTeam1 ? 'team2' : 'team1') : null;
              const live = !!mine && mine.status === 'in_progress' && anyLive;

              return (
                <PressBoxLeagueCard
                  key={l.id}
                  name={l.name}
                  crest={crestOf(l.name)}
                  metaLine={metaLine || null}
                  to={to}
                  badge={l.draft_status === 'in_progress' ? 'DRAFT LIVE' : live ? 'LIVE' : null}
                  badgeTone={l.draft_status === 'in_progress' ? 'due' : 'live'}
                  you={
                    mine && youSide
                      ? {
                          name: teamNameOf(mine, youSide),
                          score: scoreOf(youSide === 'team1' ? mine.team1_score : mine.team2_score),
                          projection: (() => {
                            const p = youSide === 'team1' ? mine.team1_projected_total : mine.team2_projected_total;
                            return p == null ? null : Number(p);
                          })(),
                          isYou: true,
                        }
                      : null
                  }
                  them={
                    mine && themSide
                      ? isBye(mine)
                        ? { name: 'Bye week' }
                        : {
                            name: teamNameOf(mine, themSide),
                            score: scoreOf(themSide === 'team1' ? mine.team1_score : mine.team2_score),
                            projection: (() => {
                              const p = themSide === 'team1' ? mine.team1_projected_total : mine.team2_projected_total;
                              return p == null ? null : Number(p);
                            })(),
                          }
                      : null
                  }
                />
              );
            })}
          </div>
        )}

        {tonight.players.length > 0 && (
          <>
            <PressBoxSectionHead
              title="Tonight on your rosters"
              className="px-1 pt-[18px] pb-2"
              action={
                <span className="font-plex font-medium text-[11px] text-pressbox-text/50">
                  {tonight.games} {tonight.games === 1 ? 'GAME' : 'GAMES'}
                </span>
              }
            />
            <PressBoxTonightCards players={tonight.players} />
          </>
        )}
      </div>
    </div>
  );
}

export default PressBoxHome;

/**
 * THE MENU'S READS (2026-09-05, artboard 1a · League menu).
 *
 * The tiles' lines -- `2nd · 4–1`, `1 offer waiting on you · 2 pending`,
 * `You're #7 · processes 2:00 AM MT`, `Wk 2 vs Bench Bosses`, `Snake · 18
 * rds`, `12/12 · share link` -- from reads the league screens already make,
 * under the same react-query keys, so opening the menu after League HQ
 * costs nothing and opening it cold costs five small requests that start
 * when the menu opens (`enabled: open`) and never before. The pure
 * arithmetic is `leagueMenuTiles`; this is only the plumbing.
 *
 * The league itself comes from the context when it is the one the header
 * names (the crest rule in LeagueChrome); a page showing another league
 * gets the tiles without the lines that need the league row.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { getLeagueFormat, type League } from '@/services/LeagueService';
import { clampToSeasonStart, getCurrentWeekNumber, getDraftCompletionDate, getFirstWeekStartDate, getScheduleLength } from '@/utils/weekCalculator';
import { isBye, teamNameOf, type WeekMatchupRow } from '@/components/matchup/scoreboard';
import type { StandingsLineRow } from '@/components/league/hqLines';
import { leagueMenuTiles, type LeagueMenuTile } from './leagueMenuTiles';

// The API clients are imported when a read runs, not when the chrome
// mounts: `@/api/client` builds the Supabase client at module scope, and
// every league page wears this chrome -- including the ones whose tests
// mock the services and never open the menu.
const rowsOf = <T,>(res: unknown): T[] => {
  const rows = ((res as { data?: unknown })?.data ?? res) as unknown;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

/** The fantasy week by the Matchup page's arithmetic, or null when there is none. */
function weekOf(league: League | null): { week: number; length: number } | null {
  if (!league || league.draft_status !== 'completed') return null;
  const done = getDraftCompletionDate(league);
  if (!done || Number.isNaN(done.getTime())) return null;
  const first = clampToSeasonStart(getFirstWeekStartDate(done));
  const week = getCurrentWeekNumber(first);
  const length = getScheduleLength(first);
  return week >= 1 && week <= length ? { week, length } : null;
}

export function useLeagueMenuTiles(leagueId: string, open: boolean): LeagueMenuTile[] {
  const { user } = useAuth();
  const ctx = useLeague();
  const league = ctx?.activeLeagueId === leagueId ? ctx.activeLeague : null;
  const enabled = open && !!leagueId;
  const drafted = league?.draft_status === 'completed';

  const myTeam = useQuery({
    queryKey: ['home-my-team', leagueId],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { leagueApi } = await import('@/api/leagues');
      const res = await leagueApi.getMyTeam(leagueId);
      return ((res as { data?: { id?: string } | null }).data ?? null) as { id?: string } | null;
    },
  });
  const standings = useQuery({
    queryKey: ['league-standings', leagueId],
    enabled: enabled && drafted,
    staleTime: 60_000,
    queryFn: async () => {
      const { leagueApi } = await import('@/api/leagues');
      return rowsOf<StandingsLineRow & { losses: number; ties?: number }>(await leagueApi.getStandings(leagueId));
    },
  });
  const pendingTrades = useQuery({
    queryKey: ['league-pending-trades', leagueId],
    enabled: enabled && drafted,
    staleTime: 60_000,
    queryFn: async () => {
      const { tradeApi } = await import('@/api/trades');
      return rowsOf<{ to_team_id?: string | null }>(await tradeApi.getLeagueTrades(leagueId, 'pending'));
    },
  });
  const waiverPriority = useQuery({
    queryKey: ['waiver-priority', leagueId],
    enabled: enabled && drafted,
    staleTime: 60_000,
    queryFn: async () => {
      const { WaiverService } = await import('@/services/WaiverService');
      return (await WaiverService.getWaiverPriority(leagueId)) as Array<{ team_id: string; priority: number }>;
    },
  });
  const teams = useQuery({
    queryKey: ['league-teams', leagueId],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { leagueApi } = await import('@/api/leagues');
      return rowsOf<{ id: string }>(await leagueApi.getTeams(leagueId));
    },
  });
  const week = useMemo(() => weekOf(league), [league]);
  const nextWeekNumber = week && week.week < week.length ? week.week + 1 : null;
  const nextWeekRows = useQuery({
    queryKey: ['league-hq-matchups', leagueId, nextWeekNumber],
    enabled: enabled && nextWeekNumber !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const { matchupApi } = await import('@/api/matchups');
      return rowsOf<WeekMatchupRow>(await matchupApi.getLeagueMatchups(leagueId, nextWeekNumber!));
    },
  });

  return useMemo(() => {
    const myTeamId = myTeam.data?.id ?? null;
    let nextWeek: { number: number; opponent: string | null } | null = null;
    if (nextWeekNumber !== null && nextWeekRows.data && myTeamId) {
      const mine = nextWeekRows.data.find((r) => r.team1_id === myTeamId || r.team2_id === myTeamId);
      if (mine) {
        nextWeek = {
          number: nextWeekNumber,
          opponent: isBye(mine) ? null : teamNameOf(mine, mine.team1_id === myTeamId ? 'team2' : 'team1'),
        };
      }
    }
    const teamsCount = (league?.settings as { teamsCount?: number } | null)?.teamsCount ?? null;
    return leagueMenuTiles({
      leagueId,
      myTeamId,
      standings: standings.data ?? null,
      pendingTrades: pendingTrades.data ?? null,
      waiverPriority: waiverPriority.data ?? null,
      waiverProcessTime: league?.waiver_process_time ?? null,
      nextWeek,
      draft: league
        ? { completed: league.draft_status === 'completed', type: getLeagueFormat(league).draftType, rounds: league.draft_rounds ?? 0 }
        : null,
      managers: teams.data ? { count: teams.data.length, max: teamsCount, canInvite: !!league?.join_code } : null,
      commissioner: !!league && !!user && league.commissioner_id === user.id,
    });
  }, [leagueId, league, user, myTeam.data, standings.data, pendingTrades.data, waiverPriority.data, teams.data, nextWeekRows.data, nextWeekNumber]);
}

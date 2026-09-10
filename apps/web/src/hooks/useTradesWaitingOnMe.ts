/**
 * HOW MANY TRADE OFFERS ARE WAITING ON ME (2026-09-09).
 *
 * Found on a phone: a manager had an offer sitting in the Trade Center and
 * nothing on the Team screen said so. The push had not arrived — and even
 * once push works, an app must not rely on it for anything with a clock
 * on it. Offers expire. This count goes on the TRADE action and anywhere
 * else the eye lands.
 *
 * Shares the league menu's query key (`league-pending-trades`) so the two
 * never disagree and the offer list is fetched once per league, not once
 * per surface that shows it.
 */
import { useQuery } from '@tanstack/react-query';

type PendingRow = { to_team_id?: string | null; status?: string | null };

function rowsOf(res: unknown): PendingRow[] {
  const data = (res as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as PendingRow[]) : [];
}

export function useTradesWaitingOnMe(leagueId: string | null | undefined, myTeamId: string | null | undefined): number {
  const q = useQuery({
    queryKey: ['league-pending-trades', leagueId],
    enabled: Boolean(leagueId),
    staleTime: 60_000,
    queryFn: async () => {
      const { tradeApi } = await import('@/api/trades');
      return rowsOf(await tradeApi.getLeagueTrades(leagueId as string, 'pending'));
    },
  });
  if (!myTeamId || !q.data) return 0;
  return q.data.filter((t) => t.to_team_id === myTeamId).length;
}

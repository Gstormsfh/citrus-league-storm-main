import { useEffect, useState } from 'react';
import { playoffApi } from '@/api/playoffs';
import { leagueApi } from '@/api/leagues';
import { logger } from '@citrus/shared';

export type PlayoffChampionStatus = 'none' | 'in_progress' | 'completed';

export interface PlayoffChampionInfo {
  status: PlayoffChampionStatus;
  championTeamName: string | null;
  loading: boolean;
}

interface BracketShape {
  status?: string;
  champion_team_id?: string | null;
}

interface TeamShape {
  id: string;
  team_name: string;
}

/**
 * Lightweight hook that fetches the playoff bracket for a league and
 * returns whether it is in progress or completed, along with the
 * champion team name (when completed). Returns `status: 'none'` if the
 * league is not a fantasy league or no bracket exists.
 */
export function usePlayoffChampion(
  leagueId: string | null | undefined,
  leagueType: string | null | undefined,
): PlayoffChampionInfo {
  const [info, setInfo] = useState<PlayoffChampionInfo>({
    status: 'none',
    championTeamName: null,
    loading: false,
  });

  useEffect(() => {
    let cancelled = false;

    if (!leagueId || leagueType !== 'fantasy') {
      setInfo({ status: 'none', championTeamName: null, loading: false });
      return;
    }

    setInfo((prev) => ({ ...prev, loading: true }));

    (async () => {
      try {
        const res = await playoffApi.getBracket(leagueId);
        const bracket = (res.data as { bracket?: BracketShape } | undefined)?.bracket;
        if (!bracket) {
          if (!cancelled) setInfo({ status: 'none', championTeamName: null, loading: false });
          return;
        }

        if (bracket.status === 'completed' && bracket.champion_team_id) {
          const teamsRes = await leagueApi.getTeams(leagueId);
          const teams = (teamsRes.data as TeamShape[] | undefined) || [];
          const champ = teams.find((t) => t.id === bracket.champion_team_id);
          if (!cancelled) {
            setInfo({
              status: 'completed',
              championTeamName: champ?.team_name || 'Champion',
              loading: false,
            });
          }
          return;
        }

        if (bracket.status === 'active' || bracket.status === 'pending') {
          if (!cancelled) setInfo({ status: 'in_progress', championTeamName: null, loading: false });
          return;
        }

        if (!cancelled) setInfo({ status: 'none', championTeamName: null, loading: false });
      } catch (err) {
        logger.error('[usePlayoffChampion] Failed to load bracket', err);
        if (!cancelled) setInfo({ status: 'none', championTeamName: null, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId, leagueType]);

  return info;
}

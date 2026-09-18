/**
 * LEAGUE HISTORY (2026-09-13): the trophy room.
 *
 * Every season the league has played, wherever it played it, with the
 * champion the source recorded; the record book Citrus computed from the
 * weekly results; the managers and their careers. A member who signed up
 * after the import claims their own name here. The commissioner confirms
 * the scoring and keeper rules the import found, resolves the players the
 * crosswalk could not place, tidies the managers, and locks it.
 *
 * Reads only through importApi; the server decides who may do what.
 */
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { importApi, type LeagueHistory as LeagueHistoryData, type ClaimQuestion } from '@/api/imports';
import { leagueApi } from '@/api/leagues';
import Navbar from '@/components/Navbar';
import { PressBoxLeagueChrome } from '@/components/pressbox/LeagueChrome';
import { PressBoxSkeletonList } from '@/components/pressbox/Skeleton';
import { ClaimCard } from '@/components/history/ClaimCard';
import { TrophyRoom } from '@/components/history/TrophyRoom';
import { CommissionerHistoryTools } from '@/components/history/CommissionerHistoryTools';
import { EmptyState, Eyebrow, HistoryButton } from '@/components/history/ui';
import { platformLabel, seasonLabel } from '@/components/history/trophyLabels';
import { YahooAttribution } from '@/components/history/YahooAttribution';
import { useToast } from '@/hooks/use-toast';

const dataOf = <T,>(res: unknown): T | null => ((res as { data?: T })?.data ?? null);

export default function LeagueHistory() {
  const { leagueId = '' } = useParams<{ leagueId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const history = useQuery({
    queryKey: ['league-history', leagueId],
    enabled: !!leagueId,
    queryFn: async () => dataOf<LeagueHistoryData>(await importApi.getHistory(leagueId)),
  });
  const league = useQuery({
    queryKey: ['league', leagueId],
    enabled: !!leagueId,
    staleTime: 60_000,
    queryFn: async () => dataOf<{ id: string; name: string; commissioner_id: string }>(await leagueApi.getLeague(leagueId)),
  });
  const isCommissioner = !!user && league.data?.commissioner_id === user.id;
  // The server decides whether this person still needs asking: the foundation
  // seed gave every current team owner a member row, so "has a row" is not
  // "has claimed" (see ClaimQuestion). Same key as the HQ banner.
  const unclaimed = useQuery({
    queryKey: ['league-history-unclaimed', leagueId],
    enabled: !!leagueId && (history.data?.seasons.length ?? 0) > 0,
    queryFn: async () => dataOf<ClaimQuestion>(await importApi.listUnclaimed(leagueId)) ?? { members: [], attached: false },
  });
  const askClaim = !!unclaimed.data && !unclaimed.data.attached && unclaimed.data.members.length > 0;
  const teams = useQuery({
    queryKey: ['league-teams-owners', leagueId],
    enabled: isCommissioner,
    staleTime: 60_000,
    queryFn: async () => dataOf<Array<{ id: string; team_name: string; owner_id: string | null }>>(await leagueApi.getTeams(leagueId, true)) ?? [],
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['league-history', leagueId] });
    void queryClient.invalidateQueries({ queryKey: ['league-history-unclaimed', leagueId] });
  };

  useEffect(() => {
    if (!leagueId) navigate('/', { replace: true });
  }, [leagueId, navigate]);

  const data = history.data;
  const leagueName = data?.league?.name ?? league.data?.name ?? '';
  const seasonsCount = data?.seasons.length ?? 0;
  const founded = data?.league?.founded_season ?? (seasonsCount ? Math.min(...data!.seasons.map((s) => s.season)) : null);
  const sourceNames = Array.from(new Set((data?.sources ?? []).map((s) => s.platform)));
  const fromYahoo = sourceNames.includes('yahoo');
  const managers = (teams.data ?? []).filter((t) => t.owner_id).map((t) => ({ userId: t.owner_id as string, label: t.team_name }));

  const claim = async (memberId: string) => {
    await importApi.claim(leagueId, memberId);
    toast({ title: "It's yours", description: 'Your seasons, trophies and records are attached to your account.' });
    refresh();
  };

  return (
    <div className="min-h-screen bg-pressbox-surface text-pressbox-text flex flex-col">
      <div className="hidden lg:block"><Navbar /></div>
      <PressBoxLeagueChrome leagueId={leagueId} leagueName={leagueName || null} />
      <main className="pb-app-chrome lg:pt-app-header lg:pb-16">
        <div className="pb-type mx-auto w-full max-w-3xl px-3.5 pt-4 lg:px-6">
          <Eyebrow>✦ League history</Eyebrow>
          <h1 className="mt-1 font-condensed font-extrabold text-[26px] uppercase tracking-[0.02em] leading-none text-pressbox-text">{leagueName || 'Trophy room'}</h1>
          <p className="mt-1.5 font-barlow text-[13px] text-white/55">
            {seasonsCount > 0
              ? [founded != null ? `Founded ${seasonLabel(founded)}` : null, `${seasonsCount} ${seasonsCount === 1 ? 'season' : 'seasons'}`, sourceNames.length ? `from ${sourceNames.map(platformLabel).join(' and ')}` : null].filter(Boolean).join(' · ')
              : 'The record book starts with your first season.'}
          </p>

          {history.isLoading && (
            <div className="mt-4" aria-busy="true" aria-label="Loading the trophy room">
              <PressBoxSkeletonList rows={6} />
            </div>
          )}

          {history.isError && (
            <div className="mt-4">
              <EmptyState kicker="Connection hiccup" primary="Couldn't reach the trophy room." context="Your history is safe. Try again in a moment." action={<HistoryButton tone="quiet" onClick={() => void history.refetch()}>Try again</HistoryButton>} />
            </div>
          )}

          {data && seasonsCount === 0 && (
            <div className="mt-4">
              <EmptyState
                kicker="Nothing on the shelf yet"
                primary="This league's history starts here."
                context={isCommissioner ? 'Played somewhere else before Citrus? Bring every season, champion and record over.' : 'Ask your commissioner to bring the league\'s past seasons over from Yahoo or ESPN.'}
                action={isCommissioner ? <Link to={`/import?league=${leagueId}`} className="inline-flex h-10 items-center rounded-[10px] bg-pressbox-orange px-4 font-condensed font-bold text-[14px] uppercase tracking-[0.06em] text-pressbox-orange-ink">Bring your league's history</Link> : undefined}
              />
            </div>
          )}

          {data && seasonsCount > 0 && (
            <div className="mt-4 space-y-4">
              {askClaim && <ClaimCard members={unclaimed.data!.members} onClaim={claim} />}
              <TrophyRoom history={data} currentUserId={user?.id ?? null} />
              {isCommissioner && (
                <>
                  <CommissionerHistoryTools leagueId={leagueId} history={data} managers={managers} onChanged={refresh} />
                  <div className="pt-1">
                    <Link to={`/import?league=${leagueId}`} className="font-barlow text-[13px] text-pressbox-orange-soft">Import more seasons</Link>
                  </div>
                </>
              )}
              {fromYahoo && <YahooAttribution className="pt-2 text-center" />}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}


import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { LeagueService, type Team } from '@/services/LeagueService';
import { PlayerService } from '@/services/PlayerService';
import { supabase } from '@/integrations/supabase/client';
import { Trophy, TrendingUp, Shield } from 'lucide-react';
import { CitrusSparkle, CitrusBurst, CitrusLeaf } from '@/components/icons/CitrusIcons';
import { logger } from '@/utils/logger';

export const StatsOverviewCards = () => {
  const { user } = useAuth();
  const { activeLeagueId } = useLeague();
  const [stats, setStats] = useState({
    rank: '-',
    percentile: '-',
    pointsFor: 0,
    avgPointsFor: 0,
    pointsAgainst: 0,
    avgPointsAgainst: 0,
    loading: true
  });

  useEffect(() => {
    const fetchStats = async () => {
      if (!user || !activeLeagueId) {
        setStats(prev => ({ ...prev, loading: false }));
        return;
      }

      try {
        // Fetch league teams
        const { teams: leagueTeams } = await LeagueService.getLeagueTeams(activeLeagueId);
        if (!leagueTeams || leagueTeams.length === 0) {
          setStats(prev => ({ ...prev, loading: false }));
          return;
        }

        // Find user's team
        const userTeamId = leagueTeams.find(t => t.owner_id === user.id)?.id;
        if (!userTeamId) {
          setStats(prev => ({ ...prev, loading: false }));
          return;
        }

        // Fetch draft picks and players for standings calculation
        const { data: draftPicksData } = await (supabase as any)
          .from('draft_picks')
          .select('team_id, player_id')
          .eq('league_id', activeLeagueId);
        const draftPicks = (draftPicksData || []) as Array<{ team_id: string; player_id: string }>;
        const allPlayers = await PlayerService.getAllPlayers();

        // Get team standings (returns Record<teamId, stats>)
        const standingsMap = await LeagueService.calculateTeamStandings(
          activeLeagueId,
          leagueTeams,
          draftPicks,
          allPlayers
        );

        // Convert to sorted array for ranking
        const standingsArray = Object.entries(standingsMap)
          .map(([teamId, s]) => ({ teamId, ...s }))
          .sort((a, b) => b.pointsFor - a.pointsFor);

        const myStanding = standingsMap[userTeamId];

        if (myStanding) {
          const rank = standingsArray.findIndex(s => s.teamId === userTeamId) + 1;
          const percentile = Math.round((1 - (rank - 1) / standingsArray.length) * 100);
          const gamesPlayed = myStanding.wins + myStanding.losses + myStanding.ties || 1;

          setStats({
            rank: `${rank}${getRankSuffix(rank)}`,
            percentile: `Top ${percentile}%`,
            pointsFor: myStanding.pointsFor,
            avgPointsFor: myStanding.pointsFor / gamesPlayed,
            pointsAgainst: myStanding.pointsAgainst,
            avgPointsAgainst: myStanding.pointsAgainst / gamesPlayed,
            loading: false
          });
        } else {
          setStats(prev => ({ ...prev, loading: false }));
        }
      } catch (error) {
        logger.error('Error fetching stats:', error);
        setStats(prev => ({ ...prev, loading: false }));
      }
    };

    fetchStats();
  }, [user, activeLeagueId]);

  const getRankSuffix = (rank: number) => {
    const j = rank % 10;
    const k = rank % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
      <Card className="relative overflow-hidden bg-[#E8EED9]/50 backdrop-blur-sm corduroy-texture border-4 border-citrus-sage rounded-varsity shadow-[0_6px_0_rgba(27,48,34,0.2)] hover:-translate-y-1 transition-all">
        <div className="absolute inset-0 bg-gradient-to-br from-citrus-sage/10 to-transparent"></div>
        <CitrusBurst className="absolute top-2 right-2 w-16 h-16 text-citrus-sage/10" />
        <CardContent className="p-6 relative z-10">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-5 h-5 text-citrus-orange" />
              <div className="text-sm font-display font-semibold text-citrus-charcoal">League Rank</div>
            </div>
            <div className="text-4xl font-varsity font-black text-citrus-forest">
              {stats.loading ? '...' : stats.rank}
            </div>
            <div className="text-sm font-display text-citrus-orange mt-2 font-semibold">{stats.loading ? '...' : stats.percentile}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden bg-[#E8EED9]/50 backdrop-blur-sm corduroy-texture border-4 border-citrus-orange rounded-varsity shadow-[0_6px_0_rgba(27,48,34,0.2)] hover:-translate-y-1 transition-all">
        <div className="absolute inset-0 bg-gradient-to-br from-citrus-orange/10 to-transparent"></div>
        <CitrusSparkle className="absolute top-2 right-2 w-16 h-16 text-citrus-orange/10" />
        <CardContent className="p-6 relative z-10">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-5 h-5 text-citrus-sage" />
              <div className="text-sm font-display font-semibold text-citrus-charcoal">Points For</div>
            </div>
            <div className="text-4xl font-varsity font-black text-citrus-forest">
              {stats.loading ? '...' : stats.pointsFor.toFixed(1)}
            </div>
            <div className="text-sm font-display text-citrus-sage mt-2 font-semibold">
              {stats.loading ? '...' : `${stats.avgPointsFor.toFixed(1)} avg/week`}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden bg-[#E8EED9]/50 backdrop-blur-sm corduroy-texture border-4 border-citrus-peach rounded-varsity shadow-[0_6px_0_rgba(27,48,34,0.2)] hover:-translate-y-1 transition-all">
        <div className="absolute inset-0 bg-gradient-to-br from-citrus-peach/10 to-transparent"></div>
        <CitrusLeaf className="absolute top-2 right-2 w-16 h-16 text-citrus-peach/10 rotate-45" />
        <CardContent className="p-6 relative z-10">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5 text-citrus-peach" />
              <div className="text-sm font-display font-semibold text-citrus-charcoal">Points Against</div>
            </div>
            <div className="text-4xl font-varsity font-black text-citrus-forest">
              {stats.loading ? '...' : stats.pointsAgainst.toFixed(1)}
            </div>
            <div className="text-sm font-display text-citrus-peach mt-2 font-semibold">
              {stats.loading ? '...' : `${stats.avgPointsAgainst.toFixed(1)} avg/week`}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

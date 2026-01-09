import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { MatchupService } from '@/services/MatchupService';
import { LeagueService } from '@/services/LeagueService';
import { getCurrentWeekNumber, getFirstWeekStartDate, getWeekStartDate, getWeekEndDate } from '@/utils/weekCalculator';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { CitrusSparkle, CitrusWedge } from '@/components/icons/CitrusIcons';
import { COLUMNS } from '@/utils/queryColumns';

interface HeadlineItem {
  type: 'waiver' | 'matchup' | 'streak';
  message: string;
  urgency: 'high' | 'medium' | 'low';
}

export const HeadlinesBanner = () => {
  const { user } = useAuth();
  const { activeLeagueId, activeLeague } = useLeague();
  const [headline, setHeadline] = useState<HeadlineItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !activeLeagueId || !activeLeague) {
      setLoading(false);
      return;
    }

    const fetchHeadlines = async () => {
      try {
        const headlines: HeadlineItem[] = [];

        // 1. Check for upcoming matchup
        try {
          const draftCompletionDate = activeLeague.updated_at ? new Date(activeLeague.updated_at) : new Date();
          const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
          const currentWeek = getCurrentWeekNumber(firstWeekStart);
          
          // Get user's team
          const { data: userTeam } = await supabase
            .from('teams')
            .select('id, name')
            .eq('league_id', activeLeagueId)
            .eq('owner_id', user.id)
            .maybeSingle();

          if (userTeam) {
            // Get current week matchup
            const { matchup } = await MatchupService.getUserMatchup(
              activeLeagueId,
              user.id,
              currentWeek
            );

            if (matchup) {
              const weekStart = getWeekStartDate(currentWeek, firstWeekStart);
              const weekEnd = getWeekEndDate(currentWeek, firstWeekStart);
              const today = new Date();
              
              // Check if matchup is upcoming (starts Monday)
              if (today < weekStart) {
                const daysUntil = Math.ceil((weekStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                const opponentId = matchup.team1_id === userTeam.id ? matchup.team2_id : matchup.team1_id;
                
                if (opponentId) {
                  const { data: opponentTeam } = await supabase
                    .from('teams')
                    .select('name')
                    .eq('id', opponentId)
                    .maybeSingle();
                  
                  const opponentName = opponentTeam?.name || 'Opponent';
                  headlines.push({
                    type: 'matchup',
                    message: `Next Matchup: vs. ${opponentName} (Starts in ${daysUntil} day${daysUntil !== 1 ? 's' : ''})`,
                    urgency: daysUntil <= 2 ? 'high' : daysUntil <= 5 ? 'medium' : 'low'
                  });
                }
              } else if (today >= weekStart && today <= weekEnd) {
                // Matchup is active
                const opponentId = matchup.team1_id === userTeam.id ? matchup.team2_id : matchup.team1_id;
                if (opponentId) {
                  const { data: opponentTeam } = await supabase
                    .from('teams')
                    .select('name')
                    .eq('id', opponentId)
                    .maybeSingle();
                  
                  const opponentName = opponentTeam?.name || 'Opponent';
                  headlines.push({
                    type: 'matchup',
                    message: `Matchup in Progress: vs. ${opponentName}`,
                    urgency: 'high'
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error('Error fetching matchup headline:', error);
        }

        // 2. Calculate team streak
        try {
          const { data: userTeam } = await supabase
            .from('teams')
            .select('id')
            .eq('league_id', activeLeagueId)
            .eq('owner_id', user.id)
            .maybeSingle();

          if (userTeam) {
            const record = await MatchupService.getTeamRecord(userTeam.id, activeLeagueId);
            
            // Get recent matchups to calculate streak
            const { data: recentMatchups } = await supabase
              .from('matchups')
              .select(COLUMNS.MATCHUP)
              .eq('league_id', activeLeagueId)
              .eq('status', 'completed')
              .or(`team1_id.eq.${userTeam.id},team2_id.eq.${userTeam.id}`)
              .order('week', { ascending: false })
              .limit(7);

            if (recentMatchups && recentMatchups.length > 0) {
              let streak = 0;
              let isWinStreak = true;
              
              for (const matchup of recentMatchups) {
                const isTeam1 = matchup.team1_id === userTeam.id;
                const myScore = isTeam1 ? matchup.team1_score : matchup.team2_score;
                const oppScore = isTeam1 ? matchup.team2_score : matchup.team1_score;
                
                if (streak === 0) {
                  isWinStreak = myScore > oppScore;
                  streak = 1;
                } else if ((isWinStreak && myScore > oppScore) || (!isWinStreak && myScore < oppScore)) {
                  streak++;
                } else {
                  break;
                }
              }

              if (streak >= 3) {
                const streakType = isWinStreak ? 'Hot Streak' : 'Cold Streak';
                const streakEmoji = isWinStreak ? '🔥' : '❄️';
                headlines.push({
                  type: 'streak',
                  message: `Team Mood: ${streakType} (${streak} ${isWinStreak ? 'W' : 'L'} in a row) ${streakEmoji}`,
                  urgency: isWinStreak ? 'medium' : 'high'
                });
              } else if (record.wins + record.losses > 0) {
                const winPct = record.wins / (record.wins + record.losses);
                if (winPct >= 0.7) {
                  headlines.push({
                    type: 'streak',
                    message: `Team Record: ${record.wins}-${record.losses} (Strong Start)`,
                    urgency: 'low'
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error('Error calculating streak:', error);
        }

        // 3. Check for waiver wire deadline (default to Sunday 11 PM EST)
        // For now, we'll use a simple check - could be enhanced with league settings
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
        const hours = today.getHours();
        
        if (dayOfWeek === 0 && hours < 23) {
          // Sunday before 11 PM
          const hoursUntil = 23 - hours;
          headlines.push({
            type: 'waiver',
            message: `Waiver Wire runs tonight at 11 PM EST. ${hoursUntil} hour${hoursUntil !== 1 ? 's' : ''} remaining.`,
            urgency: hoursUntil <= 3 ? 'high' : 'medium'
          });
        } else if (dayOfWeek === 6 || (dayOfWeek === 0 && hours >= 23)) {
          // Saturday or Sunday after 11 PM
          headlines.push({
            type: 'waiver',
            message: 'Waiver Wire processing tonight. Make your claims now!',
            urgency: 'high'
          });
        }

        // Sort by urgency (high first) and pick the most urgent
        headlines.sort((a, b) => {
          const urgencyOrder = { high: 0, medium: 1, low: 2 };
          return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
        });

        setHeadline(headlines[0] || null);
      } catch (error) {
        console.error('Error fetching headlines:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHeadlines();
  }, [user, activeLeagueId, activeLeague]);

  // Show loading state or placeholder for guests
  if (loading) {
    return (
      <div className="w-full px-6 py-4 rounded-varsity mb-6 flex items-center gap-3 text-citrus-cream font-varsity font-bold text-sm md:text-base animate-pulse bg-gradient-to-r from-citrus-orange to-citrus-peach border-4 border-citrus-forest/50 shadow-patch corduroy-texture relative overflow-hidden">
        <CitrusSparkle className="w-5 h-5 animate-pulse" />
        <div className="flex-1">Loading updates...</div>
        <CitrusWedge className="absolute top-1 right-2 w-8 h-8 opacity-20 rotate-12" />
      </div>
    );
  }

  // For guests or users without leagues, show a welcome message
  if (!user || !activeLeagueId || !headline) {
    return (
      <div className="w-full px-6 py-4 rounded-varsity mb-6 flex items-center gap-3 text-citrus-cream font-varsity font-bold text-sm md:text-base bg-gradient-to-r from-citrus-sage to-citrus-orange border-4 border-citrus-forest shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] corduroy-texture relative overflow-hidden">
        <CitrusSparkle className="w-5 h-5" />
        <div className="flex-1 font-display font-semibold">Welcome to GM's Office! Create or join a league to see personalized updates.</div>
        <CitrusWedge className="absolute top-1 right-2 w-10 h-10 opacity-15 rotate-12" />
      </div>
    );
  }

  const getIcon = () => {
    switch (headline.type) {
      case 'waiver':
        return <Clock className="h-4 w-4" />;
      case 'matchup':
        return <AlertCircle className="h-4 w-4" />;
      case 'streak':
        return headline.message.includes('Hot') ? 
          <TrendingUp className="h-4 w-4" /> : 
          <TrendingDown className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  const urgencyStyles = {
    high: 'from-citrus-orange to-citrus-peach',
    medium: 'from-citrus-peach to-citrus-sage',
    low: 'from-citrus-sage to-citrus-orange'
  };

  return (
    <div className={`w-full px-6 py-4 rounded-varsity mb-6 flex items-center gap-4 text-citrus-cream font-varsity font-bold text-sm md:text-base bg-gradient-to-r ${urgencyStyles[headline.urgency]} border-4 border-citrus-forest shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] corduroy-texture relative overflow-hidden group hover:-translate-y-0.5 transition-all`}>
      {/* Decorative citrus icons */}
      <CitrusWedge className="absolute top-1 right-2 w-12 h-12 opacity-15 rotate-12 group-hover:rotate-45 transition-transform" />
      <CitrusSparkle className="absolute bottom-1 left-2 w-8 h-8 opacity-10 group-hover:scale-110 transition-transform" />
      
      <div className="flex-shrink-0 w-10 h-10 rounded-varsity bg-citrus-cream/20 border-2 border-citrus-cream/40 flex items-center justify-center backdrop-blur-sm">
        {getIcon()}
      </div>
      <div className="flex-1 relative z-10 font-display font-semibold uppercase tracking-wide">
        {headline.message}
      </div>
    </div>
  );
};


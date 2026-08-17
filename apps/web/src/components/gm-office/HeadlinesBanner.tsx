import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { MatchupService } from '@/services/MatchupService';
import { getCurrentWeekNumber, getFirstWeekStartDate, getWeekStartDate, getWeekEndDate } from '@/utils/weekCalculator';
import { leagueApi } from '@/api/leagues';
import { matchupApi } from '@/api/matchups';
import { AlertCircle, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { CitrusSparkle, CitrusWedge } from '@/components/icons/CitrusIcons';
import { logger } from '@/utils/logger';

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

        // Fetch user's team and all league teams once upfront
        const { data: userTeam } = await leagueApi.getMyTeam(activeLeagueId) as { data: { id: string; team_name: string } | null };
        const { data: allTeams } = await leagueApi.getTeams(activeLeagueId) as { data: Array<{ id: string; team_name: string }> | null };
        const teamsMap = new Map<string, string>();
        (allTeams || []).forEach((t: { id: string; team_name: string }) => teamsMap.set(t.id, t.team_name));

        // 1. Check for upcoming matchup
        try {
          const draftCompletionDate = activeLeague.updated_at ? new Date(activeLeague.updated_at) : new Date();
          const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
          const currentWeek = getCurrentWeekNumber(firstWeekStart);

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

              // Check if matchup is upcoming (starts Sunday)
              if (today < weekStart) {
                const daysUntil = Math.ceil((weekStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                const opponentId = matchup.team1_id === userTeam.id ? matchup.team2_id : matchup.team1_id;

                if (opponentId) {
                  const opponentName = teamsMap.get(opponentId) || 'Opponent';
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
                  const opponentName = teamsMap.get(opponentId) || 'Opponent';
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
          logger.error('Error fetching matchup headline:', error);
        }

        // 2. Calculate team streak
        try {
          if (userTeam) {
            const record = await MatchupService.getTeamRecord(userTeam.id, activeLeagueId, user.id);

            // Get all league matchups and filter client-side for completed ones involving this team
            const { data: allMatchups } = await matchupApi.getLeagueMatchups(activeLeagueId);
            const recentMatchups = ((allMatchups || []) as any[])
              .filter((m: any) =>
                m.status === 'completed' &&
                (m.team1_id === userTeam.id || m.team2_id === userTeam.id)
              )
              .sort((a: any, b: any) => (b.week_number || 0) - (a.week_number || 0))
              .slice(0, 7);

            if (recentMatchups.length > 0) {
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
          logger.error('Error calculating streak:', error);
        }

        // 3. Waiver wire deadline — Saturday 11 PM Eastern.
        //
        // This previously read `new Date().getDay()` and `.getHours()`, which are
        // the VIEWER'S local day and hour, and then labelled the result "EST".
        // For anyone outside Eastern the countdown was wrong by their UTC offset:
        // on 2026-08-15 a Pacific viewer was told "13 hours remaining" when the
        // Eastern deadline was 10.2 hours away. Three hours of false runway on
        // the one clock in fantasy hockey that actually costs you a player.
        // It also reported whole hours only, so 10:30 read as "13 hours".
        //
        // Everything below is evaluated in America/New_York regardless of where
        // the viewer is, and the label says "ET" because the offset is EDT for
        // half the season.
        const nowNy = (() => {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour12: false,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).formatToParts(new Date());
          const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
          const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return {
            day: WD.indexOf(get('weekday')),
            // Intl can return "24" for midnight in hour12:false
            hour: Number(get('hour')) % 24,
            minute: Number(get('minute')),
          };
        })();

        const dayOfWeek = nowNy.day; // 0 = Sunday, 6 = Saturday — in Eastern
        const hours = nowNy.hour;

        if (dayOfWeek === 6 && hours < 23) {
          // Saturday before 11 PM Eastern
          const minutesUntil = (23 - hours) * 60 - nowNy.minute;
          const h = Math.floor(minutesUntil / 60);
          const m = minutesUntil % 60;
          // Round up rather than down: telling someone they have less time than
          // they do is a harmless nudge; the reverse loses them the claim.
          const remaining = h > 0 ? `${h}h ${m}m` : `${m} minutes`;
          headlines.push({
            type: 'waiver',
            message: `Waiver Wire runs tonight at 11 PM ET. ${remaining} remaining.`,
            urgency: minutesUntil <= 180 ? 'high' : 'medium',
          });
        } else if (dayOfWeek === 0 || (dayOfWeek === 6 && hours >= 23)) {
          // Sunday or Saturday after 11 PM
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
        logger.error('Error fetching headlines:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHeadlines();
  }, [user, activeLeagueId, activeLeague]);

  // Show loading state or placeholder for guests
  if (loading) {
    return (
      <div className="w-full px-6 py-4 rounded-varsity mb-6 flex items-center gap-3 text-[#E8EED9] font-varsity font-bold text-sm md:text-base animate-pulse bg-gradient-to-r from-citrus-sage to-citrus-green-medium border-4 border-citrus-forest/50 shadow-patch corduroy-texture relative overflow-hidden">
        <CitrusSparkle className="w-5 h-5 animate-pulse" />
        <div className="flex-1">Loading updates...</div>
        <CitrusWedge className="absolute top-1 right-2 w-8 h-8 opacity-20 rotate-12" />
      </div>
    );
  }

  // For guests or users without leagues, show a welcome message
  if (!user || !activeLeagueId || !headline) {
    return (
      <div className="w-full px-6 py-4 rounded-varsity mb-6 flex items-center gap-3 text-[#E8EED9] font-varsity font-bold text-sm md:text-base bg-gradient-to-r from-citrus-sage to-citrus-green-medium border-4 border-citrus-forest shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] corduroy-texture relative overflow-hidden">
        <CitrusSparkle className="w-5 h-5" />
        <div className="flex-1 font-display font-semibold">Welcome to GM's Office! Create or join a league to see personalized updates.</div>
        <CitrusWedge className="absolute top-1 right-2 w-10 h-10 opacity-15 rotate-12" />
      </div>
    );
  }

  const getIcon = () => {
    switch (headline.type) {
      case 'waiver':
        return <Clock className="h-4 w-4" aria-hidden="true" />;
      case 'matchup':
        return <AlertCircle className="h-4 w-4" aria-hidden="true" />;
      case 'streak':
        return headline.message.includes('Hot') ?
          <TrendingUp className="h-4 w-4" aria-hidden="true" /> :
          <TrendingDown className="h-4 w-4" aria-hidden="true" />;
      default:
        return <AlertCircle className="h-4 w-4" aria-hidden="true" />;
    }
  };

  const urgencyStyles = {
    high: 'from-citrus-orange to-citrus-sage', // Keep orange for high urgency alerts
    medium: 'from-citrus-sage to-citrus-green-medium',
    low: 'from-citrus-green-light to-citrus-sage'
  };

  return (
    <div className={`w-full px-6 py-4 rounded-varsity mb-6 flex items-center gap-4 text-[#E8EED9] font-varsity font-bold text-sm md:text-base bg-gradient-to-r ${urgencyStyles[headline.urgency]} border-4 border-citrus-forest shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] corduroy-texture relative overflow-hidden group hover:-translate-y-0.5 transition-all`}>
      {/* Decorative citrus icons */}
      <CitrusWedge className="absolute top-1 right-2 w-12 h-12 opacity-15 rotate-12 group-hover:rotate-45 transition-transform" />
      <CitrusSparkle className="absolute bottom-1 left-2 w-8 h-8 opacity-10 group-hover:scale-110 transition-transform" />
      
      <div className="flex-shrink-0 w-10 h-10 rounded-varsity bg-[#E8EED9]/50 backdrop-blur-sm/20 border-2 border-citrus-cream/40 flex items-center justify-center backdrop-blur-sm">
        {getIcon()}
      </div>
      <div className="flex-1 relative z-10 font-display font-semibold uppercase tracking-wide">
        {headline.message}
      </div>
    </div>
  );
};


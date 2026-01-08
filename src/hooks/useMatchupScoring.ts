/**
 * useMatchupScoring - Custom hook for matchup score calculations
 * 
 * Extracts frozen score calculation logic from Matchup.tsx
 * Uses Yahoo/Sleeper-style scoring:
 * - Past days: Frozen scores (won't change when roster changes)
 * - Today/Future: Live calculation from current roster
 * 
 * This reduces Matchup.tsx size and improves maintainability
 */

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DataCacheService, TTL } from '@/services/DataCacheService';

interface DailyScore {
  myScore: number;
  oppScore: number;
  isLocked: boolean;
}

interface UseMatchupScoringProps {
  currentMatchup: {
    id: string;
    week_start_date: string;
    team1_id: string;
    team2_id: string;
  } | null;
  userTeamId: string | null;
  dailyStatsByDate: Map<string, Map<number, { daily_total_points: number }>>;
  myStarters: Array<{ id: string | number }>;
  opponentStarters: Array<{ id: string | number }>;
}

interface UseMatchupScoringResult {
  cachedDailyScores: Map<string, DailyScore>;
  myTeamPoints: string;
  opponentTeamPoints: string;
  isLoading: boolean;
}

export function useMatchupScoring({
  currentMatchup,
  userTeamId,
  dailyStatsByDate,
  myStarters,
  opponentStarters
}: UseMatchupScoringProps): UseMatchupScoringResult {
  const [cachedDailyScores, setCachedDailyScores] = useState<Map<string, DailyScore>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Fetch and cache frozen scores for past days
  useEffect(() => {
    const fetchCachedScores = async () => {
      if (!currentMatchup || !userTeamId || dailyStatsByDate.size === 0) {
        return;
      }
      
      setIsLoading(true);
      const cacheKey = DataCacheService.getCacheKey.frozenScores(currentMatchup.id);
      
      // Check cache first
      const cachedData = DataCacheService.get<Map<string, DailyScore>>(cacheKey);
      if (cachedData) {
        setCachedDailyScores(cachedData);
        setIsLoading(false);
        return;
      }
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const weekStart = new Date(currentMatchup.week_start_date);
      
      // Build list of past dates
      const pastDates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        date.setHours(0, 0, 0, 0);
        if (date < today) {
          pastDates.push(date.toISOString().split('T')[0]);
        }
      }
      
      if (pastDates.length === 0) {
        setCachedDailyScores(new Map());
        setIsLoading(false);
        return;
      }
      
      const oppTeamId = currentMatchup.team1_id === userTeamId 
        ? currentMatchup.team2_id 
        : currentMatchup.team1_id;
      
      // Single batched query for all past days
      const { data: allRosters, error } = await supabase
        .from('fantasy_daily_rosters')
        .select('player_id, roster_date, team_id')
        .eq('matchup_id', currentMatchup.id)
        .in('team_id', oppTeamId ? [userTeamId, oppTeamId] : [userTeamId])
        .in('roster_date', pastDates)
        .eq('slot_type', 'active');
      
      if (error) {
        console.error('[useMatchupScoring] Error fetching rosters:', error);
        setIsLoading(false);
        return;
      }
      
      // Group rosters by date and team
      const rostersByDateTeam = new Map<string, Map<string, number[]>>();
      allRosters?.forEach(r => {
        if (!rostersByDateTeam.has(r.roster_date)) {
          rostersByDateTeam.set(r.roster_date, new Map());
        }
        const dateMap = rostersByDateTeam.get(r.roster_date)!;
        if (!dateMap.has(r.team_id)) {
          dateMap.set(r.team_id, []);
        }
        dateMap.get(r.team_id)!.push(parseInt(r.player_id));
      });
      
      // Calculate scores
      const scores = new Map<string, DailyScore>();
      
      for (const dateStr of pastDates) {
        const dayStats = dailyStatsByDate.get(dateStr);
        const dateRosters = rostersByDateTeam.get(dateStr);
        
        let myScore = 0;
        let oppScore = 0;
        
        if (dayStats && dateRosters) {
          const myPlayerIds = dateRosters.get(userTeamId) || [];
          myPlayerIds.forEach(playerId => {
            myScore += dayStats.get(playerId)?.daily_total_points ?? 0;
          });
          
          if (oppTeamId) {
            const oppPlayerIds = dateRosters.get(oppTeamId) || [];
            oppPlayerIds.forEach(playerId => {
              oppScore += dayStats.get(playerId)?.daily_total_points ?? 0;
            });
          }
        }
        
        scores.set(dateStr, { myScore, oppScore, isLocked: true });
      }
      
      DataCacheService.set(cacheKey, scores, TTL.VERY_LONG);
      setCachedDailyScores(scores);
      setIsLoading(false);
    };
    
    fetchCachedScores();
  }, [currentMatchup?.id, userTeamId, dailyStatsByDate, currentMatchup?.team1_id, currentMatchup?.team2_id]);

  // Calculate my team's total points
  const myTeamPoints = useMemo(() => {
    if (!currentMatchup || dailyStatsByDate.size === 0) {
      const fallback = myStarters.reduce((sum, player) => sum + 0, 0);
      return fallback.toFixed(1);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(currentMatchup.week_start_date);
    let total = 0;
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      date.setHours(0, 0, 0, 0);
      const dateStr = date.toISOString().split('T')[0];
      const isPast = date < today;
      
      const cachedScore = cachedDailyScores.get(dateStr);
      
      if (isPast && cachedScore?.isLocked) {
        total += cachedScore.myScore;
      } else {
        const dayStats = dailyStatsByDate.get(dateStr);
        if (dayStats) {
          const dayTotal = myStarters.reduce((sum, player) => {
            const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
            return sum + (dayStats.get(playerId)?.daily_total_points ?? 0);
          }, 0);
          total += dayTotal;
        }
      }
    }
    
    return total.toFixed(1);
  }, [currentMatchup, dailyStatsByDate, myStarters, cachedDailyScores]);

  // Calculate opponent's total points
  const opponentTeamPoints = useMemo(() => {
    if (!currentMatchup || dailyStatsByDate.size === 0) {
      return "0.0";
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(currentMatchup.week_start_date);
    let total = 0;
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      date.setHours(0, 0, 0, 0);
      const dateStr = date.toISOString().split('T')[0];
      const isPast = date < today;
      
      const cachedScore = cachedDailyScores.get(dateStr);
      
      if (isPast && cachedScore?.isLocked) {
        total += cachedScore.oppScore;
      } else {
        const dayStats = dailyStatsByDate.get(dateStr);
        if (dayStats) {
          const dayTotal = opponentStarters.reduce((sum, player) => {
            const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
            return sum + (dayStats.get(playerId)?.daily_total_points ?? 0);
          }, 0);
          total += dayTotal;
        }
      }
    }
    
    return total.toFixed(1);
  }, [currentMatchup, dailyStatsByDate, opponentStarters, cachedDailyScores]);

  return {
    cachedDailyScores,
    myTeamPoints,
    opponentTeamPoints,
    isLoading
  };
}


import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { PlayerService, Player } from '@/services/PlayerService';
import { LeagueService } from '@/services/LeagueService';
import { Loader2 } from 'lucide-react';
import { COLUMNS } from '@/utils/queryColumns';

interface PositionDepth {
  position: string;
  count: number;
  strength: 'Excellent' | 'Good' | 'Average' | 'Weak';
  color: string;
}

// Normalize position (L -> LW, R -> RW)
const normalizePosition = (pos: string): string => {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  if (upper.includes('C') && !upper.includes('LW') && !upper.includes('RW')) return 'C';
  if (upper.includes('D')) return 'D';
  if (upper.includes('G')) return 'G';
  return '';
};

// Calculate depth strength based on player count
const calculateStrength = (position: string, count: number): 'Excellent' | 'Good' | 'Average' | 'Weak' => {
  // Ideal depth: 2 starters + 1-2 bench = 3-4 players
  // Excellent: 4+ players
  // Good: 3 players
  // Average: 2 players
  // Weak: <2 players
  
  if (position === 'G') {
    // Goalies need 2 starters, so ideal is 2-3
    if (count >= 3) return 'Excellent';
    if (count === 2) return 'Good';
    if (count === 1) return 'Average';
    return 'Weak';
  } else if (position === 'D') {
    // Defense needs 4 starters, so ideal is 5-6
    if (count >= 6) return 'Excellent';
    if (count >= 5) return 'Good';
    if (count >= 4) return 'Average';
    return 'Weak';
  } else {
    // Forwards (C, LW, RW) need 2 starters each, so ideal is 3-4
    if (count >= 4) return 'Excellent';
    if (count === 3) return 'Good';
    if (count === 2) return 'Average';
    return 'Weak';
  }
};

// Get position color
const getPositionColor = (position: string, strength: string): string => {
  const baseColors: Record<string, string> = {
    'C': '#F9E076',   // Bright Lemon Peel
    'LW': '#459345',  // Deep Lime Green
    'RW': '#F9A436',  // Zesty Tangerine
    'D': '#A8D85C',   // Yellow-Green
    'G': '#FF6F80'    // Contrast Grapefruit Pink
  };
  
  const color = baseColors[position] || '#94A3B8';
  
  // If weak, use Grapefruit Ruby Red to flag it
  if (strength === 'Weak') {
    return '#FF6F80';
  }
  
  return color;
};

export const RosterDepthWidget = () => {
  const { user } = useAuth();
  const { activeLeagueId, userLeagueState, activeLeague } = useLeague();
  const [loading, setLoading] = useState(true);
  const [depths, setDepths] = useState<PositionDepth[]>([]);

  useEffect(() => {
    if (!user || !activeLeagueId || userLeagueState !== 'active-user') {
      setLoading(false);
      return;
    }

    const fetchRosterDepth = async () => {
      try {
        setLoading(true);

        // Get user's team
        const { data: userTeam, error: teamError } = await supabase
          .from('teams')
          .select('id, league_id')
          .eq('league_id', activeLeagueId)
          .eq('owner_id', user.id)
          .maybeSingle();

        if (teamError || !userTeam) {
          setLoading(false);
          return;
        }

        // Check if draft is completed
        if (!activeLeague || activeLeague.draft_status !== 'completed') {
          setLoading(false);
          return;
        }

        // Get all players
        const allPlayers = await PlayerService.getAllPlayers();

        // Get roster from draft_picks (same approach as Roster.tsx)
        const { data: allDraftPicks, error: picksError } = await supabase
          .from('draft_picks')
          .select(COLUMNS.DRAFT_PICK)
          .eq('league_id', activeLeagueId)
          .eq('team_id', userTeam.id)
          .is('deleted_at', null)
          .order('pick_number', { ascending: true });

        let rosterPlayers: Player[] = [];

        if (picksError) {
          console.error('Error fetching draft picks:', picksError);
          // Fallback: try using DraftService
          try {
            const { DraftService } = await import('@/services/DraftService');
            const { picks: draftPicks } = await DraftService.getDraftPicks(activeLeagueId);
            const teamPicks = draftPicks.filter(p => p.team_id === userTeam.id);
            const playerIds = teamPicks.map(p => p.player_id);
            rosterPlayers = allPlayers.filter(p => playerIds.includes(p.id));
          } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
            setLoading(false);
            return;
          }
        } else {
          if (!allDraftPicks || allDraftPicks.length === 0) {
            setLoading(false);
            return;
          }

          // Get player IDs from draft picks
          const playerIds = allDraftPicks.map(p => p.player_id);

          // Filter players by roster IDs
          rosterPlayers = allPlayers.filter(p => playerIds.includes(p.id));
        }

        if (rosterPlayers.length === 0) {
          setLoading(false);
          return;
        }

        // Count players by position
        const positionCounts: Record<string, number> = {
          'C': 0,
          'LW': 0,
          'RW': 0,
          'D': 0,
          'G': 0
        };

        rosterPlayers.forEach(player => {
          const pos = normalizePosition(player.position);
          if (pos && positionCounts.hasOwnProperty(pos)) {
            positionCounts[pos]++;
          }
        });

        // Calculate depth for each position
        const positionDepths: PositionDepth[] = ['C', 'LW', 'RW', 'D', 'G'].map(pos => {
          const count = positionCounts[pos] || 0;
          const strength = calculateStrength(pos, count);
          const color = getPositionColor(pos, strength);
          
          return {
            position: pos,
            count,
            strength,
            color
          };
        });

        setDepths(positionDepths);
      } catch (error) {
        console.error('Error calculating roster depth:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRosterDepth();
  }, [user, activeLeagueId, userLeagueState, activeLeague]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Roster Depth</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show placeholder for guests or users without leagues
  if (!user || userLeagueState !== 'active-user') {
    return (
      <Card className="h-full opacity-60">
        <CardHeader>
          <CardTitle className="text-lg">Roster Depth</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-sm text-muted-foreground">
            Join a league to see your roster depth
          </div>
        </CardContent>
      </Card>
    );
  }

  if (depths.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg">Roster Depth</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-sm text-muted-foreground">
            No roster data available
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStrengthBarWidth = (strength: string): string => {
    switch (strength) {
      case 'Excellent': return '100%';
      case 'Good': return '75%';
      case 'Average': return '50%';
      case 'Weak': return '25%';
      default: return '0%';
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg">Roster Depth</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {depths.map((depth) => (
          <div key={depth.position} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: depth.color }}
                />
                <span className="font-medium">{depth.position}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {depth.count} player{depth.count !== 1 ? 's' : ''}
                </span>
                <span
                  className={`text-xs font-semibold ${
                    depth.strength === 'Weak' ? 'text-[#FF6F80]' :
                    depth.strength === 'Excellent' ? 'text-[#459345]' :
                    depth.strength === 'Good' ? 'text-[#F9A436]' :
                    'text-muted-foreground'
                  }`}
                >
                  {depth.strength}
                </span>
              </div>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: getStrengthBarWidth(depth.strength),
                  backgroundColor: depth.color,
                  opacity: 0.7
                }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};


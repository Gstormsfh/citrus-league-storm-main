import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlayerService, Player } from '@/services/PlayerService';

export interface PlayerNewsItem {
  player_id: number;
  player_name: string;
  team: string;
  position: string;
  roster_status: string;
  is_ir_eligible: boolean;
  updated_at: string;
  last_updated: string; // Formatted timestamp
}

/**
 * Hook for real-time player news feed (roster status updates)
 * Subscribes to player_talent_metrics table changes
 * Caches data locally to prevent excessive egress
 */
export function usePlayerNews(
  rosterPlayerIds: string[],
  enabled: boolean = true
) {
  const [newsItems, setNewsItems] = useState<PlayerNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const subscriptionRef = useRef<(() => void) | null>(null);
  const cacheRef = useRef<Map<number, PlayerNewsItem>>(new Map());
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch initial player news data
  const fetchPlayerNews = useCallback(async () => {
    if (!enabled || rosterPlayerIds.length === 0) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Get roster status for all roster players
      const playerIds = rosterPlayerIds.map(id => parseInt(id)).filter(id => !isNaN(id));
      
      if (playerIds.length === 0) {
        setNewsItems([]);
        setLoading(false);
        return;
      }

      const { data: metrics, error } = await supabase
        .from('player_talent_metrics')
        .select('player_id, roster_status, is_ir_eligible, roster_status_updated_at')
        .eq('season', 2025)
        .in('player_id', playerIds);

      if (error) {
        console.error('Error fetching player news:', error);
        setLoading(false);
        return;
      }

      // Get player details from PlayerService
      const allPlayers = await PlayerService.getAllPlayers();
      const playerMap = new Map(allPlayers.map(p => [Number(p.id), p]));

      // Build news items
      const items: PlayerNewsItem[] = (metrics || [])
        .filter(m => m.roster_status) // Only include players with status
        .map(metric => {
          const player = playerMap.get(metric.player_id);
          if (!player) return null;

          const updatedAt = metric.roster_status_updated_at 
            ? new Date(metric.roster_status_updated_at)
            : new Date();

          // Format timestamp
          const now = new Date();
          const diffMs = now.getTime() - updatedAt.getTime();
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          const diffDays = Math.floor(diffHours / 24);
          
          let lastUpdated = '';
          if (diffDays > 0) {
            lastUpdated = `${diffDays}d ago`;
          } else if (diffHours > 0) {
            lastUpdated = `${diffHours}h ago`;
          } else {
            const diffMins = Math.floor(diffMs / (1000 * 60));
            lastUpdated = diffMins > 0 ? `${diffMins}m ago` : 'Just now';
          }

          return {
            player_id: metric.player_id,
            player_name: player.full_name,
            team: player.team,
            position: player.position,
            roster_status: metric.roster_status || 'ACT',
            is_ir_eligible: metric.is_ir_eligible || false,
            updated_at: updatedAt.toISOString(),
            last_updated: lastUpdated
          };
        })
        .filter((item): item is PlayerNewsItem => item !== null)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

      // Update cache
      items.forEach(item => {
        cacheRef.current.set(item.player_id, item);
      });

      setNewsItems(items);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error in fetchPlayerNews:', error);
    } finally {
      setLoading(false);
    }
  }, [enabled, rosterPlayerIds]);

  // Manual refresh function
  const refreshNews = useCallback(() => {
    fetchPlayerNews();
  }, [fetchPlayerNews]);

  // Set up real-time subscription
  useEffect(() => {
    if (!enabled || rosterPlayerIds.length === 0) {
      return;
    }

    // Fetch initial data
    fetchPlayerNews();

    // Subscribe to roster_status changes
    const playerIds = rosterPlayerIds.map(id => parseInt(id)).filter(id => !isNaN(id));
    
    if (playerIds.length === 0) {
      return;
    }

    // Create subscription for roster_status updates
    // Only listen to UPDATE events on roster_status column
    const channel = supabase
      .channel(`player_news:${playerIds.join(',')}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'player_talent_metrics',
          filter: `season=eq.2025`,
        },
        (payload) => {
          // Debounce rapid updates
          if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
          }

          debounceTimeoutRef.current = setTimeout(() => {
            // Check if this update affects one of our roster players
            const updatedPlayerId = (payload.new as { player_id?: string })?.player_id;
            if (playerIds.includes(updatedPlayerId)) {
              // Refresh news feed
              fetchPlayerNews();
            }
          }, 300); // 300ms debounce
        }
      )
      .subscribe();

    subscriptionRef.current = () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      supabase.removeChannel(channel);
    };

    // Cleanup on unmount
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current();
        subscriptionRef.current = null;
      }
    };
  }, [enabled, rosterPlayerIds, fetchPlayerNews]);

  return {
    newsItems,
    loading,
    lastRefresh,
    refreshNews
  };
}

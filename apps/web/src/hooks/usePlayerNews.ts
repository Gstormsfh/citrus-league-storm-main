import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlayerService } from '@/services/PlayerService';
import { getCurrentSeason } from '@/utils/seasonConstants';
import { logger } from '@/utils/logger';

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
 * Hook for real-time player news feed (roster status updates).
 * Uses PlayerService (API server) for data, Supabase realtime for live updates.
 */
export function usePlayerNews(
  rosterPlayerIds: string[],
  enabled: boolean = true
) {
  const [newsItems, setNewsItems] = useState<PlayerNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const subscriptionRef = useRef<(() => void) | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cacheRef = useRef<Map<number, PlayerNewsItem>>(new Map());

  // Fetch player news from PlayerService (API server, 3-tier)
  const fetchPlayerNews = useCallback(async () => {
    if (!enabled || rosterPlayerIds.length === 0) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const playerIds = rosterPlayerIds.filter(id => !isNaN(parseInt(id)));
      if (playerIds.length === 0) {
        setNewsItems([]);
        setLoading(false);
        return;
      }

      // Get player data from API server (includes roster_status and is_ir_eligible)
      const players = await PlayerService.getPlayersByIds(playerIds);

      const now = new Date();
      const items: PlayerNewsItem[] = players
        .filter(p => p.roster_status) // Only include players with a roster status
        .map(player => {
          return {
            player_id: Number(player.id),
            player_name: player.full_name,
            team: player.team,
            position: player.position,
            roster_status: player.roster_status || 'ACT',
            is_ir_eligible: player.is_ir_eligible || false,
            updated_at: now.toISOString(),
            last_updated: 'Recently',
          };
        });

      // Update cache
      items.forEach(item => {
        cacheRef.current.set(item.player_id, item);
      });

      setNewsItems(items);
      setLastRefresh(new Date());
    } catch (error) {
      logger.error('Error in fetchPlayerNews:', error);
    } finally {
      setLoading(false);
    }
  }, [enabled, rosterPlayerIds]);

  // Manual refresh function
  const refreshNews = useCallback(() => {
    fetchPlayerNews();
  }, [fetchPlayerNews]);

  // Set up real-time subscription (acceptable client-side Supabase usage)
  useEffect(() => {
    if (!enabled || rosterPlayerIds.length === 0) {
      return;
    }

    // Fetch initial data
    fetchPlayerNews();

    const playerIds = rosterPlayerIds.map(id => parseInt(id)).filter(id => !isNaN(id));
    if (playerIds.length === 0) {
      return;
    }

    // Subscribe to roster_status changes (realtime is acceptable client-side)
    const channel = supabase
      .channel(`player_news:${playerIds.join(',')}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'player_talent_metrics',
          filter: `season=eq.${getCurrentSeason()}`,
        },
        (payload) => {
          if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
          }

          debounceTimeoutRef.current = setTimeout(() => {
            const updatedPlayerId = Number((payload.new as { player_id?: string })?.player_id);
            if (!isNaN(updatedPlayerId) && playerIds.includes(updatedPlayerId)) {
              fetchPlayerNews();
            }
          }, 300);
        }
      )
      .subscribe();

    subscriptionRef.current = () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      supabase.removeChannel(channel);
    };

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

/**
 * PlayerNameService - Fast lookup service for player names from our own data scrapes
 * 
 * This service replaces staging file dependencies by using the player_names table
 * which is populated from our own NHL API scrapes.
 */

import { supabase } from "@/integrations/supabase/client";

interface PlayerName {
  player_id: number;
  full_name: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
  jersey_number?: number;
  is_active?: boolean;
  headshot_url?: string;
}

// In-memory cache for player names
let playerNamesCache: Map<number, PlayerName> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load all player names from database into cache
 */
async function loadPlayerNamesCache(): Promise<void> {
  const now = Date.now();
  
  // Return cached data if still valid
  if (playerNamesCache && (now - cacheTimestamp) < CACHE_TTL) {
    return;
  }
  
  try {
    const { data, error } = await supabase
      .from('player_names')
      .select('*');
    
    if (error) throw error;
    
    // Build cache map
    playerNamesCache = new Map();
    if (data) {
      for (const player of data) {
        playerNamesCache.set(player.player_id, player);
      }
    }
    
    cacheTimestamp = now;
  } catch (error) {
    console.error('Error loading player names cache:', error);
    playerNamesCache = new Map(); // Empty cache on error
  }
}

/**
 * Get player name by player ID (fast lookup from cache)
 */
export async function getPlayerName(playerId: number | string | null | undefined): Promise<string | null> {
  if (!playerId) return null;
  
  const id = typeof playerId === 'string' ? parseInt(playerId, 10) : playerId;
  if (isNaN(id)) return null;
  
  // Ensure cache is loaded
  await loadPlayerNamesCache();
  
  const player = playerNamesCache?.get(id);
  return player?.full_name || null;
}

/**
 * Get full player name record by player ID
 */
export async function getPlayerNameRecord(playerId: number | string | null | undefined): Promise<PlayerName | null> {
  if (!playerId) return null;
  
  const id = typeof playerId === 'string' ? parseInt(playerId, 10) : playerId;
  if (isNaN(id)) return null;
  
  // Ensure cache is loaded
  await loadPlayerNamesCache();
  
  return playerNamesCache?.get(id) || null;
}

/**
 * Get multiple player names at once (batch lookup)
 */
export async function getPlayerNames(playerIds: (number | string | null | undefined)[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  
  // Ensure cache is loaded
  await loadPlayerNamesCache();
  
  for (const playerId of playerIds) {
    if (!playerId) continue;
    
    const id = typeof playerId === 'string' ? parseInt(playerId, 10) : playerId;
    if (isNaN(id)) continue;
    
    const player = playerNamesCache?.get(id);
    if (player?.full_name) {
      result.set(id, player.full_name);
    }
  }
  
  return result;
}

/**
 * Clear the cache (call this when player names are updated)
 */
export function clearPlayerNamesCache(): void {
  playerNamesCache = null;
  cacheTimestamp = 0;
}

/**
 * Get all player names (for debugging or bulk operations)
 */
export async function getAllPlayerNames(): Promise<Map<number, PlayerName>> {
  await loadPlayerNamesCache();
  return playerNamesCache || new Map();
}


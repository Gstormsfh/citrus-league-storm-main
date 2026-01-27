/**
 * Test utility to check demo league state
 * Run this in browser console: window.testDemoLeague()
 */

import { supabase } from '@/integrations/supabase/client';
import { DEMO_LEAGUE_ID } from '@/services/DemoLeagueService';
import { logger } from '@/utils/logger';

export const testDemoLeague = async () => {
  logger.debug('=== Testing Demo League ===');
  
  // Check if league exists
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', DEMO_LEAGUE_ID)
    .single();
  
  logger.debug('League:', league ? 'EXISTS' : 'NOT FOUND', leagueError);
  
  // Check teams
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, team_name')
    .eq('league_id', DEMO_LEAGUE_ID);
  
  logger.debug(`Teams: ${teams?.length || 0} found`, teamsError);
  if (teams && teams.length > 0) {
    logger.debug('Team IDs:', teams.map(t => t.id));
  }
  
  // Check draft picks
  const { data: picks, error: picksError } = await supabase
    .from('draft_picks')
    .select('*')
    .eq('league_id', DEMO_LEAGUE_ID)
    .is('deleted_at', null)
    .limit(10);
  
  logger.debug(`Draft Picks: ${picks?.length || 0} found (showing first 10)`, picksError);
  if (picks && picks.length > 0) {
    logger.debug('Sample picks:', picks.slice(0, 3));
  }
  
  // Check lineups
  const { data: lineups, error: lineupsError } = await supabase
    .from('team_lineups')
    .select('team_id, starters, bench')
    .eq('league_id', DEMO_LEAGUE_ID)
    .limit(5);
  
  logger.debug(`Lineups: ${lineups?.length || 0} found`, lineupsError);
  
  return { league, teams, picks: picks?.length || 0, lineups: lineups?.length || 0 };
};

// Expose globally (only in dev mode)
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).testDemoLeague = testDemoLeague;
  console.debug('Test function available: window.testDemoLeague()');
}


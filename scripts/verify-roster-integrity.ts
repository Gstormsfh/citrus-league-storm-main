/**
 * Roster Integrity Verification Script
 * 
 * Checks that all players in team_lineups exist in fantasy_daily_rosters for today/future
 * Auto-fixes any missing players by re-syncing
 * 
 * Usage: npx tsx scripts/verify-roster-integrity.ts [league_id]
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

const supabase = createClient(supabaseUrl, supabaseKey);

interface TeamLineup {
  team_id: string;
  league_id: string;
  starters: string[];
  bench: string[];
  ir: string[];
}

async function verifyRosterIntegrity(leagueId?: string) {
  console.log('🔍 Starting roster integrity check...');
  console.log('League ID:', leagueId || 'ALL LEAGUES');
  console.log('Date:', new Date().toISOString().split('T')[0]);
  console.log('');
  
  try {
    // Get all team lineups (optionally filtered by league)
    let query = supabase
      .from('team_lineups')
      .select('team_id, league_id, starters, bench, ir');
    
    if (leagueId) {
      query = query.eq('league_id', leagueId);
    }
    
    const { data: lineups, error: lineupsError } = await query;
    
    if (lineupsError) {
      console.error('❌ Error fetching team lineups:', lineupsError);
      return;
    }
    
    if (!lineups || lineups.length === 0) {
      console.log('⚠️  No team lineups found');
      return;
    }
    
    console.log(`✅ Found ${lineups.length} team lineups to verify`);
    console.log('');
    
    let totalChecked = 0;
    let totalMissing = 0;
    let totalFixed = 0;
    const today = new Date().toISOString().split('T')[0];
    
    for (const lineup of lineups as TeamLineup[]) {
      const allPlayers = [
        ...(lineup.starters || []),
        ...(lineup.bench || []),
        ...(lineup.ir || [])
      ];
      
      if (allPlayers.length === 0) {
        console.log(`⚠️  Team ${lineup.team_id}: No players in lineup`);
        continue;
      }
      
      console.log(`Checking team ${lineup.team_id}: ${allPlayers.length} players`);
      
      for (const playerId of allPlayers) {
        totalChecked++;
        
        // Check if player exists in fantasy_daily_rosters for today
        const { count, error } = await supabase
          .from('fantasy_daily_rosters')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', lineup.team_id)
          .eq('player_id', parseInt(playerId))
          .eq('roster_date', today);
        
        if (error) {
          console.error(`  ❌ Error checking player ${playerId}:`, error);
          continue;
        }
        
        if (count === 0) {
          totalMissing++;
          console.log(`  ⚠️  MISSING: Player ${playerId} not in fantasy_daily_rosters for today`);
          
          // Auto-fix: Find matchup and re-insert
          const { data: matchup } = await supabase
            .from('matchups')
            .select('id, week_start_date, week_end_date')
            .eq('league_id', lineup.league_id)
            .or(`team1_id.eq.${lineup.team_id},team2_id.eq.${lineup.team_id}`)
            .lte('week_start_date', today)
            .gte('week_end_date', today)
            .single();
          
          if (!matchup) {
            console.log(`    ❌ No matchup found for team ${lineup.team_id} on ${today}`);
            continue;
          }
          
          // Determine slot type
          let slotType = 'bench';
          let slotId = null;
          
          if (lineup.starters?.includes(playerId)) {
            slotType = 'active';
            // Get slot assignment if available
            const slotAssignments = await supabase
              .from('team_lineups')
              .select('slot_assignments')
              .eq('team_id', lineup.team_id)
              .eq('league_id', lineup.league_id)
              .single();
            slotId = slotAssignments.data?.slot_assignments?.[playerId] || null;
          } else if (lineup.ir?.includes(playerId)) {
            slotType = 'ir';
            const slotAssignments = await supabase
              .from('team_lineups')
              .select('slot_assignments')
              .eq('team_id', lineup.team_id)
              .eq('league_id', lineup.league_id)
              .single();
            slotId = slotAssignments.data?.slot_assignments?.[playerId] || null;
          }
          
          // Insert for today and future dates in this matchup week
          const { error: insertError } = await supabase
            .from('fantasy_daily_rosters')
            .upsert({
              league_id: lineup.league_id,
              team_id: lineup.team_id,
              matchup_id: matchup.id,
              player_id: parseInt(playerId),
              roster_date: today,
              slot_type: slotType,
              slot_id: slotId,
              is_locked: false
            }, {
              onConflict: 'team_id,matchup_id,player_id,roster_date'
            });
          
          if (insertError) {
            console.error(`    ❌ Failed to insert player ${playerId}:`, insertError);
          } else {
            totalFixed++;
            console.log(`    ✅ FIXED: Added player ${playerId} to fantasy_daily_rosters`);
          }
        }
      }
    }
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('ROSTER INTEGRITY CHECK COMPLETE');
    console.log('');
    console.log(`Total players checked: ${totalChecked}`);
    console.log(`Missing players found: ${totalMissing}`);
    console.log(`Players fixed: ${totalFixed}`);
    console.log('');
    
    if (totalMissing === 0) {
      console.log('✅ All rosters are in sync!');
    } else if (totalFixed === totalMissing) {
      console.log('✅ All missing players have been restored!');
    } else {
      console.log('⚠️  Some players could not be restored. Check errors above.');
    }
    console.log('═══════════════════════════════════════════════════════════════');
    
  } catch (error) {
    console.error('❌ Fatal error during integrity check:', error);
  }
}

// Run the check
const leagueId = process.argv[2];
verifyRosterIntegrity(leagueId);

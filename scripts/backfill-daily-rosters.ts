/**
 * Backfill script for daily rosters
 * Run this to ensure all leagues have complete fantasy_daily_rosters data
 */

import { createClient } from '@supabase/supabase-js';

// Read from environment variables (set these before running)
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials. Check .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillMissingDailyRosters(
  teamId: string,
  leagueId: string,
  matchupId: string
): Promise<{ backfilledCount: number; error: any }> {
  try {
    console.log(`[Backfill] Starting for team: ${teamId}, matchup: ${matchupId}`);
    
    // Get matchup dates
    const { data: matchup, error: matchupError } = await supabase
      .from('matchups')
      .select('id, week_start_date, week_end_date')
      .eq('id', matchupId)
      .single();
    
    if (matchupError || !matchup) {
      console.error(`[Backfill] Matchup not found: ${matchupError}`);
      return { backfilledCount: 0, error: matchupError };
    }
    
    // Get current lineup for this team
    const { data: savedLineup, error: lineupError } = await supabase
      .from('team_lineups')
      .select('starters, bench, ir, slot_assignments')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (lineupError) {
      console.error(`[Backfill] Error fetching lineup: ${lineupError}`);
      return { backfilledCount: 0, error: lineupError };
    }
    
    if (!savedLineup || !savedLineup.starters) {
      console.log(`[Backfill] No saved lineup found for team ${teamId}, skipping`);
      return { backfilledCount: 0, error: null };
    }
    
    // Generate all dates in the matchup week
    const weekStart = new Date(matchup.week_start_date);
    const weekEnd = new Date(matchup.week_end_date);
    const weekDates: string[] = [];
    let currentDate = new Date(weekStart);
    while (currentDate <= weekEnd) {
      weekDates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Check which dates already have records
    const { data: existingRecords } = await supabase
      .from('fantasy_daily_rosters')
      .select('roster_date, player_id')
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId);
    
    const existingKeys = new Set(
      (existingRecords || []).map(r => `${r.player_id}_${r.roster_date}`)
    );
    
    console.log(`[Backfill] Found ${existingKeys.size} existing records`);
    
    // Create records for missing days
    const recordsToInsert: any[] = [];
    
    for (const dateStr of weekDates) {
      // Add starters
      for (const playerId of savedLineup.starters) {
        const key = `${playerId}_${dateStr}`;
        if (!existingKeys.has(key)) {
          recordsToInsert.push({
            league_id: leagueId,
            team_id: teamId,
            matchup_id: matchupId,
            player_id: parseInt(playerId),
            roster_date: dateStr,
            slot_type: 'active',
            slot_id: savedLineup.slot_assignments?.[playerId] || null,
            is_locked: true,
            locked_at: new Date().toISOString()
          });
        }
      }
      
      // Add bench
      for (const playerId of savedLineup.bench || []) {
        const key = `${playerId}_${dateStr}`;
        if (!existingKeys.has(key)) {
          recordsToInsert.push({
            league_id: leagueId,
            team_id: teamId,
            matchup_id: matchupId,
            player_id: parseInt(playerId),
            roster_date: dateStr,
            slot_type: 'bench',
            slot_id: null,
            is_locked: true,
            locked_at: new Date().toISOString()
          });
        }
      }
      
      // Add IR
      for (const playerId of savedLineup.ir || []) {
        const key = `${playerId}_${dateStr}`;
        if (!existingKeys.has(key)) {
          recordsToInsert.push({
            league_id: leagueId,
            team_id: teamId,
            matchup_id: matchupId,
            player_id: parseInt(playerId),
            roster_date: dateStr,
            slot_type: 'ir',
            slot_id: savedLineup.slot_assignments?.[playerId] || null,
            is_locked: true,
            locked_at: new Date().toISOString()
          });
        }
      }
    }
    
    console.log(`[Backfill] Will insert ${recordsToInsert.length} missing records`);
    
    if (recordsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('fantasy_daily_rosters')
        .upsert(recordsToInsert, {
          onConflict: 'team_id,matchup_id,player_id,roster_date',
          ignoreDuplicates: true
        });
      
      if (insertError) {
        console.error(`[Backfill] Error inserting records: ${insertError}`);
        return { backfilledCount: 0, error: insertError };
      }
      
      console.log(`[Backfill] Successfully backfilled ${recordsToInsert.length} records`);
    }
    
    return { backfilledCount: recordsToInsert.length, error: null };
  } catch (error) {
    console.error(`[Backfill] Exception:`, error);
    return { backfilledCount: 0, error };
  }
}

async function main() {
  console.log('========================================');
  console.log('🚀 Starting Daily Rosters Backfill 🚀');
  console.log('========================================\n');
  
  // Get all leagues
  const { data: leagues, error: leaguesError } = await supabase
    .from('leagues')
    .select('id, name');
  
  if (leaguesError) {
    console.error('Error fetching leagues:', leaguesError);
    process.exit(1);
  }
  
  if (!leagues || leagues.length === 0) {
    console.log('No leagues found in database.');
    process.exit(0);
  }
  
  console.log(`Found ${leagues.length} league(s):`);
  leagues.forEach(l => console.log(`  - ${l.name} (${l.id})`));
  console.log('');
  
  let totalBackfilled = 0;
  
  for (const league of leagues) {
    console.log(`\n📋 Processing league: ${league.name} (${league.id})`);
    console.log('─'.repeat(50));
    
    // Get all matchups for this league
    const { data: matchups, error: matchupsError } = await supabase
      .from('matchups')
      .select('id, team1_id, team2_id, week_start_date, week_end_date')
      .eq('league_id', league.id);
    
    if (matchupsError) {
      console.error(`Error fetching matchups: ${matchupsError}`);
      continue;
    }
    
    if (!matchups || matchups.length === 0) {
      console.log(`No matchups found for league ${league.name}`);
      continue;
    }
    
    console.log(`Found ${matchups.length} matchup(s)`);
    
    for (const matchup of matchups) {
      console.log(`\n  🔄 Matchup ${matchup.id} (${matchup.week_start_date} to ${matchup.week_end_date})`);
      
      // Backfill team1
      if (matchup.team1_id) {
        const result1 = await backfillMissingDailyRosters(
          matchup.team1_id,
          league.id,
          matchup.id
        );
        totalBackfilled += result1.backfilledCount;
        if (result1.error) {
          console.error(`  ❌ Team1 backfill error: ${result1.error}`);
        } else if (result1.backfilledCount > 0) {
          console.log(`  ✅ Team1: ${result1.backfilledCount} records backfilled`);
        } else {
          console.log(`  ✓ Team1: All records exist`);
        }
      }
      
      // Backfill team2
      if (matchup.team2_id) {
        const result2 = await backfillMissingDailyRosters(
          matchup.team2_id,
          league.id,
          matchup.id
        );
        totalBackfilled += result2.backfilledCount;
        if (result2.error) {
          console.error(`  ❌ Team2 backfill error: ${result2.error}`);
        } else if (result2.backfilledCount > 0) {
          console.log(`  ✅ Team2: ${result2.backfilledCount} records backfilled`);
        } else {
          console.log(`  ✓ Team2: All records exist`);
        }
      }
    }
  }
  
  console.log('\n========================================');
  console.log(`✅ Backfill Complete!`);
  console.log(`   Total records backfilled: ${totalBackfilled}`);
  console.log('========================================');
}

main().catch(console.error);


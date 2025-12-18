
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/integrations/supabase/types';

// Configuration
const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
  }
});

const TEAMS = [
  "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", 
  "EDM", "FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT", 
  "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", 
  "WPG", "WSH"
];

// Helper to pause execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchTeamRoster(teamAbbrev: string) {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`);
    if (!response.ok) {
      console.error(`Failed to fetch roster for ${teamAbbrev}: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    // Roster data is structured by position categories: forwards, defensemen, goalies
    const allPlayers = [
      ...(data.forwards || []),
      ...(data.defensemen || []),
      ...(data.goalies || [])
    ];
    return allPlayers;
  } catch (error) {
    console.error(`Error fetching roster for ${teamAbbrev}:`, error);
    return [];
  }
}

async function fetchPlayerDetails(playerId: number) {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/player/${playerId}/landing`);
    if (!response.ok) {
      console.error(`Failed to fetch details for player ${playerId}: ${response.statusText}`);
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching details for player ${playerId}:`, error);
    return null;
  }
}

async function main() {
  console.log('Starting NHL player import...');
  
  let totalProcessed = 0;
  let totalErrors = 0;

  for (const team of TEAMS) {
    console.log(`Processing team: ${team}`);
    const roster = await fetchTeamRoster(team);
    console.log(`Found ${roster.length} players for ${team}`);

    for (const rosterPlayer of roster) {
      const playerId = rosterPlayer.id; // Correct field from roster endpoint is usually 'id' or 'playerId'? Let's check.
      // Actually in the roster response: "id":8478402,"headshot":"...","firstName":...
      
      // Delay to respect rate limits
      await sleep(200);

      const details = await fetchPlayerDetails(playerId);
      if (!details) {
        totalErrors++;
        continue;
      }

      // Extract stats
      // featuredStats.regularSeason.subSeason usually contains current season stats
      // If not available (e.g. start of season), might need to check career or last season?
      // For now, we use subSeason if available, otherwise defaults.
      
      const currentStats = details.featuredStats?.regularSeason?.subSeason || {};
      const careerStats = details.careerTotals?.regularSeason || {};

      // Map generic positions to specific ones using shoots/catches for wingers
      let position = details.position;
      if (position === 'L') position = 'LW';
      if (position === 'R') position = 'RW';
      if (position === 'G') {
        // Goalies are just 'G' but let's make sure we aren't filtering them out downstream or something.
        // The issue might be that previous code didn't handle 'G' correctly or defaults?
        // Actually, the roster endpoint returns categories: 'forwards', 'defensemen', 'goalies'.
        // We are iterating all of them.
      }
      
      const playerData = {
        full_name: `${details.firstName?.default} ${details.lastName?.default}`,
        position: position,
        team: details.currentTeamAbbrev || team, // Fallback to loop team
        jersey_number: details.sweaterNumber?.toString(),
        status: details.isActive ? 'active' : 'na',
        headshot_url: details.headshot,
        last_updated: new Date().toISOString(),
        
        // Stats
        goals: currentStats.goals || 0,
        assists: currentStats.assists || 0,
        points: currentStats.points || 0,
        plus_minus: currentStats.plusMinus || 0,
        shots: currentStats.shots || 0,
        hits: 0, // Not readily available in landing endpoint
        blocks: 0, // Not readily available in landing endpoint
        
        // Goalie Stats
        wins: currentStats.wins || null,
        losses: currentStats.losses || null,
        ot_losses: currentStats.otLosses || null,
        saves: currentStats.saves || null,
        goals_against_average: currentStats.goalsAgainstAvg || null,
        save_percentage: currentStats.savePctg || null,
      };

      // Upsert into Supabase
      // We match on full_name + team or just insert? 
      // Ideally we would have a unique NHL ID col, but we don't.
      // We will assume full_name is unique enough or just add a new row if not careful.
      // But wait, the table has `id uuid default gen_random_uuid()`.
      // We can try to match on `full_name` and `team` if we want to update, 
      // OR we can just clear the table first? 
      // The user asked to "add all the players". 
      // The migration had: `truncate table public.players;`
      // I should probably check if player exists by name?
      // For simplicity and "refresh" behavior, upserting by matching a unique key is best.
      // But we don't have a unique constraint on name.
      // Let's try to find existing player by name first.

      const { data: existingPlayers } = await supabase
        .from('players')
        .select('id')
        .eq('full_name', playerData.full_name)
        .eq('team', playerData.team)
        .limit(1);

      let error;
      if (existingPlayers && existingPlayers.length > 0) {
        // Update
        const { error: updateError } = await supabase
          .from('players')
          .update(playerData)
          .eq('id', existingPlayers[0].id);
        error = updateError;
      } else {
        // Insert
        const { error: insertError } = await supabase
          .from('players')
          .insert(playerData);
        error = insertError;
      }

      if (error) {
        console.error(`Error saving player ${playerData.full_name}:`, error);
        totalErrors++;
      } else {
        // console.log(`Saved ${playerData.full_name}`);
        totalProcessed++;
      }
    }
  }

  console.log(`\nImport complete!`);
  console.log(`Processed: ${totalProcessed}`);
  console.log(`Errors: ${totalErrors}`);
}

main().catch(console.error);


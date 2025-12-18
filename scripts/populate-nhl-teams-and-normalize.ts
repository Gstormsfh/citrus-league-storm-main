/**
 * Script to populate NHL teams table and normalize existing data
 * 
 * This script:
 * 1. Populates nhl_teams table with all 32 NHL teams
 * 2. Links existing players to nhl_teams via team_id
 * 3. Links existing nhl_games to nhl_teams via home_team_id and away_team_id
 */

import { createClient } from '@supabase/supabase-js';

// Supabase credentials
const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
// Try service role key from env, fallback to anon key (may need service role for updates)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// NHL Teams data (32 teams)
const NHL_TEAMS = [
  { team_id: 1, name: 'New Jersey Devils', abbreviation: 'NJD', city: 'New Jersey' },
  { team_id: 2, name: 'New York Islanders', abbreviation: 'NYI', city: 'New York' },
  { team_id: 3, name: 'New York Rangers', abbreviation: 'NYR', city: 'New York' },
  { team_id: 4, name: 'Philadelphia Flyers', abbreviation: 'PHI', city: 'Philadelphia' },
  { team_id: 5, name: 'Pittsburgh Penguins', abbreviation: 'PIT', city: 'Pittsburgh' },
  { team_id: 6, name: 'Boston Bruins', abbreviation: 'BOS', city: 'Boston' },
  { team_id: 7, name: 'Buffalo Sabres', abbreviation: 'BUF', city: 'Buffalo' },
  { team_id: 8, name: 'Montreal Canadiens', abbreviation: 'MTL', city: 'Montreal' },
  { team_id: 9, name: 'Ottawa Senators', abbreviation: 'OTT', city: 'Ottawa' },
  { team_id: 10, name: 'Toronto Maple Leafs', abbreviation: 'TOR', city: 'Toronto' },
  { team_id: 12, name: 'Carolina Hurricanes', abbreviation: 'CAR', city: 'Carolina' },
  { team_id: 13, name: 'Florida Panthers', abbreviation: 'FLA', city: 'Florida' },
  { team_id: 14, name: 'Tampa Bay Lightning', abbreviation: 'TBL', city: 'Tampa Bay' },
  { team_id: 15, name: 'Washington Capitals', abbreviation: 'WSH', city: 'Washington' },
  { team_id: 16, name: 'Chicago Blackhawks', abbreviation: 'CHI', city: 'Chicago' },
  { team_id: 17, name: 'Detroit Red Wings', abbreviation: 'DET', city: 'Detroit' },
  { team_id: 18, name: 'Nashville Predators', abbreviation: 'NSH', city: 'Nashville' },
  { team_id: 19, name: 'St. Louis Blues', abbreviation: 'STL', city: 'St. Louis' },
  { team_id: 20, name: 'Calgary Flames', abbreviation: 'CGY', city: 'Calgary' },
  { team_id: 21, name: 'Colorado Avalanche', abbreviation: 'COL', city: 'Colorado' },
  { team_id: 22, name: 'Edmonton Oilers', abbreviation: 'EDM', city: 'Edmonton' },
  { team_id: 23, name: 'Vancouver Canucks', abbreviation: 'VAN', city: 'Vancouver' },
  { team_id: 24, name: 'Anaheim Ducks', abbreviation: 'ANA', city: 'Anaheim' },
  { team_id: 25, name: 'Dallas Stars', abbreviation: 'DAL', city: 'Dallas' },
  { team_id: 26, name: 'Los Angeles Kings', abbreviation: 'LAK', city: 'Los Angeles' },
  { team_id: 28, name: 'San Jose Sharks', abbreviation: 'SJS', city: 'San Jose' },
  { team_id: 29, name: 'Columbus Blue Jackets', abbreviation: 'CBJ', city: 'Columbus' },
  { team_id: 30, name: 'Minnesota Wild', abbreviation: 'MIN', city: 'Minnesota' },
  { team_id: 52, name: 'Winnipeg Jets', abbreviation: 'WPG', city: 'Winnipeg' },
  { team_id: 53, name: 'Arizona Coyotes', abbreviation: 'ARI', city: 'Arizona' },
  { team_id: 54, name: 'Vegas Golden Knights', abbreviation: 'VGK', city: 'Vegas' },
  { team_id: 55, name: 'Seattle Kraken', abbreviation: 'SEA', city: 'Seattle' },
];

async function main() {
  console.log('🏒 NHL Teams Normalization Script');
  console.log('================================\n');

  try {
    // Step 1: Populate NHL teams table
    console.log('📋 Step 1: Populating NHL teams table...');
    const { error: teamsError } = await supabase
      .from('nhl_teams')
      .upsert(NHL_TEAMS, { onConflict: 'team_id' });

    if (teamsError) {
      throw teamsError;
    }
    console.log(`✅ Inserted/updated ${NHL_TEAMS.length} NHL teams\n`);

    // Step 2: Link players to teams via team_id
    console.log('👥 Step 2: Linking players to NHL teams...');
    let playersUpdated = 0;
    
    for (const team of NHL_TEAMS) {
      const { data, error } = await supabase
        .from('players')
        .update({ team_id: team.team_id })
        .eq('team', team.abbreviation)
        .select();

      if (error) {
        console.warn(`⚠️  Error updating players for ${team.abbreviation}:`, error.message);
      } else {
        playersUpdated += data?.length || 0;
      }
    }
    console.log(`✅ Updated ${playersUpdated} players with team_id\n`);

    // Step 3: Link nhl_games to teams via home_team_id and away_team_id
    console.log('📅 Step 3: Linking NHL games to teams...');
    let gamesUpdated = 0;
    
    for (const team of NHL_TEAMS) {
      // Update home_team_id
      const { count: homeCount, error: homeError } = await supabase
        .from('nhl_games')
        .update({ home_team_id: team.team_id })
        .eq('home_team', team.abbreviation)
        .select('id', { count: 'exact', head: true });

      if (homeError) {
        console.warn(`⚠️  Error updating home games for ${team.abbreviation}:`, homeError.message);
      } else {
        gamesUpdated += homeCount || 0;
      }

      // Update away_team_id
      const { count: awayCount, error: awayError } = await supabase
        .from('nhl_games')
        .update({ away_team_id: team.team_id })
        .eq('away_team', team.abbreviation)
        .select('id', { count: 'exact', head: true });

      if (awayError) {
        console.warn(`⚠️  Error updating away games for ${team.abbreviation}:`, awayError.message);
      } else {
        gamesUpdated += awayCount || 0;
      }
    }
    console.log(`✅ Updated ${gamesUpdated} game records with team_id references\n`);

    // Step 4: Verification
    console.log('🔍 Step 4: Verifying normalization...');
    
    const { count: teamsCount } = await supabase
      .from('nhl_teams')
      .select('*', { count: 'exact', head: true });
    
    const { count: playersWithTeamId } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
      .not('team_id', 'is', null);
    
    const { count: gamesWithTeamIds } = await supabase
      .from('nhl_games')
      .select('*', { count: 'exact', head: true })
      .not('home_team_id', 'is', null)
      .not('away_team_id', 'is', null);

    console.log(`   Teams: ${teamsCount}`);
    console.log(`   Players with team_id: ${playersWithTeamId}`);
    console.log(`   Games with team_ids: ${gamesWithTeamIds}`);

    console.log('\n✨ Normalization complete!');
    console.log('\n📊 Summary:');
    console.log(`   ✅ ${teamsCount} NHL teams in database`);
    console.log(`   ✅ ${playersWithTeamId} players linked to teams`);
    console.log(`   ✅ ${gamesWithTeamIds} games linked to teams`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();


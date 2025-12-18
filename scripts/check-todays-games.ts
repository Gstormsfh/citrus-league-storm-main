/**
 * Quick script to check if games are scheduled for December 8, 2025
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkTodaysGames() {
  console.log('🏒 Checking games for December 8, 2025...\n');
  
  const today = '2025-12-08';
  
  const { data: games, error } = await supabase
    .from('nhl_games')
    .select('*')
    .eq('game_date', today)
    .order('game_time', { ascending: true });
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  if (!games || games.length === 0) {
    console.log('⚠️  No games found for December 8, 2025');
    console.log('   This is expected if the schedule doesn\'t have games for that date.');
    console.log('   The schedule import should have games starting from October 2025.');
    return;
  }
  
  console.log(`✅ Found ${games.length} games scheduled for December 8, 2025:\n`);
  
  games.forEach((game, index) => {
    const gameTime = game.game_time ? new Date(game.game_time).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Denver'
    }) : 'TBD';
    
    console.log(`${index + 1}. ${game.away_team} @ ${game.home_team}`);
    console.log(`   Time: ${gameTime} (Mountain Time)`);
    console.log(`   Status: ${game.status}`);
    console.log(`   Game ID: ${game.game_id}\n`);
  });
  
  // Also check what the first week start date would be
  console.log('\n📅 Week Calculation Test:');
  const testDate = new Date('2025-12-08T00:00:00');
  console.log(`   Today: ${testDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
  console.log(`   First Week Start: December 8, 2025 (Monday)`);
  console.log(`   Current Week: Week 1`);
}

checkTodaysGames();


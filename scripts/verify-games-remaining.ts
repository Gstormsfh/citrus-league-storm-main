/**
 * Verify games remaining calculations for Week 1 (Dec 8-14, 2025)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function verifyGamesRemaining() {
  console.log('🏒 Verifying Games Remaining for Week 1 (Dec 8-14, 2025)\n');
  
  const weekStart = '2025-12-08';
  const weekEnd = '2025-12-14';
  const today = '2025-12-08';
  
  // Test teams that have games today
  const testTeams = ['TOR', 'TBL', 'BUF', 'CGY', 'LAK', 'UTA', 'DET', 'VAN', 'MIN', 'SEA'];
  
  for (const team of testTeams) {
    const { data: games, error } = await supabase
      .from('nhl_games')
      .select('*')
      .or(`home_team.eq.${team},away_team.eq.${team}`)
      .gte('game_date', weekStart)
      .lte('game_date', weekEnd)
      .order('game_date', { ascending: true });
    
    if (error) {
      console.error(`Error for ${team}:`, error);
      continue;
    }
    
    const allGames = games || [];
    const todayGames = allGames.filter(g => g.game_date === today);
    const todayDate = new Date(today + 'T00:00:00');
    todayDate.setHours(0, 0, 0, 0);
    
    // Calculate games remaining (from today onwards, scheduled or live)
    const gamesRemaining = allGames.filter(g => {
      const gameDate = new Date(g.game_date + 'T00:00:00');
      gameDate.setHours(0, 0, 0, 0);
      return gameDate >= todayDate && (g.status === 'scheduled' || g.status === 'live');
    }).length;
    
    console.log(`${team}:`);
    console.log(`  Total games this week: ${allGames.length}`);
    console.log(`  Games today: ${todayGames.length}`);
    console.log(`  Games remaining (from today): ${gamesRemaining}`);
    if (allGames.length > 0) {
      const gameDates = allGames.map(g => g.game_date).join(', ');
      console.log(`  Game dates: ${gameDates}`);
    }
    console.log('');
  }
}

verifyGamesRemaining();


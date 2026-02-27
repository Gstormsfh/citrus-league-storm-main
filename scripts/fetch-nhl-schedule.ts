/**
 * Script to fetch and store NHL schedule data from NHL Stats API
 * Run with: npx tsx scripts/fetch-nhl-schedule.ts
 * 
 * This fetches the full 2025-2026 season schedule and stores it in the nhl_games table
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// NHL Stats API base URL
const NHL_API_BASE = 'https://statsapi.web.nhl.com/api/v1';

interface NHLAPIGame {
  gamePk: number;
  gameDate: string;
  status: {
    abstractGameState: string;
    detailedState: string;
  };
  teams: {
    away: { team: { abbreviation: string } };
    home: { team: { abbreviation: string } };
  };
  venue?: { name: string };
  linescore?: {
    currentPeriod: number;
    currentPeriodTimeRemaining: string;
    teams: {
      home: { goals: number };
      away: { goals: number };
    };
  };
}

interface NHLAPIScheduleResponse {
  dates: Array<{
    date: string;
    games: NHLAPIGame[];
  }>;
}

async function fetchNHLSchedule(season: string = '20252026'): Promise<NHLAPIGame[]> {
  console.log(`📅 Fetching NHL schedule for season ${season}...`);

  const allGames: NHLAPIGame[] = [];
  let startDate = new Date('2025-10-01'); // Season typically starts in October
  const endDate = new Date('2026-06-30'); // Season ends in June

  // Fetch schedule in monthly chunks to avoid overwhelming the API
  while (startDate <= endDate) {
    const monthEnd = new Date(startDate);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    monthEnd.setDate(0); // Last day of the month

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = monthEnd.toISOString().split('T')[0];

    try {
      console.log(`   Fetching games from ${startStr} to ${endStr}...`);
      const response = await fetch(
        `${NHL_API_BASE}/schedule?startDate=${startStr}&endDate=${endStr}&hydrate=linescore`
      );

      if (!response.ok) {
        console.warn(`   ⚠️  Failed to fetch games for ${startStr}-${endStr}: ${response.statusText}`);
        startDate = new Date(monthEnd);
        startDate.setDate(startDate.getDate() + 1);
        continue;
      }

      const data: NHLAPIScheduleResponse = await response.json();
      
      for (const date of data.dates || []) {
        for (const game of date.games || []) {
          allGames.push(game);
        }
      }

      console.log(`   ✅ Found ${data.dates.reduce((sum, d) => sum + d.games.length, 0)} games`);
    } catch (error) {
      console.error(`   ❌ Error fetching games for ${startStr}-${endStr}:`, error);
    }

    startDate = new Date(monthEnd);
    startDate.setDate(startDate.getDate() + 1);
    
    // Rate limiting - wait 100ms between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`✅ Total games fetched: ${allGames.length}`);
  return allGames;
}

interface TransformedGame {
  game_id: number;
  game_date: string;
  home_team: string;
  away_team: string;
  status: 'scheduled' | 'live' | 'final' | 'postponed';
  period: string | null;
  period_time: string | null;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
}

function transformGame(game: NHLAPIGame): TransformedGame {
  const gameDate = new Date(game.gameDate);
  const status = game.status.abstractGameState.toLowerCase();
  
  let dbStatus: 'scheduled' | 'live' | 'final' | 'postponed' = 'scheduled';
  if (status === 'live') dbStatus = 'live';
  else if (status === 'final') dbStatus = 'final';
  else if (status === 'preview') dbStatus = 'scheduled';

  let period: string | null = null;
  let periodTime: string | null = null;
  if (game.linescore) {
    const periodNum = game.linescore.currentPeriod;
    if (periodNum === 1) period = '1st';
    else if (periodNum === 2) period = '2nd';
    else if (periodNum === 3) period = '3rd';
    else if (periodNum === 4) period = 'OT';
    else if (periodNum > 4) period = 'SO';
    
    periodTime = game.linescore.currentPeriodTimeRemaining || null;
  }

  return {
    game_id: game.gamePk,
    game_date: gameDate.toISOString().split('T')[0],
    game_time: gameDate.toISOString(),
    home_team: game.teams.home.team.abbreviation,
    away_team: game.teams.away.team.abbreviation,
    home_score: game.linescore?.teams.home.goals || 0,
    away_score: game.linescore?.teams.away.goals || 0,
    status: dbStatus,
    period: period,
    period_time: periodTime,
    venue: game.venue?.name || null,
    season: 2025,
    game_type: 'regular' // Could be enhanced to detect playoffs
  };
}

async function storeGames(games: NHLAPIGame[]) {
  console.log(`💾 Storing ${games.length} games in database...`);
  
  const transformedGames = games.map(transformGame);
  
  // Insert in batches of 100 to avoid overwhelming the database
  const batchSize = 100;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < transformedGames.length; i += batchSize) {
    const batch = transformedGames.slice(i, i + batchSize);
    
    try {
      const { error } = await supabase
        .from('nhl_games')
        .upsert(batch, { onConflict: 'game_id', ignoreDuplicates: false });

      if (error) {
        console.error(`   ❌ Error inserting batch ${i / batchSize + 1}:`, error.message);
        errors++;
      } else {
        inserted += batch.length;
        console.log(`   ✅ Inserted batch ${i / batchSize + 1} (${inserted}/${transformedGames.length} games)`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ Error inserting batch ${i / batchSize + 1}:`, errorMessage);
      errors++;
    }
  }

  console.log(`\n✅ Schedule import complete!`);
  console.log(`   Inserted: ${inserted} games`);
  console.log(`   Errors: ${errors} batches`);
}

async function main() {
  try {
    console.log('🚀 Starting NHL schedule import...\n');
    
    const games = await fetchNHLSchedule('20252026');
    
    if (games.length === 0) {
      console.log('⚠️  No games found. The season may not have started yet or the API may be unavailable.');
      return;
    }

    await storeGames(games);
    
    console.log('\n✨ Done! The NHL schedule has been imported.');
    console.log('   You can now use ScheduleService to query game data.');
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();

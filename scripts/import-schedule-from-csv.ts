/**
 * Script to import NHL schedule from CSV file
 * Run with: npx tsx scripts/import-schedule-from-csv.ts
 * 
 * Place your CSV file at: data/nhl-schedule-2025.csv
 * Or specify a different path as the first argument
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface CSVRow {
  date: string;
  gameId: string;
  gameStartUTC: string;
  teamId: string;
  away: string; // '@' for away, empty for home
  opponentId: string;
  team: string; // Team abbreviation (e.g., 'ANA')
  opponent: string; // Opponent abbreviation
  opponentLabel?: string;
  totalGames?: string;
  yahooWk?: string;
  postponed?: string;
  started?: string;
  b2b?: string;
  offNight?: string;
  game?: string;
}

// Team ID to abbreviation mapping (from NHL)
const TEAM_ID_MAP: Record<string, string> = {
  '1': 'NJD', '2': 'NYI', '3': 'NYR', '4': 'PHI', '5': 'PIT',
  '6': 'BOS', '7': 'BUF', '8': 'MTL', '9': 'OTT', '10': 'TOR',
  '12': 'CAR', '13': 'FLA', '14': 'TBL', '15': 'WSH', '16': 'CHI',
  '17': 'DET', '18': 'NSH', '19': 'STL', '20': 'CGY', '21': 'COL',
  '22': 'EDM', '23': 'VAN', '24': 'ANA', '25': 'DAL', '26': 'LAK',
  '28': 'SJS', '29': 'CBJ', '30': 'MIN', '52': 'WPG', '53': 'ARI',
  '54': 'VGK', '55': 'SEA', '68': 'UTA'
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim()); // Push last field
  
  return result;
}

function parseCSV(content: string): CSVRow[] {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  // Parse header
  const headers = parseCSVLine(lines[0]);
  
  // Parse rows
  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue; // Skip incomplete rows
    
    const row: any = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row as CSVRow);
  }
  
  return rows;
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  // Handle MM/DD/YYYY format
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const month = parseInt(match[1]) - 1; // 0-indexed
    const day = parseInt(match[2]);
    const year = parseInt(match[3]);
    return new Date(year, month, day);
  }
  
  // Try ISO format
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }
  
  console.warn(`⚠️  Could not parse date: ${dateStr}`);
  return null;
}

function parseDateTime(dateTimeStr: string): Date | null {
  if (!dateTimeStr) return null;
  
  // The CSV "gameStartUTC" field is actually in Eastern Time, not UTC
  // We need to parse it as Eastern Time and convert to UTC
  
  // Handle "MM/DD/YYYY HH:MM:SS" format (Eastern Time)
  const match = dateTimeStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (match) {
    const month = parseInt(match[1]) - 1;
    const day = parseInt(match[2]);
    const year = parseInt(match[3]);
    const hour = parseInt(match[4]);
    const minute = parseInt(match[5]);
    const second = parseInt(match[6]);
    
    // Create a date string in Eastern Time format and parse it
    // Format: "YYYY-MM-DDTHH:MM:SS-05:00" for EST (UTC-5)
    // Note: December 2025 is EST (not EDT), so UTC-5
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}-05:00`;
    const easternDate = new Date(dateStr);
    
    if (isNaN(easternDate.getTime())) {
      console.warn(`⚠️  Could not parse Eastern time: ${dateStr}`);
      return null;
    }
    
    return easternDate; // Date object automatically converts to UTC internally
  }
  
  // Try ISO format - if it's already a proper ISO string with timezone, use it
  const isoDate = new Date(dateTimeStr);
  if (!isNaN(isoDate.getTime())) {
    // If the string doesn't have timezone info, assume it's Eastern Time
    if (!dateTimeStr.includes('Z') && !dateTimeStr.includes('+') && !dateTimeStr.match(/-\d{2}:\d{2}$/)) {
      // No timezone indicator - treat as Eastern and add timezone offset
      // Parse the date and add EST offset (UTC-5)
      const match = dateTimeStr.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]) - 1;
        const day = parseInt(match[3]);
        const hour = parseInt(match[4]);
        const minute = parseInt(match[5]);
        const second = parseInt(match[6]);
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}-05:00`;
        return new Date(dateStr);
      }
    }
    return isoDate;
  }
  
  console.warn(`⚠️  Could not parse datetime: ${dateTimeStr}`);
  return null;
}

function normalizeTeamAbbrev(abbrev: string): string {
  const trimmed = abbrev.trim().toUpperCase();
  // Map common variations
  const map: Record<string, string> = {
    'SJ': 'SJS',
    'SJ SHARKS': 'SJS',
    'SJ SHARK': 'SJS',
  };
  return map[trimmed] || trimmed;
}

async function importScheduleFromCSV(filePath: string) {
  console.log(`📖 Reading CSV file: ${filePath}...`);
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const rows = parseCSV(content);
    
    console.log(`✅ Found ${rows.length} rows in CSV`);
    
    if (rows.length === 0) {
      console.error('❌ No data found in CSV file');
      return;
    }

    // Show first row as example
    console.log('\n📋 First row (example):');
    console.log(rows[0]);
    console.log('\n');

    // Group rows by gameId to get unique games
    // Each game appears twice (once for each team)
    const gamesMap = new Map<string, { home?: CSVRow; away?: CSVRow }>();
    
    for (const row of rows) {
      if (!row.gameId || !row.team || !row.opponent) {
        continue; // Skip invalid rows
      }
      
      if (!gamesMap.has(row.gameId)) {
        gamesMap.set(row.gameId, {});
      }
      
      const game = gamesMap.get(row.gameId)!;
      if (row.away === '@') {
        game.away = row;
      } else {
        game.home = row;
      }
    }

    console.log(`✅ Found ${gamesMap.size} unique games (from ${rows.length} rows)`);

    // Transform to database format
    const games: any[] = [];
    let skipped = 0;

    for (const [gameId, gameData] of gamesMap.entries()) {
      // Determine home and away teams
      let homeRow: CSVRow;
      let awayRow: CSVRow;
      
      if (gameData.home && gameData.away) {
        // Both rows present - use them
        homeRow = gameData.home;
        awayRow = gameData.away;
      } else if (gameData.home) {
        // Only home row - opponent must be away
        homeRow = gameData.home;
        awayRow = {
          ...gameData.home,
          team: gameData.home.opponent,
          opponent: gameData.home.team,
          away: '@'
        };
      } else if (gameData.away) {
        // Only away row - opponent must be home
        awayRow = gameData.away;
        homeRow = {
          ...gameData.away,
          team: gameData.away.opponent,
          opponent: gameData.away.team,
          away: ''
        };
      } else {
        skipped++;
        continue;
      }

      const gameDate = parseDate(homeRow.date || awayRow.date);
      if (!gameDate) {
        skipped++;
        continue;
      }

      const gameTime = parseDateTime(homeRow.gameStartUTC || awayRow.gameStartUTC);
      
      const homeTeam = normalizeTeamAbbrev(homeRow.team);
      const awayTeam = normalizeTeamAbbrev(awayRow.team);

      if (!homeTeam || !awayTeam) {
        skipped++;
        continue;
      }

      // Determine status
      let status: 'scheduled' | 'live' | 'final' | 'postponed' = 'scheduled';
      if (homeRow.postponed === 'TRUE' || awayRow.postponed === 'TRUE') {
        status = 'postponed';
      } else if (homeRow.started === 'TRUE' || awayRow.started === 'TRUE') {
        // Check if it's final or live (we'll assume final if started is TRUE and no live indicator)
        // For now, mark as scheduled and let it update later
        status = 'scheduled';
      }

      games.push({
        game_id: parseInt(gameId),
        game_date: gameDate.toISOString().split('T')[0],
        game_time: gameTime ? gameTime.toISOString() : null,
        home_team: homeTeam,
        away_team: awayTeam,
        home_score: 0,
        away_score: 0,
        status: status,
        period: null,
        period_time: null,
        venue: null,
        season: 2025,
        game_type: 'regular',
      });
    }

    console.log(`✅ Transformed ${games.length} valid games (skipped ${skipped} invalid)`);

    if (games.length === 0) {
      console.error('❌ No valid games found after transformation');
      return;
    }

    // Store in database
    console.log(`💾 Storing ${games.length} games in database...`);
    
    // Insert in batches of 100
    const batchSize = 100;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < games.length; i += batchSize) {
      const batch = games.slice(i, i + batchSize);
      const { error } = await supabase
        .from('nhl_games')
        .upsert(batch, {
          onConflict: 'game_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`❌ Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error);
        errors += batch.length;
      } else {
        inserted += batch.length;
        console.log(`✅ Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(games.length / batchSize)} (${inserted}/${games.length} games)`);
      }
    }

    console.log(`\n✨ Import complete!`);
    console.log(`   ✅ Inserted: ${inserted} games`);
    if (errors > 0) {
      console.log(`   ❌ Errors: ${errors} games`);
    }
    
    // Show sample of imported games
    console.log(`\n📊 Sample of imported games:`);
    games.slice(0, 5).forEach(game => {
      console.log(`   ${game.game_date}: ${game.away_team} @ ${game.home_team}`);
    });
  } catch (error: any) {
    console.error('❌ Error reading CSV file:', error.message);
    if (error.code === 'ENOENT') {
      console.error(`   File not found: ${filePath}`);
      console.error(`   Please place your CSV file at: ${filePath}`);
    }
    throw error;
  }
}

// Main execution
const filePath = process.argv[2] || join(process.cwd(), 'data', 'nhl-schedule-2025.csv');

console.log('🏒 NHL Schedule CSV Importer');
console.log('================================\n');
console.log(`📁 Looking for file: ${filePath}\n`);

importScheduleFromCSV(filePath)
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  });


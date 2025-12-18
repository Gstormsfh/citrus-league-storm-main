/**
 * Script to import NHL schedule from Excel file
 * Run with: npx tsx scripts/import-schedule-from-excel.ts
 * 
 * Place your Excel file at: data/nhl-schedule-2025.xlsx
 * Or specify a different path as the first argument
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Team abbreviation mapping (common variations)
const TEAM_ABBREV_MAP: Record<string, string> = {
  'Anaheim Ducks': 'ANA',
  'Arizona Coyotes': 'ARI',
  'Boston Bruins': 'BOS',
  'Buffalo Sabres': 'BUF',
  'Calgary Flames': 'CGY',
  'Carolina Hurricanes': 'CAR',
  'Chicago Blackhawks': 'CHI',
  'Colorado Avalanche': 'COL',
  'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET',
  'Edmonton Oilers': 'EDM',
  'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK',
  'Minnesota Wild': 'MIN',
  'Montreal Canadiens': 'MTL',
  'Nashville Predators': 'NSH',
  'New Jersey Devils': 'NJD',
  'New York Islanders': 'NYI',
  'New York Rangers': 'NYR',
  'Ottawa Senators': 'OTT',
  'Philadelphia Flyers': 'PHI',
  'Pittsburgh Penguins': 'PIT',
  'San Jose Sharks': 'SJS',
  'Seattle Kraken': 'SEA',
  'St. Louis Blues': 'STL',
  'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR',
  'Utah Hockey Club': 'UTA',
  'Vancouver Canucks': 'VAN',
  'Vegas Golden Knights': 'VGK',
  'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG',
  // Common abbreviations
  'ANA': 'ANA',
  'ARI': 'ARI',
  'BOS': 'BOS',
  'BUF': 'BUF',
  'CGY': 'CGY',
  'CAR': 'CAR',
  'CHI': 'CHI',
  'COL': 'COL',
  'CBJ': 'CBJ',
  'DAL': 'DAL',
  'DET': 'DET',
  'EDM': 'EDM',
  'FLA': 'FLA',
  'LAK': 'LAK',
  'MIN': 'MIN',
  'MTL': 'MTL',
  'NSH': 'NSH',
  'NJD': 'NJD',
  'NYI': 'NYI',
  'NYR': 'NYR',
  'OTT': 'OTT',
  'PHI': 'PHI',
  'PIT': 'PIT',
  'SJS': 'SJS',
  'SEA': 'SEA',
  'STL': 'STL',
  'TBL': 'TBL',
  'TOR': 'TOR',
  'UTA': 'UTA',
  'VAN': 'VAN',
  'VGK': 'VGK',
  'WSH': 'WSH',
  'WPG': 'WPG',
};

function normalizeTeamName(teamName: string): string {
  const trimmed = teamName.trim();
  // Check direct mapping first
  if (TEAM_ABBREV_MAP[trimmed]) {
    return TEAM_ABBREV_MAP[trimmed];
  }
  // Try case-insensitive match
  const upper = trimmed.toUpperCase();
  for (const [key, abbrev] of Object.entries(TEAM_ABBREV_MAP)) {
    if (key.toUpperCase() === upper) {
      return abbrev;
    }
  }
  // If it's already a 3-letter abbreviation, return as-is
  if (trimmed.length === 3) {
    return trimmed.toUpperCase();
  }
  console.warn(`⚠️  Unknown team name: "${teamName}". Using as-is.`);
  return trimmed.toUpperCase();
}

function parseDate(dateValue: any): Date | null {
  if (!dateValue) return null;
  
  // If it's already a Date object
  if (dateValue instanceof Date) {
    return dateValue;
  }
  
  // If it's a number (Excel serial date)
  if (typeof dateValue === 'number') {
    // Excel serial date: days since January 1, 1900
    const excelEpoch = new Date(1899, 11, 30); // December 30, 1899
    const date = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
    return date;
  }
  
  // If it's a string, try to parse it
  if (typeof dateValue === 'string') {
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    // Try common formats
    const formats = [
      /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
      /(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
      /(\d{2})-(\d{2})-(\d{4})/, // MM-DD-YYYY
    ];
    
    for (const format of formats) {
      const match = dateValue.match(format);
      if (match) {
        if (format === formats[0]) {
          return new Date(match[1], parseInt(match[2]) - 1, match[3]);
        } else {
          return new Date(match[3], parseInt(match[2]) - 1, match[1]);
        }
      }
    }
  }
  
  console.warn(`⚠️  Could not parse date: ${dateValue}`);
  return null;
}

function parseTime(timeValue: any): Date | null {
  if (!timeValue) return null;
  
  // If it's already a Date object
  if (timeValue instanceof Date) {
    return timeValue;
  }
  
  // If it's a number (Excel time as fraction of day)
  if (typeof timeValue === 'number') {
    const hours = Math.floor(timeValue * 24);
    const minutes = Math.floor((timeValue * 24 - hours) * 60);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }
  
  // If it's a string, try to parse it
  if (typeof timeValue === 'string') {
    // Try common time formats
    const timeMatch = timeValue.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      const ampm = timeMatch[3]?.toUpperCase();
      
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return date;
    }
  }
  
  return null;
}

interface ExcelGameRow {
  [key: string]: any;
}

function transformExcelRowToGame(row: ExcelGameRow, rowIndex: number): any | null {
  // Try to detect column names (common variations)
  const dateCol = Object.keys(row).find(k => 
    /date/i.test(k) || k.toLowerCase() === 'game date' || k.toLowerCase() === 'date'
  );
  const homeCol = Object.keys(row).find(k => 
    /home/i.test(k) || k.toLowerCase().includes('home team') || k.toLowerCase() === 'home'
  );
  const awayCol = Object.keys(row).find(k => 
    /away/i.test(k) || k.toLowerCase().includes('away team') || k.toLowerCase() === 'away'
  );
  const timeCol = Object.keys(row).find(k => 
    /time/i.test(k) || k.toLowerCase() === 'game time' || k.toLowerCase() === 'time'
  );
  const gameIdCol = Object.keys(row).find(k => 
    /game.*id/i.test(k) || k.toLowerCase() === 'gameid' || k.toLowerCase() === 'id'
  );
  const venueCol = Object.keys(row).find(k => 
    /venue/i.test(k) || k.toLowerCase() === 'arena' || k.toLowerCase() === 'stadium'
  );

  if (!dateCol || !homeCol || !awayCol) {
    console.warn(`⚠️  Row ${rowIndex + 1}: Missing required columns (date, home, away). Skipping.`);
    return null;
  }

  const gameDate = parseDate(row[dateCol]);
  if (!gameDate) {
    console.warn(`⚠️  Row ${rowIndex + 1}: Invalid date. Skipping.`);
    return null;
  }

  const homeTeam = normalizeTeamName(String(row[homeCol] || ''));
  const awayTeam = normalizeTeamName(String(row[awayCol] || ''));

  if (!homeTeam || !awayTeam) {
    console.warn(`⚠️  Row ${rowIndex + 1}: Missing team names. Skipping.`);
    return null;
  }

  // Parse time if available
  let gameTime: Date | null = null;
  if (timeCol && row[timeCol]) {
    const timeValue = parseTime(row[timeCol]);
    if (timeValue) {
      // Combine date and time
      gameTime = new Date(gameDate);
      gameTime.setHours(timeValue.getHours(), timeValue.getMinutes(), 0, 0);
    }
  } else {
    // Default to 7:00 PM if no time specified
    gameTime = new Date(gameDate);
    gameTime.setHours(19, 0, 0, 0);
  }

  // Generate game_id if not provided (use a hash of date + teams)
  let gameId: number;
  if (gameIdCol && row[gameIdCol]) {
    gameId = parseInt(String(row[gameIdCol]));
    if (isNaN(gameId)) {
      // Generate from date + teams
      const hash = `${gameDate.toISOString()}-${homeTeam}-${awayTeam}`;
      gameId = hash.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    }
  } else {
    // Generate from date + teams
    const hash = `${gameDate.toISOString()}-${homeTeam}-${awayTeam}`;
    gameId = hash.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  }

  return {
    game_id: gameId,
    game_date: gameDate.toISOString().split('T')[0],
    game_time: gameTime ? gameTime.toISOString() : null,
    home_team: homeTeam,
    away_team: awayTeam,
    home_score: 0,
    away_score: 0,
    status: 'scheduled' as const,
    period: null,
    period_time: null,
    venue: venueCol ? String(row[venueCol] || '').trim() || null : null,
    season: 2025,
    game_type: 'regular' as const,
  };
}

async function importScheduleFromExcel(filePath: string) {
  console.log(`📖 Reading Excel file: ${filePath}...`);
  
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0]; // Use first sheet
    const worksheet = workbook.Sheets[sheetName];
    const rows: ExcelGameRow[] = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`✅ Found ${rows.length} rows in sheet "${sheetName}"`);
    
    if (rows.length === 0) {
      console.error('❌ No data found in Excel file');
      return;
    }

    // Show first row as example
    console.log('\n📋 First row (example):');
    console.log(rows[0]);
    console.log('\n');

    // Transform rows to game objects
    const games = rows
      .map((row, index) => transformExcelRowToGame(row, index))
      .filter((game): game is any => game !== null);

    console.log(`✅ Transformed ${games.length} valid games from ${rows.length} rows`);

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
  } catch (error: any) {
    console.error('❌ Error reading Excel file:', error.message);
    if (error.code === 'ENOENT') {
      console.error(`   File not found: ${filePath}`);
      console.error(`   Please place your Excel file at: ${filePath}`);
    }
    throw error;
  }
}

// Main execution
const filePath = process.argv[2] || join(process.cwd(), 'data', 'nhl-schedule-2025.xlsx');

console.log('🏒 NHL Schedule Excel Importer');
console.log('================================\n');
console.log(`📁 Looking for file: ${filePath}\n`);

importScheduleFromExcel(filePath)
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  });


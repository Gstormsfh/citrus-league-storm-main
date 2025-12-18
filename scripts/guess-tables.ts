
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function guessTableNames() {
  console.log('🔍 Guessing Supabase tables...');
  
  const bases = ['goalies', 'skaters'];
  const years = ['2024', '2025'];
  const suffixes = ['', '_season', '_staging', 'Season', ' Staging', '_data'];
  
  const combinations: string[] = [];
  
  bases.forEach(base => {
      years.forEach(year => {
          suffixes.forEach(suffix => {
              combinations.push(`${base}_${year}${suffix}`.toLowerCase());
              combinations.push(`${base} ${year}${suffix}`);
              combinations.push(`${base}_${year}`);
              combinations.push(`${year}_${base}`);
          });
      });
  });

  // Add the specific filename format
  combinations.push('goalies_2024_season');
  combinations.push('goalies_2025_season');
  combinations.push('skaters_2024_season');
  combinations.push('skaters_2025_season');

  for (const table of combinations) {
    // console.log(`Checking ${table}...`);
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (!error) {
      console.log(`✅ Found table: "${table}"`);
    }
  }
}

guessTableNames();


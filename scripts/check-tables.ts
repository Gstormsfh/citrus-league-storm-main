
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function listTables() {
  console.log('🔍 Querying Supabase tables...');
  
  // Try to list tables by querying them directly since we can't access information_schema easily with anon key sometimes
  const potentialTables = [
    'goalies_2024_staging',
    'goalies_2025_staging',
    'skaters_2024_staging',
    'skaters_2025_staging',
    'goalies_2024',
    'goalies_2025',
    'skaters_2024',
    'skaters_2025',
    'player_analytics'
  ];

  for (const table of potentialTables) {
    const { data, error } = await supabase.from(table).select('count', { count: 'exact', head: true });
    if (!error) {
      console.log(`✅ Found table: ${table}`);
    } else {
      console.log(`❌ Table not found/accessible: ${table} (${error.message})`);
    }
  }
}

listTables();



import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function inspectTable() {
  console.log('🔍 Inspecting staging_2025_skaters structure and Barkov data...');
  
  // 1. Get one row to check keys/casing
  const { data: sample, error: sampleError } = await supabase
    .from('staging_2025_skaters')
    .select('*')
    .limit(1);
    
  if (sample && sample.length > 0) {
      console.log('Sample Keys:', Object.keys(sample[0]).filter(k => k.toLowerCase().includes('assist')));
  } else {
      console.log('Sample Error/Empty:', sampleError);
  }

  // 2. Check Barkov
  const { data: barkov, error: barkovError } = await supabase
    .from('staging_2025_skaters')
    .select('*')
    .ilike('name', '%Barkov%');
    
  if (barkov) {
      console.log(`Found ${barkov.length} rows for Barkov in 2025:`);
      barkov.forEach(row => {
          // Print key stats using whatever casing we found or just dump the row partially
          const primary = row['I_F_primaryAssists'] ?? row['i_f_primaryassists'] ?? 'N/A';
          const secondary = row['I_F_secondaryAssists'] ?? row['i_f_secondaryassists'] ?? 'N/A';
          const situation = row['situation'];
          const games = row['games_played'] ?? row['gamesplayed'];
          console.log(` - Situation: ${situation}, GP: ${games}, PriA: ${primary}, SecA: ${secondary}`);
      });
  } else {
      console.log('Barkov check error:', barkovError);
  }
}

inspectTable();

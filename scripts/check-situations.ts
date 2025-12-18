
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkSituations() {
  console.log('🔍 Checking distinct situations in skaters_2025_staging...');
  
  const { data, error } = await supabase
    .from('skaters_2025_staging')
    .select('situation')
    .limit(100);

  if (error) {
    console.error('Error:', error);
    return;
  }

  const situations = new Set(data.map(d => d.situation));
  console.log('Situations found in first 100 rows:', Array.from(situations));

  // Check specifically for 'all'
  const { count, error: countError } = await supabase
    .from('skaters_2025_staging')
    .select('*', { count: 'exact', head: true })
    .eq('situation', 'all');
    
  if (countError) {
      console.error('Error counting "all":', countError);
  } else {
      console.log(`Rows with situation='all': ${count}`);
  }
}

checkSituations();


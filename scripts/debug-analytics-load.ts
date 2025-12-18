
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testGetAllAnalytics() {
  console.log('🔍 Testing getAllAnalytics logic...');
  
  const season = 2025;
  const skaterTable = `staging_${season}_skaters`;
  const goalieTable = `staging_${season}_goalies`;

  console.log(`Fetching from ${skaterTable}...`);
  const { data: skaters, error: skaterError } = await supabase
    .from(skaterTable)
    .select('playerId, name, situation')
    .eq('situation', 'all')
    .limit(5);

  if (skaterError) console.error('Skater Error:', skaterError);
  else console.log(`Skaters found: ${skaters?.length}`);

  console.log(`Fetching from ${goalieTable}...`);
  const { data: goalies, error: goalieError } = await supabase
    .from(goalieTable)
    .select('playerId, name, situation')
    .eq('situation', 'all')
    .limit(5);

  if (goalieError) console.error('Goalie Error:', goalieError);
  else console.log(`Goalies found: ${goalies?.length}`);
  
  if (skaters && skaters.length > 0) {
      console.log('Sample Skater:', skaters[0]);
  }
}

testGetAllAnalytics();


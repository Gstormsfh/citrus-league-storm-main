
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

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


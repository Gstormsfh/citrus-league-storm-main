
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

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


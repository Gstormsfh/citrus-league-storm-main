
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function listPlayers() {
  console.log('🔍 Listing first 20 players in staging_2025_skaters...');
  const { data } = await supabase
    .from('staging_2025_skaters')
    .select('name')
    .limit(20);
    
  console.log(data);
  
  console.log('Checking for "Barkov" specifically...');
  const { data: barkov } = await supabase
    .from('staging_2025_skaters')
    .select('name')
    .ilike('name', '%Barkov%');
  console.log('Barkov search result:', barkov);
}

listPlayers();



import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkBarkov2024() {
  console.log('🔍 Checking Barkov in 2024 staging table...');
  const { data: barkov } = await supabase
    .from('staging_2024_skaters')
    .select('name')
    .ilike('name', '%Barkov%')
    .limit(1);
  console.log('Barkov 2024 search result:', barkov);
}

checkBarkov2024();


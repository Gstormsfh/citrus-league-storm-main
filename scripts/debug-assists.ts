
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkAssists() {
  console.log('🔍 Checking assists columns for McDavid...');
  
  const { data, error } = await supabase
    .from('staging_2025_skaters')
    .select('*')
    .ilike('name', '%McDavid%')
    .eq('situation', 'all')
    .limit(1);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (data && data.length > 0) {
    const p = data[0];
    console.log('Player:', p.name);
    console.log('Keys containing "assist" (case insensitive):');
    Object.keys(p).forEach(key => {
        if (key.toLowerCase().includes('assist')) {
            console.log(` - "${key}": ${p[key]} (Type: ${typeof p[key]})`);
        }
    });
    
    // Check specific expected keys
    console.log('\nDirect Access Check:');
    console.log('p.I_F_primaryAssists:', p.I_F_primaryAssists);
    console.log('p.i_f_primaryassists:', p.i_f_primaryassists);
    console.log('p["I_F_primaryAssists"]:', p['I_F_primaryAssists']);
  } else {
    console.log('No McDavid found in 2024.');
  }
}

checkAssists();


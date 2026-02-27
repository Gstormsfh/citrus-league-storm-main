
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function listTables() {
  console.log('🔍 Querying Supabase tables...');
  
  // Try to query a non-existent table to see the error format
  const { error: error404 } = await supabase.from('non_existent_table').select('*').limit(1);
  // console.log('Reference error:', error404);

  const potentialTables = [
    'goalies_2025_staging',
    'goalies_2026_staging',
    'skaters_2025_staging',
    'skaters_2026_staging',
    'staging_2025_skaters',
    'staging_2025_goalies',
    'staging_2026_skaters',
    'staging_2026_goalies',
    'Goalies 2025 Season',
    'Goalies 2026 Season',
    'Skaters 2025 Season',
    'Skaters 2026 Season',
    'goalies_2025',
    'goalies_2026',
    'skaters_2025',
    'skaters_2026'
  ];

  for (const table of potentialTables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    
    if (!error) {
      console.log(`✅ Found table: "${table}" (accessible)`);
      if (data && data.length > 0) {
          console.log(`   Sample columns: ${Object.keys(data[0]).join(', ')}`);
          // Check for 'situation' column
          if ('situation' in data[0]) {
              console.log(`   Has 'situation' column: yes`);
          } else {
              console.log(`   Has 'situation' column: NO`);
          }
      } else {
          console.log(`   Table is empty.`);
      }
    } else {
      // console.log(`❌ Table not found/accessible: "${table}" - ${error.message}`);
    }
  }
}

listTables();


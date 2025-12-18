
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function verifyTableContent() {
  console.log('🔍 Verifying content of staging_2025_skaters...');
  
  // Check for 'all' situation row
  const { data, error } = await supabase
    .from('staging_2025_skaters')
    .select('playerId, name, situation')
    .eq('situation', 'all')
    .limit(5);

  if (error) {
    console.error('❌ Error querying table:', error);
  } else {
    console.log(`✅ Success! Found ${data.length} rows with situation='all'.`);
    if (data.length > 0) {
        console.log('Sample data:', data[0]);
    } else {
        console.log('⚠️ No rows with situation="all" found. We might need to sum rows.');
        
        // Check what situations DO exist
        const { data: situData } = await supabase
            .from('staging_2025_skaters')
            .select('situation')
            .limit(20);
        if (situData) {
            const distinct = new Set(situData.map(d => d.situation));
            console.log('Available situations:', Array.from(distinct));
        }
    }
  }
}

verifyTableContent();



import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

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


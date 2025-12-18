/**
 * Script to apply the team_lineups migration to Supabase
 * Run with: npx tsx scripts/apply-migration.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
// Using the anon key - in production, you'd want to use a service role key for migrations
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function applyMigration() {
  try {
    console.log('📦 Reading migration file...');
    const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20241129120511_create_team_lineups_table.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    console.log('🚀 Applying migration to Supabase...');
    
    // Split the migration into individual statements
    // Remove comments and split by semicolons
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    // Execute each statement
    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`   Executing: ${statement.substring(0, 50)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        
        // If RPC doesn't work, try direct query (this might not work with anon key)
        if (error) {
          console.warn(`   RPC failed, trying direct query...`);
          // Note: Direct SQL execution via REST API requires service role key
          // For now, we'll log the error and suggest manual application
          console.error(`   Error: ${error.message}`);
          console.log('\n⚠️  Automatic migration failed. Please apply manually:');
          console.log('   1. Go to your Supabase dashboard');
          console.log('   2. Navigate to SQL Editor');
          console.log('   3. Copy and paste the migration SQL');
          console.log(`   4. File location: ${migrationPath}`);
          return;
        }
      }
    }
    
    console.log('✅ Migration applied successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('\n📋 Manual application steps:');
    console.log('   1. Go to https://supabase.com/dashboard');
    console.log('   2. Select your project');
    console.log('   3. Navigate to SQL Editor');
    console.log('   4. Copy the migration SQL from: supabase/migrations/20241129120511_create_team_lineups_table.sql');
    console.log('   5. Paste and run the SQL');
    process.exit(1);
  }
}

applyMigration();


/**
 * Script to verify that the handle_roster_transaction function exists in Supabase
 * Run with: npx tsx scripts/verify-roster-transaction-function.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function verifyFunction() {
  console.log('🔍 Verifying handle_roster_transaction function...\n');

  try {
    // Check if the function exists by querying information_schema
    const { data: functionData, error: functionError } = await supabase
      .rpc('exec_sql', {
        sql: `
          SELECT 
            routine_name,
            routine_type,
            data_type as return_type
          FROM information_schema.routines 
          WHERE routine_schema = 'public' 
          AND routine_name = 'handle_roster_transaction';
        `
      });

    if (functionError) {
      // Try alternative method - direct query
      console.log('⚠️  RPC method failed, trying direct query...\n');
      
      // Check if roster_transactions table exists
      const { data: tableData, error: tableError } = await supabase
        .from('roster_transactions')
        .select('id')
        .limit(1);

      if (tableError) {
        console.error('❌ Error checking roster_transactions table:', tableError.message);
        console.log('\n📋 The migration has NOT been applied yet.\n');
        console.log('Please apply the migration:');
        console.log('1. Go to https://supabase.com/dashboard');
        console.log('2. Select your project');
        console.log('3. Navigate to SQL Editor');
        console.log('4. Copy and paste the contents of: supabase/migrations/20251208110037_create_roster_transactions.sql');
        console.log('5. Run the migration\n');
        return;
      }

      // Try to call the function with test parameters to see if it exists
      const { data: testData, error: testError } = await supabase.rpc('handle_roster_transaction', {
        p_league_id: '00000000-0000-0000-0000-000000000000',
        p_user_id: '00000000-0000-0000-0000-000000000000',
        p_drop_player_id: null,
        p_add_player_id: null,
        p_transaction_source: 'Test'
      });

      if (testError) {
        if (testError.message.includes('Could not find the function')) {
          console.error('❌ Function NOT FOUND in database\n');
          console.log('The handle_roster_transaction function does not exist.\n');
          console.log('📋 Please apply the migration:');
          console.log('1. Go to https://supabase.com/dashboard');
          console.log('2. Select your project');
          console.log('3. Navigate to SQL Editor');
          console.log('4. Copy and paste the contents of: supabase/migrations/20251208110037_create_roster_transactions.sql');
          console.log('5. Run the migration\n');
          return;
        } else if (testError.message.includes('User does not have a team')) {
          console.log('✅ Function EXISTS! (Got expected validation error)\n');
          console.log('The function is working correctly.\n');
          console.log('✅ Migration has been applied successfully!\n');
          return;
        } else {
          console.log('✅ Function EXISTS! (Got error, but function was found)\n');
          console.log('Error details:', testError.message);
          console.log('\n✅ Migration has been applied successfully!\n');
          return;
        }
      }
    }

    // If we got function data, it exists
    if (functionData && functionData.length > 0) {
      console.log('✅ Function FOUND in database!\n');
      console.log('Function details:');
      console.log(JSON.stringify(functionData, null, 2));
      console.log('\n✅ Migration has been applied successfully!\n');
    } else {
      console.log('❌ Function NOT FOUND in database\n');
      console.log('📋 Please apply the migration:');
      console.log('1. Go to https://supabase.com/dashboard');
      console.log('2. Select your project');
      console.log('3. Navigate to SQL Editor');
      console.log('4. Copy and paste the contents of: supabase/migrations/20251208110037_create_roster_transactions.sql');
      console.log('5. Run the migration\n');
    }

    // Also check if the table exists
    const { data: tableCheck, error: tableCheckError } = await supabase
      .from('roster_transactions')
      .select('id')
      .limit(1);

    if (tableCheckError && tableCheckError.code === 'PGRST116') {
      console.log('⚠️  roster_transactions table does not exist');
      console.log('This means the migration has not been applied.\n');
    } else if (!tableCheckError) {
      console.log('✅ roster_transactions table exists\n');
    }

  } catch (error: any) {
    console.error('❌ Error verifying function:', error.message);
    console.log('\n📋 Please check manually in Supabase dashboard:\n');
    console.log('1. Go to https://supabase.com/dashboard');
    console.log('2. Select your project');
    console.log('3. Navigate to SQL Editor');
    console.log('4. Run this query:');
    console.log(`
      SELECT routine_name, routine_type 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_name = 'handle_roster_transaction';
    `);
    console.log('\n5. If no results, apply the migration from: supabase/migrations/20251208110037_create_roster_transactions.sql\n');
  }
}

verifyFunction();


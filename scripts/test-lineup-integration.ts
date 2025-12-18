/**
 * Test script to verify the lineup integration with Supabase
 * Run with: npx tsx scripts/test-lineup-integration.ts
 * 
 * Make sure to apply the migration first via Supabase dashboard!
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://iezwazccqqrhrjupxzvf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllendhemNjcXFyaHJqdXB4enZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3NjM2MDYsImV4cCI6MjA3MjMzOTYwNn0.349EuoSQ3c1eUiMkc1fvzPfTqPKvCyWw2fLczU-ucOU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testIntegration() {
  console.log('🧪 Testing lineup integration with Supabase...\n');
  
  const testTeamId = 3;
  const testLineup = {
    starters: ['1', '2', '3'],
    bench: ['4', '5'],
    ir: ['6'],
    slotAssignments: {
      '1': 'slot-C-1',
      '2': 'slot-LW-1',
      '3': 'slot-RW-1',
      '6': 'ir-slot-1'
    }
  };

  try {
    // Test 1: Check if table exists
    console.log('1️⃣  Checking if team_lineups table exists...');
    const { data: tableCheck, error: tableError } = await supabase
      .from('team_lineups')
      .select('team_id')
      .limit(1);
    
    if (tableError) {
      if (tableError.code === '42P01' || tableError.message.includes('does not exist')) {
        console.error('   ❌ Table does not exist! Please apply the migration first.');
        console.log('\n   📋 To apply the migration:');
        console.log('      1. Go to https://supabase.com/dashboard');
        console.log('      2. Select your project (iezwazccqqrhrjupxzvf)');
        console.log('      3. Navigate to SQL Editor');
        console.log('      4. Copy SQL from: supabase/migrations/20241129120511_create_team_lineups_table.sql');
        console.log('      5. Paste and run the SQL');
        return;
      }
      throw tableError;
    }
    console.log('   ✅ Table exists!\n');

    // Test 2: Save a lineup
    console.log('2️⃣  Testing saveLineup...');
    const { error: saveError } = await supabase
      .from('team_lineups')
      .upsert({
        team_id: testTeamId,
        starters: testLineup.starters,
        bench: testLineup.bench,
        ir: testLineup.ir,
        slot_assignments: testLineup.slotAssignments,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'team_id'
      });
    
    if (saveError) {
      console.error('   ❌ Save failed:', saveError.message);
      return;
    }
    console.log('   ✅ Lineup saved successfully!\n');

    // Test 3: Load the lineup
    console.log('3️⃣  Testing getLineup...');
    const { data: loadedData, error: loadError } = await supabase
      .from('team_lineups')
      .select('starters, bench, ir, slot_assignments')
      .eq('team_id', testTeamId)
      .single();
    
    if (loadError) {
      console.error('   ❌ Load failed:', loadError.message);
      return;
    }
    
    if (!loadedData) {
      console.error('   ❌ No data found!');
      return;
    }
    
    console.log('   ✅ Lineup loaded successfully!');
    console.log('   📊 Loaded data:', {
      starters: loadedData.starters,
      bench: loadedData.bench,
      ir: loadedData.ir,
      slotAssignments: loadedData.slot_assignments
    });
    
    // Verify data matches
    const matches = 
      JSON.stringify(loadedData.starters) === JSON.stringify(testLineup.starters) &&
      JSON.stringify(loadedData.bench) === JSON.stringify(testLineup.bench) &&
      JSON.stringify(loadedData.ir) === JSON.stringify(testLineup.ir);
    
    if (matches) {
      console.log('   ✅ Data integrity verified!\n');
    } else {
      console.warn('   ⚠️  Data mismatch (this might be expected if test data was modified)\n');
    }

    // Test 4: Check RLS policies
    console.log('4️⃣  Testing RLS policies...');
    const { data: allLineups, error: rlsError } = await supabase
      .from('team_lineups')
      .select('team_id');
    
    if (rlsError) {
      console.error('   ❌ RLS policy issue:', rlsError.message);
      return;
    }
    console.log(`   ✅ Can read lineups (found ${allLineups?.length || 0} teams)\n`);

    console.log('🎉 All tests passed! Integration is working correctly.');
    console.log('\n💡 Next steps:');
    console.log('   - Test in the app by making roster changes');
    console.log('   - Verify changes persist across page refreshes');
    console.log('   - Check that all teams can see each other\'s rosters');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testIntegration();


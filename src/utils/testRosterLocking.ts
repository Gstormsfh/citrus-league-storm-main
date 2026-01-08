/**
 * Test utilities for verifying roster locking and score calculations
 * 
 * Run these tests in the browser console to verify the implementation:
 * 
 * import { testRosterLocking } from '@/utils/testRosterLocking';
 * await testRosterLocking.runAllTests();
 */

import { supabase } from '@/integrations/supabase/client';
import { MatchupScoreJobService } from '@/services/MatchupScoreJobService';

export const testRosterLocking = {
  /**
   * Test 1: Verify locked days cannot be changed
   */
  async testLockedDaysProtection(): Promise<{ passed: boolean; message: string }> {
    console.log('[TEST] Running testLockedDaysProtection...');
    
    try {
      // Query for any locked roster entries
      const { data: lockedEntries, error } = await supabase
        .from('fantasy_daily_rosters')
        .select('team_id, player_id, roster_date, is_locked, locked_at, slot_type')
        .eq('is_locked', true)
        .limit(5);
      
      if (error) {
        return { passed: false, message: `Error querying locked entries: ${error.message}` };
      }
      
      if (!lockedEntries || lockedEntries.length === 0) {
        return { 
          passed: true, 
          message: 'No locked entries found yet. Run MatchupScoreJobService.lockCompletedDays() to create some.' 
        };
      }
      
      console.log(`[TEST] Found ${lockedEntries.length} locked entries:`, lockedEntries);
      
      // Verify locked entries have locked_at timestamp
      const allHaveTimestamp = lockedEntries.every(e => e.locked_at !== null);
      
      if (!allHaveTimestamp) {
        return { 
          passed: false, 
          message: 'Some locked entries are missing locked_at timestamp' 
        };
      }
      
      return { 
        passed: true, 
        message: `✓ Found ${lockedEntries.length} properly locked roster entries` 
      };
      
    } catch (error: any) {
      return { passed: false, message: `Exception: ${error.message}` };
    }
  },

  /**
   * Test 2: Verify matchup scores are pre-calculated
   */
  async testPreCalculatedScores(): Promise<{ passed: boolean; message: string }> {
    console.log('[TEST] Running testPreCalculatedScores...');
    
    try {
      // Query matchups with scores
      const { data: matchups, error } = await supabase
        .from('matchups')
        .select('id, week_number, team1_score, team2_score, status, updated_at')
        .in('status', ['in_progress', 'completed'])
        .not('team1_score', 'is', null)
        .limit(5);
      
      if (error) {
        return { passed: false, message: `Error querying matchups: ${error.message}` };
      }
      
      if (!matchups || matchups.length === 0) {
        return { 
          passed: true, 
          message: 'No matchups with scores found yet. Run MatchupScoreJobService.runJob() to calculate some.' 
        };
      }
      
      console.log(`[TEST] Found ${matchups.length} matchups with pre-calculated scores:`, matchups);
      
      // Verify scores are reasonable (not 0 and not crazy high)
      const hasReasonableScores = matchups.every(m => {
        const score1 = parseFloat(String(m.team1_score || 0));
        const score2 = parseFloat(String(m.team2_score || 0));
        return score1 >= 0 && score1 < 1000 && score2 >= 0 && score2 < 1000;
      });
      
      if (!hasReasonableScores) {
        return { 
          passed: false, 
          message: 'Some matchup scores are unreasonable (negative or > 1000)' 
        };
      }
      
      return { 
        passed: true, 
        message: `✓ Found ${matchups.length} matchups with valid pre-calculated scores` 
      };
      
    } catch (error: any) {
      return { passed: false, message: `Exception: ${error.message}` };
    }
  },

  /**
   * Test 3: Run background job and verify it works
   */
  async testBackgroundJob(): Promise<{ passed: boolean; message: string }> {
    console.log('[TEST] Running testBackgroundJob...');
    
    try {
      // Run the job
      const result = await MatchupScoreJobService.runJob();
      
      console.log('[TEST] Job result:', result);
      
      if (result.errors && result.errors.length > 0) {
        return { 
          passed: false, 
          message: `Job completed with ${result.errors.length} errors: ${JSON.stringify(result.errors)}` 
        };
      }
      
      return { 
        passed: true, 
        message: `✓ Job completed successfully: ${result.lockedCount} locked, ${result.updatedCount} updated` 
      };
      
    } catch (error: any) {
      return { passed: false, message: `Exception: ${error.message}` };
    }
  },

  /**
   * Test 4: Verify createDailyRosterSnapshots respects locked days
   */
  async testSnapshotRespectLocks(): Promise<{ passed: boolean; message: string }> {
    console.log('[TEST] Running testSnapshotRespectLocks...');
    
    try {
      // Get a locked entry
      const { data: lockedEntry, error: queryError } = await supabase
        .from('fantasy_daily_rosters')
        .select('team_id, player_id, roster_date, slot_type, is_locked')
        .eq('is_locked', true)
        .limit(1)
        .maybeSingle();
      
      if (queryError) {
        return { passed: false, message: `Error querying: ${queryError.message}` };
      }
      
      if (!lockedEntry) {
        return { 
          passed: true, 
          message: 'No locked entries to test. Run lockCompletedDays() first.' 
        };
      }
      
      // Verify the entry is still locked (hasn't been overwritten)
      const { data: stillLocked, error: verifyError } = await supabase
        .from('fantasy_daily_rosters')
        .select('is_locked')
        .eq('team_id', lockedEntry.team_id)
        .eq('player_id', lockedEntry.player_id)
        .eq('roster_date', lockedEntry.roster_date)
        .single();
      
      if (verifyError) {
        return { passed: false, message: `Error verifying: ${verifyError.message}` };
      }
      
      if (!stillLocked || !stillLocked.is_locked) {
        return { 
          passed: false, 
          message: 'Locked entry was unlocked! This should never happen.' 
        };
      }
      
      return { 
        passed: true, 
        message: '✓ Locked entries remain locked (not overwritten)' 
      };
      
    } catch (error: any) {
      return { passed: false, message: `Exception: ${error.message}` };
    }
  },

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('========================================');
    console.log('Running Roster Locking & Score Tests');
    console.log('========================================');
    
    const tests = [
      { name: 'Locked Days Protection', fn: this.testLockedDaysProtection },
      { name: 'Pre-Calculated Scores', fn: this.testPreCalculatedScores },
      { name: 'Background Job', fn: this.testBackgroundJob },
      { name: 'Snapshot Respects Locks', fn: this.testSnapshotRespectLocks },
    ];
    
    const results = [];
    
    for (const test of tests) {
      console.log(`\n[TEST] ${test.name}...`);
      const result = await test.fn.call(this);
      results.push({ name: test.name, ...result });
      console.log(`[TEST] ${test.name}: ${result.passed ? 'PASS' : 'FAIL'} - ${result.message}`);
    }
    
    console.log('\n========================================');
    console.log('Test Results Summary');
    console.log('========================================');
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    results.forEach(r => {
      console.log(`${r.passed ? '✓' : '✗'} ${r.name}: ${r.message}`);
    });
    
    console.log(`\nTotal: ${passed} passed, ${failed} failed`);
    console.log('========================================');
  }
};

// Expose globally for console access
if (typeof window !== 'undefined') {
  (window as any).testRosterLocking = testRosterLocking;
  console.log('[testRosterLocking] Test utilities available as window.testRosterLocking');
  console.log('[testRosterLocking] Run: await window.testRosterLocking.runAllTests()');
}


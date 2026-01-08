/**
 * Verify Roster Locking Utility
 * 
 * Run this in the browser console to verify that past days are locked:
 * 
 * import { verifyRosterLocking } from '@/utils/verifyRosterLocking';
 * await verifyRosterLocking.checkCurrentMatchup('YOUR_TEAM_ID');
 */

import { supabase } from '@/integrations/supabase/client';

export const verifyRosterLocking = {
  /**
   * Check the fantasy_daily_rosters entries for a team's current matchup
   * Shows which days are locked and which players are active/bench for each day
   */
  async checkCurrentMatchup(teamId: string): Promise<void> {
    console.log('========================================');
    console.log('ROSTER LOCKING VERIFICATION');
    console.log('========================================');
    console.log('Team ID:', teamId);
    
    const today = new Date().toISOString().split('T')[0];
    console.log('Today:', today);
    
    // Get current matchup for this team
    const { data: matchups, error: matchupError } = await supabase
      .from('matchups')
      .select('id, week_number, week_start_date, week_end_date, team1_id, team2_id')
      .or(`team1_id.eq.${teamId},team2_id.eq.${teamId}`)
      .gte('week_end_date', today)
      .order('week_start_date', { ascending: true })
      .limit(1);
    
    if (matchupError || !matchups?.length) {
      console.error('No current matchup found for team');
      return;
    }
    
    const matchup = matchups[0];
    console.log('Matchup:', matchup.id, 'Week:', matchup.week_number);
    console.log('Week dates:', matchup.week_start_date, 'to', matchup.week_end_date);
    
    // Get all daily roster entries for this matchup
    const { data: rosters, error: rosterError } = await supabase
      .from('fantasy_daily_rosters')
      .select('player_id, roster_date, slot_type, is_locked, locked_at')
      .eq('team_id', teamId)
      .eq('matchup_id', matchup.id)
      .order('roster_date', { ascending: true })
      .order('slot_type', { ascending: true });
    
    if (rosterError) {
      console.error('Error fetching rosters:', rosterError);
      return;
    }
    
    console.log('\n========================================');
    console.log('DAILY ROSTER BREAKDOWN');
    console.log('========================================');
    
    // Group by date
    const byDate = new Map<string, any[]>();
    for (const r of rosters || []) {
      if (!byDate.has(r.roster_date)) {
        byDate.set(r.roster_date, []);
      }
      byDate.get(r.roster_date)!.push(r);
    }
    
    // Display each day
    const todayDate = new Date(today);
    for (const [date, entries] of Array.from(byDate.entries()).sort()) {
      const dateObj = new Date(date);
      const isPast = dateObj < todayDate;
      const isToday = date === today;
      
      const activeCount = entries.filter(e => e.slot_type === 'active').length;
      const benchCount = entries.filter(e => e.slot_type === 'bench').length;
      const lockedCount = entries.filter(e => e.is_locked).length;
      
      const status = isPast ? '🔒 PAST (frozen)' : isToday ? '📅 TODAY' : '📆 FUTURE';
      const lockedStatus = lockedCount > 0 ? ` [${lockedCount} locked]` : '';
      
      console.log(`\n${date} ${status}${lockedStatus}`);
      console.log(`  Active: ${activeCount} players, Bench: ${benchCount} players`);
      
      // Show first few active players
      const active = entries.filter(e => e.slot_type === 'active').slice(0, 3);
      if (active.length > 0) {
        console.log('  Active player IDs:', active.map(e => e.player_id).join(', '));
      }
    }
    
    console.log('\n========================================');
    console.log('VERIFICATION COMPLETE');
    console.log('========================================');
    console.log('\n📋 INSTRUCTIONS:');
    console.log('1. Note the active players for PAST days');
    console.log('2. Change your roster (move a player)');
    console.log('3. Run this command again');
    console.log('4. PAST days should have the SAME active players');
    console.log('5. TODAY and FUTURE days may have changed');
  },

  /**
   * Compare rosters before and after a change
   * Call this BEFORE making a change, then AFTER
   */
  snapshots: new Map<string, any[]>(),
  
  async takeSnapshot(teamId: string, label: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    
    const { data: matchups } = await supabase
      .from('matchups')
      .select('id')
      .or(`team1_id.eq.${teamId},team2_id.eq.${teamId}`)
      .gte('week_end_date', today)
      .order('week_start_date', { ascending: true })
      .limit(1);
    
    if (!matchups?.length) {
      console.error('No matchup found');
      return;
    }
    
    const { data: rosters } = await supabase
      .from('fantasy_daily_rosters')
      .select('player_id, roster_date, slot_type, is_locked')
      .eq('team_id', teamId)
      .eq('matchup_id', matchups[0].id)
      .order('roster_date');
    
    this.snapshots.set(label, rosters || []);
    console.log(`✅ Snapshot "${label}" saved with ${rosters?.length || 0} records`);
  },

  compareSnapshots(label1: string, label2: string): void {
    const snap1 = this.snapshots.get(label1);
    const snap2 = this.snapshots.get(label2);
    
    if (!snap1 || !snap2) {
      console.error('Missing snapshots. Available:', Array.from(this.snapshots.keys()));
      return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const todayDate = new Date(today);
    
    console.log('\n========================================');
    console.log(`COMPARING: "${label1}" vs "${label2}"`);
    console.log('========================================');
    
    // Group by date
    const dates = new Set([
      ...snap1.map(r => r.roster_date),
      ...snap2.map(r => r.roster_date)
    ]);
    
    let pastDaysChanged = 0;
    let futureDaysChanged = 0;
    
    for (const date of Array.from(dates).sort()) {
      const dateObj = new Date(date);
      const isPast = dateObj < todayDate;
      
      const s1Active = snap1.filter(r => r.roster_date === date && r.slot_type === 'active');
      const s2Active = snap2.filter(r => r.roster_date === date && r.slot_type === 'active');
      
      const s1Ids = new Set(s1Active.map(r => r.player_id));
      const s2Ids = new Set(s2Active.map(r => r.player_id));
      
      const added = [...s2Ids].filter(id => !s1Ids.has(id));
      const removed = [...s1Ids].filter(id => !s2Ids.has(id));
      
      if (added.length > 0 || removed.length > 0) {
        const status = isPast ? '🚨 PAST (should NOT change!)' : '✅ FUTURE/TODAY (ok to change)';
        console.log(`\n${date} ${status}`);
        if (added.length > 0) console.log('  Added to active:', added);
        if (removed.length > 0) console.log('  Removed from active:', removed);
        
        if (isPast) pastDaysChanged++;
        else futureDaysChanged++;
      }
    }
    
    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`Past days changed: ${pastDaysChanged} ${pastDaysChanged > 0 ? '🚨 BUG!' : '✅ GOOD!'}`);
    console.log(`Future days changed: ${futureDaysChanged} (expected)`);
    
    if (pastDaysChanged > 0) {
      console.log('\n🚨 CRITICAL: Past days were modified!');
      console.log('This is a bug - please report it with the above details.');
    } else {
      console.log('\n✅ SUCCESS: Past days are protected!');
    }
  }
};

// Expose globally
if (typeof window !== 'undefined') {
  (window as any).verifyRosterLocking = verifyRosterLocking;
  console.log('[verifyRosterLocking] Utility available as window.verifyRosterLocking');
  console.log('[verifyRosterLocking] Usage:');
  console.log('  await verifyRosterLocking.checkCurrentMatchup("YOUR_TEAM_ID")');
  console.log('  await verifyRosterLocking.takeSnapshot("YOUR_TEAM_ID", "before")');
  console.log('  // Make changes...');
  console.log('  await verifyRosterLocking.takeSnapshot("YOUR_TEAM_ID", "after")');
  console.log('  verifyRosterLocking.compareSnapshots("before", "after")');
}


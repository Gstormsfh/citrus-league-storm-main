import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSnapshot } from '../services/snapshotService';

// A returning auction member must receive a contiguous event stream and
// the rounds stored in leagues columns, even without legacy JSON keys.
describe('auction snapshot recovery', () => {
  it('preserves the start event and real roster capacity', async () => {
    const events = [
      { seq: 2, event_type: 'auction_nomination_closed', payload: { player_id: '8478402', winner_team_id: 't1', final_amount: 20, nomination_id: 'n1' } },
      { seq: 1, event_type: 'draft_started', payload: { total_rounds: 14, total_teams: 2, draft_format: 'auction' } },
    ];
    const client = { from(table: string) {
      let fields = '';
      const result = () => {
        if (table === 'leagues') return { data: { id: 'l1', settings: { draftType: 'auction' }, draft_rounds: 14, draft_state: 'active' }, error: null };
        if (table === 'draft_events') return { data: events, error: null };
        if (table === 'draft_order') return { data: { team_order: ['t1', 't2'] }, error: null };
        if (table === 'auction_budgets') return { data: [{ team_id: 't1', remaining_budget: 180, players_won: 1 }], error: null };
        return { data: fields.includes('expires_at') ? null : [], count: 1, error: null };
      };
      const chain = {
        select(value: string) { fields = value; return chain; },
        eq() { return chain; }, in() { return chain; }, order() { return chain; }, limit() { return chain; },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return chain;
    } } as unknown as SupabaseClient;
    const snapshot = await buildSnapshot('l1', client);
    expect(snapshot?.recentEvents.map(e => [e.seq, e.kind])).toEqual([[1, 'draft_started'], [2, 'auction_nomination_closed']]);
    expect(snapshot?.stateSnapshot.totalPicks).toBe(28);
    expect(snapshot?.auctionState?.teamRosterSlotsRemaining.t1).toBe(13);
    expect(snapshot?.auctionState?.teamBudgets.t1).toBe(180);
  });
});

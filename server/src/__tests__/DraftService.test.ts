import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DraftService } from '../services/DraftService';
import { createChain, createMockSupabase } from './helpers';

describe('DraftService', () => {
  let service: DraftService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new DraftService(mockSupabase);
  });

  describe('getActiveDraftSession', () => {
    it('returns new session ID when draft not started', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: { draft_status: 'not_started' }, error: null }));

      const result = await service.getActiveDraftSession('league-1');
      expect(result.sessionId).toBeTruthy();
      expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns existing session ID from picks', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { draft_status: 'in_progress' }, error: null });
        return createChain({ data: { draft_session_id: 'existing-session' }, error: null });
      });

      const result = await service.getActiveDraftSession('league-1');
      expect(result.sessionId).toBe('existing-session');
    });
  });

  describe('getDraftPicks', () => {
    it('returns picks ordered by pick_number', async () => {
      const picks = [{ id: 'p1', pick_number: 1 }, { id: 'p2', pick_number: 2 }];
      mockSupabase.from = vi.fn(() => createChain({ data: picks, error: null }));

      const result = await service.getDraftPicks('league-1');
      expect(result.picks).toEqual(picks);
    });

    it('filters by session ID when provided', async () => {
      const chain = createChain({ data: [], error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.getDraftPicks('league-1', 'session-1');
      expect(chain.eq).toHaveBeenCalledWith('draft_session_id', 'session-1');
    });
  });

  describe('makePick', () => {
    it('rejects already drafted player', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { id: 'existing-pick' }, error: null });
        return createChain();
      });

      const result = await service.makePick('league-1', 'team-1', 100, 1, 1);
      expect(result.error).toContain('already drafted');
    });

    it('rejects duplicate pick number', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: null, error: null });
        if (callCount === 2) return createChain({ data: { id: 'existing' }, error: null });
        return createChain();
      });

      const result = await service.makePick('league-1', 'team-1', 100, 1, 1);
      expect(result.error).toContain('Pick number');
    });

    it('makes pick via RPC', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        return createChain({ data: null, error: null });
      });
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: { id: 'pick-1' }, error: null });

      const result = await service.makePick('league-1', 'team-1', 100, 1, 1, 'session-1');
      expect(result.error).toBeNull();
      expect(result.pick).toEqual({ id: 'pick-1' });
    });
  });

  describe('initializeDraftOrder', () => {
    it('creates snake draft order', async () => {
      mockSupabase.from = vi.fn(() => createChain({ error: null }));

      const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
      const result = await service.initializeDraftOrder('league-1', teams, 3);

      expect(result.sessionId).toBeTruthy();
      expect(result.error).toBeNull();
    });
  });

  describe('resetDraft', () => {
    it('resets via RPC and clears league status', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ error: null });
      mockSupabase.from = vi.fn(() => createChain({ data: { settings: {} }, error: null }));

      const result = await service.resetDraft('league-1');
      expect(result.error).toBeNull();
      expect(result.newSessionId).toBeTruthy();
      expect(mockSupabase.rpc).toHaveBeenCalledWith('nuclear_reset_draft', { p_league_id: 'league-1' });
    });

    it('falls back to direct deletes when RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ error: { message: 'RPC not found' } });
      mockSupabase.from = vi.fn(() => createChain({ data: { settings: {} }, error: null }));

      const result = await service.resetDraft('league-1');
      expect(result.error).toBeNull();
      // Should have called from() for direct deletes (draft_picks, draft_order, team_lineups, roster_assignments, leagues x2)
      expect(mockSupabase.from.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('undoLastPick', () => {
    it('soft-deletes the last pick', async () => {
      const lastPick = { id: 'pick-5', pick_number: 5, player_id: 500 };
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: lastPick, error: null });
        return createChain({ error: null });
      });

      const result = await service.undoLastPick('league-1');
      expect(result.undone).toEqual(lastPick);
      expect(result.error).toBeNull();
    });

    it('returns error when no picks to undo', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.undoLastPick('league-1');
      expect(result.error).toContain('No picks');
    });
  });

  describe('autopickForTeam', () => {
    /**
     * THE SHAPE THIS RPC ACTUALLY RETURNS.
     *
     * Verified against the production catalog on 2026-09-03:
     *
     *   autopick_next_player -> TABLE(picked_player_id integer,
     *                                 player_name text,
     *                                 "position" text,
     *                                 pick_id uuid)
     *
     * Two things follow and BOTH were got wrong by the code this suite was
     * meant to protect. `RETURNS TABLE` means PostgREST sends an ARRAY of
     * rows, so the payload has to be unwrapped before any field is read. And
     * the player column is `picked_player_id`, not `player_id`.
     *
     * The previous version of this test mocked
     *   `data: { player_id: 100, ... }`
     * — a bare object, with a column name the function does not have. That
     * shape exists nowhere except in this file. It was invented to match the
     * implementation instead of the database, so the test and the bug agreed
     * with each other and the suite stayed green through 391 production
     * autopicks, every one of which returned four nulls.
     *
     * Everything below is built from this constant so the fake can never
     * drift back toward whatever the implementation happens to read.
     */
    const RPC_ROW = {
      picked_player_id: 100,
      player_name: 'Connor McDavid',
      position: 'C',
      pick_id: 'pick-1',
    };

    it('unwraps the RETURNS TABLE array and reads picked_player_id', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [RPC_ROW], error: null });

      const result = await service.autopickForTeam('league-1', 'team-1', 'session-1', 1, 1);
      expect(result.playerId).toBe(100);
      expect(result.playerName).toBe('Connor McDavid');
      expect(result.position).toBe('C');
      expect(result.pickId).toBe('pick-1');
      expect(result.error).toBeNull();
    });

    /**
     * The regression proper. routes/draft.ts fans the pick out to every other
     * connected manager behind
     *
     *     if (result.pickId && result.playerId) { broadcastDraftPick(...) }
     *
     * so a null playerId is not a cosmetic wrong field — it silently disables
     * the realtime broadcast for the entire autopick path. This asserts the
     * guard's own condition, not just the field, because the field being
     * populated is only interesting for the reason the guard exists.
     */
    it('returns a payload that satisfies the broadcast guard in routes/draft.ts', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [RPC_ROW], error: null });

      const result = await service.autopickForTeam('league-1', 'team-1', 'session-1', 1, 1);
      expect(
        Boolean(result.pickId && result.playerId),
        'routes/draft.ts skips broadcastDraftPick when either is falsy, so every ' +
          'other manager board goes stale for the whole autopick path',
      ).toBe(true);
    });

    it('tolerates a single row arriving unwrapped', async () => {
      // A one-row RETURNS TABLE can come back either way depending on how the
      // call is made. The array unwrap is deliberately tolerant; the column
      // name is not.
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: RPC_ROW, error: null });

      const result = await service.autopickForTeam('league-1', 'team-1', 'session-1', 1, 1);
      expect(result.playerId).toBe(100);
    });

    it('does not read a player_id column, which this RPC does not have', async () => {
      // Planted offender: the exact payload the old test asserted against. If
      // someone reintroduces `result?.player_id`, this row would satisfy it
      // and the assertion below fails.
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ player_id: 999, player_name: 'Wrong Column', position: 'C', pick_id: 'pick-9' }],
        error: null,
      });

      const result = await service.autopickForTeam('league-1', 'team-1', 'session-1', 1, 1);
      expect(result.playerId).toBeNull();
    });

    it('returns a player id of 0 rather than null, if the RPC ever sends one', async () => {
      // `|| null` collapsed a falsy-but-valid id to null. `?? null` does not.
      // No real player has id 0 today; the point is that the null path means
      // "absent", and only absent.
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ ...RPC_ROW, picked_player_id: 0 }],
        error: null,
      });

      const result = await service.autopickForTeam('league-1', 'team-1', 'session-1', 1, 1);
      expect(result.playerId).toBe(0);
    });

    it('returns nulls on RPC error', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'No eligible players' } });

      const result = await service.autopickForTeam('league-1', 'team-1', 'session-1', 1, 1);
      expect(result.playerId).toBeNull();
      expect(result.error).toBeTruthy();
    });

    it('returns nulls, not a crash, when the RPC returns no rows', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });

      const result = await service.autopickForTeam('league-1', 'team-1', 'session-1', 1, 1);
      expect(result.playerId).toBeNull();
      expect(result.pickId).toBeNull();
      expect(result.error).toBeNull();
    });
  });

  describe('getDraftState', () => {
    it('fetches league, picks, and order in parallel', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { id: 'l1', draft_status: 'in_progress' }, error: null });
        if (table === 'draft_picks') return createChain({ data: [{ id: 'p1' }], error: null });
        if (table === 'draft_order') return createChain({ data: [{ round_number: 1 }], error: null });
        return createChain();
      });

      const result = await service.getDraftState('league-1');
      expect(result.league).toBeTruthy();
      expect(result.picks).toHaveLength(1);
      expect(result.order).toHaveLength(1);
    });
  });

  describe('saveDraftSnapshot', () => {
    it('saves snapshot and returns ID', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: { id: 'snap-1' }, error: null }));

      const result = await service.saveDraftSnapshot('league-1', 'session-1', { picks: [] }, 'user-1');
      expect(result.snapshotId).toBe('snap-1');
    });
  });

  describe('getAutopickRankings', () => {
    it('returns formatted rankings', async () => {
      const rankings = [
        { player_id: 1, rank: 1, position_code: 'C', tier: 1 },
        { player_id: 2, rank: 2, position_code: 'LW', tier: 1 },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: rankings, error: null }));

      const result = await service.getAutopickRankings('league-1');
      expect(result.rankings).toHaveLength(2);
      expect(result.rankings[0].playerId).toBe(1);
      expect(result.rankings[0].positionCode).toBe('C');
    });
  });
});

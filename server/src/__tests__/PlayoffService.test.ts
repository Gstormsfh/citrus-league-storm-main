import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayoffService } from '../services/PlayoffService';
import { createChain, createMockSupabase } from './helpers';

describe('PlayoffService', () => {
  let service: PlayoffService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new PlayoffService(mockSupabase);
  });

  describe('getBracket', () => {
    it('returns bracket with seeds and series', async () => {
      const bracket = { id: 'bracket-1', league_id: 'league-1', status: 'active' };
      const seeds = [{ id: 's1', seed_number: 1, team_id: 't1' }];
      const series = [{ id: 'sr1', round_number: 1, match_number: 1 }];

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: bracket, error: null });
        if (callCount === 2) return createChain({ data: seeds, error: null });
        if (callCount === 3) return createChain({ data: series, error: null });
        return createChain();
      });

      const result = await service.getBracket('league-1');

      expect(result.bracket).toEqual(bracket);
      expect(result.seeds).toEqual(seeds);
      expect(result.series).toEqual(series);
      expect(result.error).toBeNull();
    });

    it('returns nulls when no bracket exists', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getBracket('league-1');

      expect(result.bracket).toBeNull();
      expect(result.seeds).toEqual([]);
      expect(result.series).toEqual([]);
      expect(result.error).toBeNull();
    });

    it('returns error when bracket query fails', async () => {
      const bracketError = { message: 'Query failed', code: '500' };
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: bracketError }));

      const result = await service.getBracket('league-1');

      expect(result.bracket).toBeNull();
      expect(result.error).toEqual(bracketError);
    });

    it('returns error from seeds or series queries', async () => {
      const seedsError = { message: 'Seeds failed' };
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { id: 'bracket-1' }, error: null });
        if (callCount === 2) return createChain({ data: null, error: seedsError });
        if (callCount === 3) return createChain({ data: [], error: null });
        return createChain();
      });

      const result = await service.getBracket('league-1');

      expect(result.error).toEqual(seedsError);
    });
  });

  describe('generateBracket', () => {
    it('generates bracket via RPC with default options', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { bracket_id: 'bracket-1', rounds: 3 },
        error: null,
      });

      const result = await service.generateBracket('league-1');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('generate_playoff_bracket', {
        p_league_id: 'league-1',
        p_consolation_enabled: false,
        p_two_week_matchups: false,
        p_reseed_each_round: false,
        p_seeding_method: 'standings',
      });
      expect(result.result).toEqual({ bracket_id: 'bracket-1', rounds: 3 });
      expect(result.error).toBeNull();
    });

    it('passes custom options', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { bracket_id: 'bracket-1' },
        error: null,
      });

      await service.generateBracket('league-1', {
        consolationEnabled: true,
        twoWeekMatchups: true,
        reseedEachRound: true,
        seedingMethod: 'points',
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('generate_playoff_bracket', {
        p_league_id: 'league-1',
        p_consolation_enabled: true,
        p_two_week_matchups: true,
        p_reseed_each_round: true,
        p_seeding_method: 'points',
      });
    });

    it('returns error when RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });

      const result = await service.generateBracket('league-1');

      expect(result.result).toBeNull();
      expect(result.error).toEqual({ message: 'RPC failed' });
    });

    it('parses string data from RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: JSON.stringify({ bracket_id: 'bracket-1' }),
        error: null,
      });

      const result = await service.generateBracket('league-1');

      expect(result.result).toEqual({ bracket_id: 'bracket-1' });
    });

    it('returns error when RPC result contains error field', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { error: 'Not enough teams' },
        error: null,
      });

      const result = await service.generateBracket('league-1');

      expect(result.result).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe('Not enough teams');
    });
  });

  describe('advanceRound', () => {
    it('advances round via RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { round: 2, matchups_created: 2 },
        error: null,
      });

      const result = await service.advanceRound('bracket-1');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('advance_playoff_round', { p_bracket_id: 'bracket-1' });
      expect(result.result).toEqual({ round: 2, matchups_created: 2 });
      expect(result.error).toBeNull();
    });

    it('returns error when RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Round not complete' },
      });

      const result = await service.advanceRound('bracket-1');

      expect(result.result).toBeNull();
      expect(result.error).toEqual({ message: 'Round not complete' });
    });

    it('returns error from result error field', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { error: 'Incomplete series' },
        error: null,
      });

      const result = await service.advanceRound('bracket-1');

      expect(result.result).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe('resetBracket', () => {
    it('resets bracket via RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const result = await service.resetBracket('league-1');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('reset_playoff_bracket', { p_league_id: 'league-1' });
      expect(result.error).toBeNull();
    });

    it('returns error when RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Reset failed' },
      });

      const result = await service.resetBracket('league-1');

      expect(result.error).toEqual({ message: 'Reset failed' });
    });

    it('returns error from result error field', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: JSON.stringify({ error: 'No bracket found' }),
        error: null,
      });

      const result = await service.resetBracket('league-1');

      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe('No bracket found');
    });
  });

  describe('getPlayoffPicture', () => {
    it('returns playoff picture via RPC', async () => {
      const picture = { teams: [{ id: 't1', clinched: true }] };
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: picture,
        error: null,
      });

      const result = await service.getPlayoffPicture('league-1');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_playoff_picture', { p_league_id: 'league-1' });
      expect(result.picture).toEqual(picture);
      expect(result.error).toBeNull();
    });

    it('returns null picture on RPC error', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Failed' },
      });

      const result = await service.getPlayoffPicture('league-1');

      expect(result.picture).toBeNull();
      expect(result.error).toEqual({ message: 'Failed' });
    });

    it('parses string data from RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: JSON.stringify({ teams: [] }),
        error: null,
      });

      const result = await service.getPlayoffPicture('league-1');

      expect(result.picture).toEqual({ teams: [] });
    });

    it('returns error from result error field', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { error: 'Season not started' },
        error: null,
      });

      const result = await service.getPlayoffPicture('league-1');

      expect(result.picture).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    });
  });
});

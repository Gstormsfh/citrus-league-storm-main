import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@citrus/shared';
import { AuditService } from '../services/AuditService';
import { createMockSupabase } from './helpers';

describe('AuditService', () => {
  let service: AuditService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new AuditService(mockSupabase);
  });

  describe('log', () => {
    it('calls log_security_event RPC with correct params', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.log('AUTH_LOGIN', 'league-1', { ip: '1.2.3.4' }, 'INFO');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'AUTH_LOGIN',
        p_league_id: 'league-1',
        p_details: { ip: '1.2.3.4' },
        p_severity: 'INFO',
      });
    });

    it('defaults severity to INFO', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.log('AUTH_LOGOUT');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'AUTH_LOGOUT',
        p_league_id: null,
        p_details: {},
        p_severity: 'INFO',
      });
    });

    it('does not throw when the RPC promise rejects (fire-and-forget)', async () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
      mockSupabase.rpc = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(service.log('AUTH_LOGIN')).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    // THE regression. supabase-js RETURNS a Postgres error rather than
    // throwing, so the old bare `catch {}` never ran and every rejected audit
    // write disappeared. Fire-and-forget must mean "never block", not "never
    // tell anyone".
    it('does not throw but DOES log when the RPC returns an error', async () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'permission denied for function log_security_event' },
      });

      await expect(service.log('AUTH_LOGIN')).resolves.toBeUndefined();

      expect(spy).toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls[0])).toContain('42501');
      spy.mockRestore();
    });

    it('passes null league_id when not provided', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.log('AUTH_FAILED', null, { reason: 'bad password' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'AUTH_FAILED',
        p_league_id: null,
        p_details: { reason: 'bad password' },
        p_severity: 'INFO',
      });
    });
  });

  describe('logRosterMove', () => {
    it('logs ROSTER_MOVE on success', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logRosterMove('league-1', { addPlayerId: 'p1', dropPlayerId: 'p2', teamId: 't1' }, true);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'ROSTER_MOVE',
        p_league_id: 'league-1',
        p_details: { addPlayerId: 'p1', dropPlayerId: 'p2', teamId: 't1' },
        p_severity: 'INFO',
      });
    });

    it('logs ROSTER_MOVE_FAILED on failure with WARN severity', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logRosterMove('league-1', { teamId: 't1' }, false);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'ROSTER_MOVE_FAILED',
        p_league_id: 'league-1',
        p_details: { teamId: 't1' },
        p_severity: 'WARN',
      });
    });

    it('defaults success to true', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logRosterMove('league-1', { teamId: 't1' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'ROSTER_MOVE',
        p_severity: 'INFO',
      }));
    });
  });

  describe('logDraftEvent', () => {
    it('logs draft start event', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logDraftEvent('DRAFT_START', 'league-1', { teams: 10 });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'DRAFT_START',
        p_league_id: 'league-1',
        p_details: { teams: 10 },
        p_severity: 'INFO',
      });
    });

    it('logs draft complete event', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logDraftEvent('DRAFT_COMPLETE', 'league-1');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'DRAFT_COMPLETE',
        p_league_id: 'league-1',
        p_details: {},
        p_severity: 'INFO',
      });
    });

    it('logs draft reset event', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logDraftEvent('DRAFT_RESET', 'league-1', { reason: 'commissioner request' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'DRAFT_RESET',
        p_league_id: 'league-1',
        p_details: { reason: 'commissioner request' },
        p_severity: 'INFO',
      });
    });
  });

  describe('logLeagueEvent', () => {
    it('logs league create event', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logLeagueEvent('LEAGUE_CREATE', 'league-1', { name: 'My League' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'LEAGUE_CREATE',
        p_league_id: 'league-1',
        p_details: { name: 'My League' },
        p_severity: 'INFO',
      });
    });

    it('logs league join event', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logLeagueEvent('LEAGUE_JOIN', 'league-1', { userId: 'user-1' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'LEAGUE_JOIN',
        p_league_id: 'league-1',
        p_details: { userId: 'user-1' },
        p_severity: 'INFO',
      });
    });
  });

  describe('logSecurityViolation', () => {
    it('logs with CRITICAL severity', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logSecurityViolation({ attempt: 'RLS bypass' }, 'league-1');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'SECURITY_VIOLATION',
        p_league_id: 'league-1',
        p_details: { attempt: 'RLS bypass' },
        p_severity: 'CRITICAL',
      });
    });

    it('logs without league_id', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logSecurityViolation({ attempt: 'unauthorized access' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'SECURITY_VIOLATION',
        p_league_id: null,
        p_details: { attempt: 'unauthorized access' },
        p_severity: 'CRITICAL',
      });
    });
  });
});

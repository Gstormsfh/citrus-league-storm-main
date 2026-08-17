import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountService } from '../services/AccountService';
import { createChain, createMockSupabase } from './helpers';

describe('AccountService', () => {
  let service: AccountService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.auth = {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    };
    service = new AccountService(mockSupabase);
  });

  describe('getProfile', () => {
    it('returns profile for authenticated user', async () => {
      const profile = { id: 'user-1', username: 'john', first_name: 'John' };
      mockSupabase.from = vi.fn(() => createChain({ data: profile, error: null }));

      const result = await service.getProfile();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(profile);
    });

    it('returns error when not authenticated', async () => {
      mockSupabase.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null } });

      const result = await service.getProfile();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not authenticated');
    });

    it('returns error on database error', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { message: 'DB error' } }));

      const result = await service.getProfile();

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });

    it('returns null data when profile not found', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getProfile();

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('exportUserData', () => {
    it('exports user data via RPC', async () => {
      const exportData = { profile: { username: 'john' }, leagues: [] };
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: exportData, error: null });

      const result = await service.exportUserData();

      expect(mockSupabase.rpc).toHaveBeenCalledWith('export_user_data');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(exportData);
    });

    it('returns error when RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC error' } });

      const result = await service.exportUserData();

      expect(result.success).toBe(false);
      expect(result.error).toBe('RPC error');
    });

    it('returns error when RPC result has success=false', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { success: false, error: 'Export limit reached' },
        error: null,
      });

      const result = await service.exportUserData();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Export limit reached');
    });

    it('returns default error message when RPC result has success=false without error', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { success: false },
        error: null,
      });

      const result = await service.exportUserData();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Export failed');
    });
  });

  describe('deleteAccount', () => {
    it('deletes account via RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });

      const result = await service.deleteAccount();

      expect(mockSupabase.rpc).toHaveBeenCalledWith('delete_user_account');
      expect(result.success).toBe(true);
    });

    it('returns error when RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Cannot delete' } });

      const result = await service.deleteAccount();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot delete');
    });

    it('returns error when RPC result has success=false', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { success: false, error: 'Active leagues remain' },
        error: null,
      });

      const result = await service.deleteAccount();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Active leagues remain');
    });

    it('returns default error message when RPC result has success=false without error', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { success: false },
        error: null,
      });

      const result = await service.deleteAccount();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Deletion failed');
    });
  });

  describe('recordConsent', () => {
    it('records consent via RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.recordConsent('privacy_policy', '2.0');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('record_user_consent', {
        p_policy_type: 'privacy_policy',
        p_version: '2.0',
      });
      expect(result.success).toBe(true);
    });

    it('records consent for terms of service', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.recordConsent('terms_of_service', '1.0');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('record_user_consent', {
        p_policy_type: 'terms_of_service',
        p_version: '1.0',
      });
      expect(result.success).toBe(true);
    });

    // Regression: record_user_consent did not exist in the database until
    // 2026-08-12. supabase-js RETURNS that error rather than throwing, and this
    // method discarded it and reported success on all 72 signups. Consent is
    // GDPR Art. 7 evidence -- a failure must never read as a success.
    it('reports failure when the consent RPC rejects', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42883', message: 'function record_user_consent does not exist' },
      });

      const result = await service.recordConsent('privacy_policy', '2026-01-13');

      expect(result.success).toBe(false);
      expect(result.error).toBe('function record_user_consent does not exist');
    });
  });

  describe('logSecurityEvent', () => {
    it('logs security event via RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.logSecurityEvent('AUTH_LOGIN', 'league-1', { ip: '1.2.3.4' }, 'INFO');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'AUTH_LOGIN',
        p_league_id: 'league-1',
        p_details: { ip: '1.2.3.4' },
        p_severity: 'INFO',
      });
      expect(result.success).toBe(true);
    });

    // Regression: the audit path reported success unconditionally, so a
    // rejected write (bad event_type, revoked grant, dead connection) looked
    // identical to a successful one all the way back to the browser.
    it('reports failure when the audit RPC rejects', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23514', message: 'violates check constraint "security_audit_log_event_type_check"' },
      });

      const result = await service.logSecurityEvent('NOT_A_REAL_EVENT', null, {}, 'INFO');

      expect(result.success).toBe(false);
      expect(result.error).toContain('security_audit_log_event_type_check');
    });

    it('defaults severity to INFO', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logSecurityEvent('AUTH_LOGOUT', null, {});

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'AUTH_LOGOUT',
        p_league_id: null,
        p_details: {},
        p_severity: 'INFO',
      });
    });

    it('handles null league_id', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.logSecurityEvent('DATA_EXPORT', null, { userId: 'u1' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_league_id: null,
      }));
    });
  });
});

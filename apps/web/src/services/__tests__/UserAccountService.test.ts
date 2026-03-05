import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Supabase client
// =============================================================================

const mockUpdateUser = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
  },
}));

vi.mock('../AuditService', () => ({
  AuditService: {
    log: vi.fn(),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// =============================================================================
// Import after mocks
// =============================================================================

import { UserAccountService } from '../UserAccountService';
import { AuditService } from '../AuditService';
import { logger } from '@/utils/logger';

// =============================================================================
// Tests
// =============================================================================

describe('UserAccountService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUser.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  // ---------------------------------------------------------------------------
  // changePassword
  // ---------------------------------------------------------------------------
  describe('changePassword', () => {
    it('calls supabase auth.updateUser with new password', async () => {
      const result = await UserAccountService.changePassword('newPassword123');

      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newPassword123' });
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns error when updateUser fails', async () => {
      mockUpdateUser.mockResolvedValue({
        error: { message: 'Password too short' },
      });

      const result = await UserAccountService.changePassword('abc');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Password too short');
    });

    it('catches exceptions and returns error', async () => {
      mockUpdateUser.mockRejectedValue(new Error('Network failure'));

      const result = await UserAccountService.changePassword('test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network failure');
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns generic error message for non-Error exceptions', async () => {
      mockUpdateUser.mockRejectedValue('unknown error');

      const result = await UserAccountService.changePassword('test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to update password');
    });
  });

  // ---------------------------------------------------------------------------
  // exportUserData
  // ---------------------------------------------------------------------------
  describe('exportUserData', () => {
    it('calls export_user_data RPC and returns data', async () => {
      const exportData = { profile: { name: 'Test' }, leagues: [] };
      mockRpc.mockResolvedValue({ data: exportData, error: null });

      const result = await UserAccountService.exportUserData();

      expect(mockRpc).toHaveBeenCalledWith('export_user_data');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(exportData);
    });

    it('logs audit event on successful export', async () => {
      mockRpc.mockResolvedValue({ data: { leagues: [] }, error: null });

      await UserAccountService.exportUserData();

      expect(AuditService.log).toHaveBeenCalledWith(
        'DATA_EXPORT',
        null,
        { action: 'export_user_data' }
      );
    });

    it('returns error when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC error' },
      });

      const result = await UserAccountService.exportUserData();

      expect(result.success).toBe(false);
      expect(result.error).toBe('RPC error');
    });

    it('returns error when RPC data indicates failure', async () => {
      mockRpc.mockResolvedValue({
        data: { success: false, error: 'No data found' },
        error: null,
      });

      const result = await UserAccountService.exportUserData();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No data found');
    });

    it('catches exceptions and returns error', async () => {
      mockRpc.mockRejectedValue(new Error('Unexpected error'));

      const result = await UserAccountService.exportUserData();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // deleteAccount
  // ---------------------------------------------------------------------------
  describe('deleteAccount', () => {
    it('calls delete_user_account RPC', async () => {
      mockRpc.mockResolvedValue({ data: { success: true }, error: null });

      const result = await UserAccountService.deleteAccount();

      expect(mockRpc).toHaveBeenCalledWith('delete_user_account');
      expect(result.success).toBe(true);
    });

    it('returns error when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Permission denied' },
      });

      const result = await UserAccountService.deleteAccount();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
    });

    it('returns error when RPC data indicates failure', async () => {
      mockRpc.mockResolvedValue({
        data: { success: false, error: 'Cannot delete commissioner account' },
        error: null,
      });

      const result = await UserAccountService.deleteAccount();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot delete commissioner account');
    });

    it('catches exceptions and returns error', async () => {
      mockRpc.mockRejectedValue(new Error('DB unavailable'));

      const result = await UserAccountService.deleteAccount();

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB unavailable');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // recordConsent
  // ---------------------------------------------------------------------------
  describe('recordConsent', () => {
    it('calls record_user_consent RPC with correct parameters', async () => {
      await UserAccountService.recordConsent('tos', 'v1.0');

      expect(mockRpc).toHaveBeenCalledWith('record_user_consent', {
        p_policy_type: 'tos',
        p_version: 'v1.0',
      });
    });

    it('does not throw when RPC fails (fire-and-forget)', async () => {
      mockRpc.mockRejectedValue(new Error('Consent error'));

      // Should not throw
      await expect(
        UserAccountService.recordConsent('privacy', 'v2.0')
      ).resolves.not.toThrow();
    });

    it('accepts different policy types', async () => {
      await UserAccountService.recordConsent('privacy_policy', 'v3.0');

      expect(mockRpc).toHaveBeenCalledWith('record_user_consent', {
        p_policy_type: 'privacy_policy',
        p_version: 'v3.0',
      });
    });
  });
});

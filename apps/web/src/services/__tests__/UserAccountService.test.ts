import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock setup
// =============================================================================

const mockUpdateUser = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
  },
}));

vi.mock('@/api/account', () => ({
  accountApi: {
    exportUserData: vi.fn(),
    deleteAccount: vi.fn(),
    recordConsent: vi.fn(),
    logSecurityEvent: vi.fn(),
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
import { accountApi } from '@/api/account';
import { logger } from '@/utils/logger';

// =============================================================================
// Tests
// =============================================================================

describe('UserAccountService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUser.mockResolvedValue({ error: null });
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
    it('calls accountApi.exportUserData and returns data', async () => {
      const exportData = { profile: { name: 'Test' }, leagues: [] };
      (accountApi.exportUserData as any).mockResolvedValue({ data: exportData });

      const result = await UserAccountService.exportUserData();

      expect(accountApi.exportUserData).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toEqual(exportData);
    });

    it('returns error when API response data indicates failure', async () => {
      (accountApi.exportUserData as any).mockResolvedValue({
        data: { success: false, error: 'No data found' },
      });

      const result = await UserAccountService.exportUserData();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No data found');
    });

    it('catches exceptions and returns error', async () => {
      (accountApi.exportUserData as any).mockRejectedValue(new Error('Unexpected error'));

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
    it('calls accountApi.deleteAccount', async () => {
      (accountApi.deleteAccount as any).mockResolvedValue({ data: { success: true } });

      const result = await UserAccountService.deleteAccount();

      expect(accountApi.deleteAccount).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('returns error when API response data indicates failure', async () => {
      (accountApi.deleteAccount as any).mockResolvedValue({
        data: { success: false, error: 'Cannot delete commissioner account' },
      });

      const result = await UserAccountService.deleteAccount();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot delete commissioner account');
    });

    it('catches exceptions and returns error', async () => {
      (accountApi.deleteAccount as any).mockRejectedValue(new Error('DB unavailable'));

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
    it('calls accountApi.recordConsent with correct parameters', async () => {
      (accountApi.recordConsent as any).mockResolvedValue({ data: null });

      await UserAccountService.recordConsent('tos', 'v1.0');

      expect(accountApi.recordConsent).toHaveBeenCalledWith('tos', 'v1.0');
    });

    it('does not throw when API call fails (fire-and-forget)', async () => {
      (accountApi.recordConsent as any).mockRejectedValue(new Error('Consent error'));

      // Should not throw
      await expect(
        UserAccountService.recordConsent('privacy', 'v2.0')
      ).resolves.not.toThrow();
    });

    it('accepts different policy types', async () => {
      (accountApi.recordConsent as any).mockResolvedValue({ data: null });

      await UserAccountService.recordConsent('privacy_policy', 'v3.0');

      expect(accountApi.recordConsent).toHaveBeenCalledWith('privacy_policy', 'v3.0');
    });
  });
});

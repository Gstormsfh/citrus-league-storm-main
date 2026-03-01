import { supabase } from '@/integrations/supabase/client';
import { AuditService } from './AuditService';
import { logger } from '@/utils/logger';

/**
 * UserAccountService — centralized account management operations.
 * Handles password changes, data export, account deletion, and consent recording.
 */
export class UserAccountService {
  /**
   * Change the current user's password.
   */
  static async changePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (error: unknown) {
      logger.error('[UserAccountService] Password change error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update password' };
    }
  }

  /**
   * Export all user data as JSON (GDPR/privacy compliance).
   */
  static async exportUserData(): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('export_user_data');
      if (error) {
        return { success: false, error: error.message };
      }

      const result = data as Record<string, unknown>;
      if (result && result.success === false) {
        return { success: false, error: (result.error as string) || 'Export failed' };
      }

      AuditService.log('DATA_EXPORT' as 'ADMIN_ACTION', null, { action: 'export_user_data' });
      return { success: true, data: result };
    } catch (error: unknown) {
      logger.error('[UserAccountService] Data export error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to export data' };
    }
  }

  /**
   * Delete the current user's account and all associated data.
   * This is irreversible.
   */
  static async deleteAccount(): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('delete_user_account');
      if (error) {
        return { success: false, error: error.message };
      }

      const result = data as Record<string, unknown>;
      if (result && result.success === false) {
        return { success: false, error: (result.error as string) || 'Deletion failed' };
      }

      return { success: true };
    } catch (error: unknown) {
      logger.error('[UserAccountService] Account deletion error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete account' };
    }
  }

  /**
   * Record user consent for a policy (ToS, privacy policy).
   * Fire-and-forget — never blocks the auth flow.
   */
  static async recordConsent(policyType: string, version: string): Promise<void> {
    try {
      await supabase.rpc('record_user_consent', {
        p_policy_type: policyType,
        p_version: version
      });
    } catch {
      // Fire-and-forget — consent recording should never block auth
    }
  }
}

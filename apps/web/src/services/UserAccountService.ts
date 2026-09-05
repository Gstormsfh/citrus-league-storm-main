import { userMessage } from '@/lib/userMessage';
import { supabase } from '@/integrations/supabase/client';
import { accountApi } from '@/api/account';
import { logger } from '@/utils/logger';

/** One row per policy currently in force, from get_user_consent_status(). */
export interface ConsentStatus {
  policy_type: string;
  required_version: string;
  consented_version: string | null;
  status: 'current' | 'outdated' | 'withdrawn' | 'never_given';
  consented_at: string | null;
  withdrawn_at: string | null;
}

/**
 * UserAccountService — centralized account management operations.
 * Handles password changes, data export, account deletion, and consent.
 */
export class UserAccountService {
  /**
   * Change the current user's password.
   *
   * With `verify`, the current password is checked first (2026-09-05): a
   * phone left unlocked on a table could otherwise set a new password in
   * two taps and lock the owner out. Supabase has no "verify password"
   * call, so the check is a sign-in with the current one -- same user, a
   * fresh session, no side effect beyond that. Without `verify` (the reset
   * link's recovery session, an account with no password yet) it sets the
   * password directly, as before.
   */
  static async changePassword(
    newPassword: string,
    verify?: { email: string; currentPassword: string },
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (verify) {
        const { error: checkError } = await supabase.auth.signInWithPassword({
          email: verify.email,
          password: verify.currentPassword,
        });
        if (checkError) {
          return { success: false, error: 'That current password is not right.' };
        }
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (error: unknown) {
      logger.error('[UserAccountService] Password change error:', error);
      return { success: false, error: userMessage(error, 'Failed to update password') };
    }
  }

  /**
   * Export all user data as JSON (GDPR/privacy compliance).
   */
  static async exportUserData(): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
    try {
      const response = await accountApi.exportUserData();
      const result = response.data as Record<string, unknown>;
      if (result && result.success === false) {
        return { success: false, error: (result.error as string) || 'Export failed' };
      }
      // Audit logging is now handled server-side
      return { success: true, data: result };
    } catch (error: unknown) {
      logger.error('[UserAccountService] Data export error:', error);
      return { success: false, error: userMessage(error, 'Failed to export data') };
    }
  }

  /**
   * Delete the current user's account and all associated data.
   * This is irreversible.
   */
  static async deleteAccount(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await accountApi.deleteAccount();
      const result = response.data as Record<string, unknown>;
      if (result && result.success === false) {
        return { success: false, error: (result.error as string) || 'Deletion failed' };
      }

      return { success: true };
    } catch (error: unknown) {
      logger.error('[UserAccountService] Account deletion error:', error);
      return { success: false, error: userMessage(error, 'Failed to delete account') };
    }
  }

  /**
   * Record user consent for a policy (ToS, privacy policy).
   * Fire-and-forget — never blocks the auth flow.
   */
  /**
   * Read what the user still owes: current | outdated | withdrawn | never_given.
   *
   * Unlike recordConsent this is NOT fire-and-forget. It drives what the UI shows,
   * so a failure has to surface rather than render an empty, falsely-reassuring list.
   */
  static async getConsentStatus(): Promise<{ success: boolean; data?: ConsentStatus[]; error?: string }> {
    try {
      const res = await accountApi.getConsentStatus();
      return { success: true, data: (res.data ?? []) as ConsentStatus[] };
    } catch (error: unknown) {
      logger.error('[UserAccountService] Failed to read consent status', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * GDPR Art. 7(3): withdrawing consent must be as easy as giving it.
   * Omit version to withdraw every live version of the policy.
   */
  static async withdrawConsent(policyType: string, version?: string): Promise<{ success: boolean; error?: string }> {
    try {
      await accountApi.withdrawConsent(policyType, version);
      return { success: true };
    } catch (error: unknown) {
      logger.error('[UserAccountService] Failed to withdraw consent', policyType, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Re-grant consent from the profile page. Unlike the signup-path recordConsent
   * below, this one reports failure: the user pressed a button and is owed an answer.
   */
  static async grantConsent(policyType: string, version: string): Promise<{ success: boolean; error?: string }> {
    try {
      await accountApi.recordConsent(policyType, version);
      return { success: true };
    } catch (error: unknown) {
      logger.error('[UserAccountService] Failed to record consent', policyType, version, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  static async recordConsent(policyType: string, version: string): Promise<void> {
    try {
      await accountApi.recordConsent(policyType, version);
    } catch (error) {
      // Still non-blocking — a failed consent write must not strand a signup —
      // but no longer silent. This call reached a non-existent RPC and reported
      // success for 72 signups; the swallow is what made that invisible.
      logger.error('[UserAccountService] GDPR consent NOT recorded', policyType, version, error);
    }
  }
}

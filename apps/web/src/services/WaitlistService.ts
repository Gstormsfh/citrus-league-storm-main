import { userMessage } from '@/lib/userMessage';
import { publicApi } from '@/api/public';
import { logger } from '@/utils/logger';

export interface WaitlistEntry {
  id: string;
  email: string;
  created_at: string;
  source?: string;
}

export const WaitlistService = {
  /**
   * Add an email to the waitlist via API server.
   * Uses the public endpoint (no auth required).
   */
  async addToWaitlist(email: string, source?: string): Promise<{ success: boolean; message: string }> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, message: 'Please enter a valid email address' };
    }

    try {
      const response = await publicApi.joinWaitlist(
        email.toLowerCase().trim(),
        source || 'landing_page',
      );

      const result = response.data as { success: boolean; message: string } | undefined;
      return result || { success: true, message: "Successfully added to waitlist!" };
    } catch (error: unknown) {
      logger.error('WaitlistService: Error adding email:', error);
      const msg = userMessage(error, 'An unexpected error occurred. Please try again.');
      return { success: false, message: msg };
    }
  },

  /**
   * Check if an email is already in the waitlist.
   * Duplicates are detected server-side via insert error.
   */
  async isEmailInWaitlist(_email: string): Promise<boolean> {
    return false;
  },
};

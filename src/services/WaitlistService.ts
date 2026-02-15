// Waitlist Service - Handle email collection for waitlist
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

export interface WaitlistEntry {
  id: string;
  email: string;
  created_at: string;
  source?: string;
}

export const WaitlistService = {
  /**
   * Add an email to the waitlist
   * @param email - Email address to add
   * @param source - Optional source identifier (e.g., 'landing_page', 'hero_section')
   * @returns Success status and message
   */
  async addToWaitlist(email: string, source?: string): Promise<{ success: boolean; message: string }> {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, message: 'Please enter a valid email address' };
    }

    try {
      // Get user agent and IP (if available)
      const userAgent = typeof window !== 'undefined' ? window.navigator.userAgent : null;
      
      const { error } = await supabase
        .from('waitlist')
        .insert({
          email: email.toLowerCase().trim(),
          source: source || 'landing_page',
          user_agent: userAgent,
        });

      if (error) {
        // Check if it's a duplicate email error
        if (error.code === '23505' || error.message?.includes('unique') || error.message?.includes('duplicate')) {
          return { success: false, message: 'This email is already on the waitlist!' };
        }
        logger.error('WaitlistService: Error adding email:', error);
        return { success: false, message: 'Failed to add email. Please try again.' };
      }

      return { success: true, message: 'Successfully added to waitlist! We\'ll notify you when we launch.' };
    } catch (error) {
      logger.error('WaitlistService: Unexpected error:', error);
      return { success: false, message: 'An unexpected error occurred. Please try again.' };
    }
  },

  /**
   * Check if an email is already in the waitlist
   * Note: This uses a public RPC or direct check if available
   * Since RLS blocks SELECT, we'll handle duplicates via insert error
   */
  async isEmailInWaitlist(email: string): Promise<boolean> {
    // Since RLS blocks SELECT for regular users, we'll rely on the insert error
    // to detect duplicates. This method is kept for potential future use.
    return false;
  },
};

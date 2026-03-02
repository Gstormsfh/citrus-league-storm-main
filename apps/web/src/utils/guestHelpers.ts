/**
 * Guest mode helper functions
 * Provides utilities for checking guest state and preventing database operations
 */

import { UserLeagueState } from '@/contexts/LeagueContext';

/**
 * Check if the current user is in guest mode
 */
export const isGuestMode = (userLeagueState: UserLeagueState | undefined | null): boolean => {
  return userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league';
};

/**
 * Check if the current user is an active user with a league
 */
export const isActiveUser = (userLeagueState: UserLeagueState | undefined | null): boolean => {
  return userLeagueState === 'active-user';
};

/**
 * Guard function to prevent database operations for guests
 * Returns true if operation should be blocked, false if it can proceed
 */
export const shouldBlockGuestOperation = (
  userLeagueState: UserLeagueState | undefined | null,
  showToast?: (message: string) => void
): boolean => {
  if (isGuestMode(userLeagueState)) {
    if (showToast) {
      showToast('Please sign up to perform this action.');
    }
    return true;
  }
  return false;
};


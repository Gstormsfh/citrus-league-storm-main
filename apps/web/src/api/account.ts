/**
 * Account API client — replaces direct Supabase calls for user account operations.
 */
import { apiClient } from './client';

export const accountApi = {
  getProfile() {
    return apiClient.get<{
      id: string;
      username: string;
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      location: string | null;
      bio: string | null;
      default_team_name: string | null;
      timezone: string | null;
      avatar_url: string | null;
      created_at: string;
      updated_at: string;
    }>('/api/account/profile');
  },
  /** Get aggregated performance stats (W-L, total points, seasons). */
  getStats() {
    return apiClient.get<{
      totalSeasons: number;
      wins: number;
      losses: number;
      ties: number;
      totalPoints: number;
    }>('/api/account/stats');
  },
  /** Check if a username is already taken. Returns { available: boolean }. */
  checkUsername(username: string) {
    return apiClient.get<{ available: boolean }>(`/api/account/check-username/${encodeURIComponent(username)}`);
  },
  /** Update the authenticated user's profile fields. */
  updateProfile(fields: {
    username?: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    location?: string;
    bio?: string;
    default_team_name?: string;
    timezone?: string;
    avatar_url?: string;
  }) {
    return apiClient.put('/api/account/profile', fields);
  },
  exportUserData() {
    return apiClient.post('/api/account/export');
  },
  deleteAccount() {
    return apiClient.post('/api/account/delete');
  },
  recordConsent(policyType: string, version: string) {
    return apiClient.post('/api/account/consent', { policyType, version });
  },
  logSecurityEvent(eventType: string, leagueId?: string | null, details?: Record<string, unknown>, severity?: string) {
    return apiClient.post('/api/account/audit-log', { eventType, leagueId, details, severity });
  },
};

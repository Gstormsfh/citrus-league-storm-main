/**
 * Account API client — replaces direct Supabase calls for user account operations.
 */
import { apiClient } from './client';

export const accountApi = {
  getProfile() {
    return apiClient.get<{
      id: string;
      username: string;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      location: string | null;
      bio: string | null;
      default_team_name: string | null;
      timezone: string | null;
      created_at: string;
      updated_at: string;
    }>('/api/account/profile');
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

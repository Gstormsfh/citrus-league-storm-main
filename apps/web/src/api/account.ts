/**
 * Account API client — replaces direct Supabase calls for user account operations.
 */
import { apiClient } from './client';

export const accountApi = {
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

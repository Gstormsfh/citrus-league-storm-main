/**
 * Admin API client — for admin panel operations.
 */

import { apiClient } from './client';

export const adminApi = {
  /** Get platform-wide stats */
  getStats() {
    return apiClient.get('/api/admin/stats');
  },

  /** List users with pagination and search */
  getUsers(params?: { page?: number; limit?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return apiClient.get(`/api/admin/users${qs ? `?${qs}` : ''}`);
  },

  /** List leagues with pagination and search */
  getLeagues(params?: { page?: number; limit?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return apiClient.get(`/api/admin/leagues${qs ? `?${qs}` : ''}`);
  },

  /** Get security audit log */
  getAuditLog(limit?: number) {
    const qs = limit ? `?limit=${limit}` : '';
    return apiClient.get(`/api/admin/audit-log${qs}`);
  },

  /** Trigger score recalculation */
  recalculateScores(leagueId: string, week?: number) {
    return apiClient.post('/api/admin/recalculate-scores', { leagueId, week });
  },

  /** Get data pipeline status */
  getPipelineStatus() {
    return apiClient.get('/api/admin/pipeline-status');
  },

  /** Get API health check */
  getHealth() {
    return apiClient.get('/api/health');
  },
};

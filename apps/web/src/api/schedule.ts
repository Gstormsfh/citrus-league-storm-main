/**
 * Schedule API client — replaces direct Supabase calls for schedule/game operations.
 */

import { apiClient } from './client';

export const scheduleApi = {
  /** Get NHL games (by date, date range, or team) */
  getGames(params?: { date?: string; startDate?: string; endDate?: string; team?: string }) {
    const query = new URLSearchParams();
    if (params?.date) query.set('date', params.date);
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.team) query.set('team', params.team);
    const qs = query.toString();
    return apiClient.get(`/api/schedule/games${qs ? `?${qs}` : ''}`);
  },

  /** Get fantasy week definitions */
  getFantasyWeeks() {
    return apiClient.get('/api/schedule/fantasy-weeks');
  },
};

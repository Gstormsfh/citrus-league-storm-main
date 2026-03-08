/**
 * Best Ball API client — replaces direct Supabase calls for best ball optimization.
 */
import { apiClient } from './client';

export const bestballApi = {
  triggerOptimization(leagueId: string, date: string) {
    return apiClient.post(`/api/bestball/league/${leagueId}/optimize`, { date });
  },
  triggerWeekOptimization(leagueId: string, params: { weekStartDate: string; weekEndDate: string }) {
    return apiClient.post(`/api/bestball/league/${leagueId}/optimize-week`, params);
  },
  getWeeklyData(leagueId: string, teamId: string, weekNumber: number) {
    return apiClient.post(`/api/bestball/league/${leagueId}/weekly-data`, { teamId, weekNumber });
  },
  getLeagueTeams(leagueId: string) {
    return apiClient.get(`/api/bestball/league/${leagueId}/teams`);
  },
};

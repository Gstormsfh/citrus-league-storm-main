/**
 * Keeper API client — replaces direct Supabase calls for keeper/dynasty operations.
 */
import { apiClient } from './client';

export const keeperApi = {
  getTeamKeepers(leagueId: string, teamId: string, seasonYear: number) {
    return apiClient.get(`/api/keepers/league/${leagueId}/team/${teamId}?seasonYear=${seasonYear}`);
  },
  getLeagueKeepers(leagueId: string, seasonYear: number) {
    return apiClient.get(`/api/keepers/league/${leagueId}?seasonYear=${seasonYear}`);
  },
  designateKeeper(leagueId: string, params: { teamId: string; playerId: string; seasonYear: number; originalDraftRound?: number }) {
    return apiClient.post(`/api/keepers/league/${leagueId}/designate`, params);
  },
  releaseKeeper(keeperId: string, params: { teamId: string }) {
    return apiClient.put(`/api/keepers/${keeperId}/release`, params);
  },
  validateKeepers(leagueId: string, params: { teamId: string; seasonYear: number }) {
    return apiClient.post(`/api/keepers/league/${leagueId}/validate`, params);
  },
  getKeeperDraftCosts(leagueId: string, teamId: string, seasonYear: number) {
    return apiClient.get(`/api/keepers/league/${leagueId}/draft-costs?teamId=${teamId}&seasonYear=${seasonYear}`);
  },
  lockKeepers(leagueId: string, params: { seasonYear: number }) {
    return apiClient.post(`/api/keepers/league/${leagueId}/lock`, params);
  },
  updateKeeperSettings(leagueId: string, settings: { keeperEnabled: boolean; keeperCount: number; keeperPenalty: string; dynastyMode: boolean }) {
    return apiClient.put(`/api/keepers/league/${leagueId}/settings`, settings);
  },
};

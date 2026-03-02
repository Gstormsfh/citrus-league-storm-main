/**
 * Citrus API Client — unified export for all API modules.
 *
 * Usage:
 *   import { leagueApi, playerApi, matchupApi } from '@/api';
 *
 * Or import the base client for custom requests:
 *   import { apiClient, ApiError } from '@/api/client';
 */

export { apiClient, ApiError } from './client';
export { leagueApi } from './leagues';
export { playerApi } from './players';
export { matchupApi } from './matchups';
export { draftApi } from './draft';
export { rosterApi } from './rosters';
export { tradeApi } from './trades';
export { waiverApi } from './waivers';
export { notificationApi } from './notifications';
export { stormyApi } from './stormy';

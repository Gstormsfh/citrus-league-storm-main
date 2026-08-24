/**
 * rosterRefresh — single source of truth for "a roster changed, make every
 * view believe it." (2026-08-24 post-deploy sweep)
 *
 * The disease this kills: adds/drops/claims persisted INSTANTLY server-side,
 * but the client kept two in-memory roster caches — MatchupService's
 * 2-minute rosterCache and RosterCacheService — and the acquisition paths
 * never invalidated them. The Roster page even listened for
 * `citrus:roster-changed` and dutifully refetched… straight back into the
 * stale cache. Only a hard reload (which wipes module memory) showed the
 * truth. Lineup SAVES already cleared both caches (LineupService); player
 * acquisitions didn't.
 *
 * Rules:
 *  - Services that mutate rosters clear caches themselves (belt).
 *  - UI mutation sites call notifyRosterChanged() after success (suspenders +
 *    broadcast) so every open page refetches fresh.
 *  - Event listeners must clear via clearRosterCaches() before refetching —
 *    never re-dispatch from a listener (loop).
 */
import { MatchupService } from '@/services/MatchupService';
import { RosterCacheService } from '@/services/RosterCacheService';
import { rosterApi } from '@/api/rosters';

/** Clear all client-side roster caches. No event. Safe to over-clear. */
export function clearRosterCaches(teamId?: string, leagueId?: string): void {
  try {
    MatchupService.clearRosterCache(teamId, leagueId);
  } catch { /* cache clearing is best-effort */ }
  try {
    RosterCacheService.clearCache(teamId, leagueId);
  } catch { /* best-effort */ }
  try {
    // 2026-08-24: third cache layer — rosterApi's 30s TTL cache serves
    // getTeamRoster/getLineup/getLeagueRosters. Without this, drop-player
    // dialogs and waiver-wire rosters can be 30s stale after a mutation.
    rosterApi.invalidate('rosters:');
  } catch { /* best-effort */ }
}

/**
 * Clear both caches AND broadcast `citrus:roster-changed` so the Roster page
 * (and any other listener) refetches fresh data. Call after every successful
 * roster mutation: add, drop, swap, waiver claim landing, trade accept.
 */
export function notifyRosterChanged(teamId?: string, leagueId?: string): void {
  clearRosterCaches(teamId, leagueId);
  window.dispatchEvent(new CustomEvent('citrus:roster-changed'));
}

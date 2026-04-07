/**
 * Pure helper determining how to reconcile the URL league id with the
 * LeagueContext's activeLeagueId on the Matchup page.
 *
 * The URL path is the SOURCE OF TRUTH. When a user navigates to
 * /matchup/<betaId> but LeagueContext still has <charlieId> as active
 * (e.g. because Charlie was the default first league), we must sync the
 * context to the URL — NOT redirect the URL to the context. The latter
 * caused the "Beta -> Charlie hijack" bug (fixed in 8dc7b06 / c5f6798).
 *
 * This helper is extracted so the behavior can be unit tested without
 * mounting the full Matchup page.
 */
export type SyncAction =
  | { action: 'sync-context'; payload: { leagueId: string } }
  | { action: 'navigate'; payload: { leagueId: string } }
  | { action: 'noop' };

export interface SyncLeagueFromUrlInput {
  urlLeagueId: string | undefined;
  activeLeagueId: string | null | undefined;
}

export function syncLeagueFromUrl({
  urlLeagueId,
  activeLeagueId,
}: SyncLeagueFromUrlInput): SyncAction {
  // URL is source of truth: if both are set and differ, sync context to URL.
  if (urlLeagueId && activeLeagueId && urlLeagueId !== activeLeagueId) {
    return { action: 'sync-context', payload: { leagueId: urlLeagueId } };
  }

  // If URL has no leagueId but we have an active league, navigate URL to include it.
  if (!urlLeagueId && activeLeagueId) {
    return { action: 'navigate', payload: { leagueId: activeLeagueId } };
  }

  return { action: 'noop' };
}

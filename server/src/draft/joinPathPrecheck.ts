// Phase 4.5 chunk 11g.10 sub-step 10c-2 join-path-robustness — gate
// (b) predicate factory. Extracted from `index.ts` so tests can
// inject a stubbed Supabase client and exercise the mandatory
// three-way disambiguation (`ready` / `empty` / `error`) without a
// live DB.
//
// The predicate is dependency-injected into `startUwsServer`; the
// uWS upgrade handler consumes only the returned Promise. See
// `uws-server.ts` GATE_A / GATE_B constants and the ratified
// Decision Log rows for the full architecture.

import type { SupabaseClient } from '@supabase/supabase-js';
import { structuredLogger } from '@citrus/shared';

/**
 * Overall budget for the awaited `SELECT` — comfortably clears
 * fresh-connection primary-hop reads while aborting before uWS's
 * own idleTimeout backstop can complicate the handshake window.
 * Any timeout classifies as `'error'` (NOT `'empty'`) so the
 * client falls to the retained 1011 defense-in-depth path instead
 * of being told the draft "isn't set up."
 */
export const DRAFT_INITIALIZED_PRECHECK_TIMEOUT_MS = 1500;

export type DraftInitializedResult = 'ready' | 'empty' | 'error';

/**
 * Factory. Returns a predicate bound to the supplied Supabase
 * client. Production wiring passes `supabaseAdmin`; tests pass a
 * stub that mimics the PostgREST builder chain.
 *
 * Contract:
 *   `'ready'` — `draft_order` has at least one row for `leagueId`.
 *               Proceed to upgrade.
 *   `'empty'` — clean zero-row read completed. Close 4400.
 *   `'error'` — any query error, timeout, missing count, or thrown
 *               exception. Close 1011 (retained defense-in-depth).
 *
 * NEVER emits `'empty'` from an error path — the whole point of the
 * three-way return per the architect's Tuesday ruling.
 */
export function createDraftInitializedPredicate(
  supabase: SupabaseClient,
): (leagueId: string) => Promise<DraftInitializedResult> {
  return async function isDraftInitialized(
    leagueId: string,
  ): Promise<DraftInitializedResult> {
    const query = supabase
      .from('draft_order')
      .select('league_id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .limit(1);
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const result = await Promise.race([
        (async () => {
          const r = await query;
          return { kind: 'query' as const, r };
        })(),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timeoutHandle = setTimeout(
            () => resolve({ kind: 'timeout' }),
            DRAFT_INITIALIZED_PRECHECK_TIMEOUT_MS,
          );
        }),
      ]);
      if (result.kind === 'timeout') {
        structuredLogger.warn('uws.upgrade.precheck_timeout', {
          leagueId,
          timeoutMs: DRAFT_INITIALIZED_PRECHECK_TIMEOUT_MS,
        });
        return 'error';
      }
      const { error, count } = result.r;
      if (error) {
        structuredLogger.error('uws.upgrade.precheck_query_error', {
          leagueId,
          error: error.message,
        });
        return 'error';
      }
      // `count` is null iff the head request didn't compute one
      // (shouldn't happen with `count: 'exact'` — but classify as
      // 'error' rather than 'empty' to avoid the false-4400 risk the
      // architect flagged as the critical failure mode).
      if (typeof count !== 'number') {
        structuredLogger.error('uws.upgrade.precheck_count_missing', {
          leagueId,
        });
        return 'error';
      }
      return count > 0 ? 'ready' : 'empty';
    } catch (err) {
      structuredLogger.error('uws.upgrade.precheck_threw', { leagueId }, err);
      return 'error';
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Paged table reads that survive PostgREST's row clamp.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * PostgREST caps EVERY response at the project's `db-max-rows`, which is
 * **1,000** on this project (`data-pipeline/utils/supabase_rest.py:241`
 * records the same number from the pipeline side). When it truncates it
 * returns HTTP 200 with a short body and no error, no warning, and no
 * `Content-Range` complaint the client code looks at. A `.range(0, 4999)`
 * is NOT an escape hatch — the server clamps the ranged response too.
 *
 * This repo has been bitten by that clamp four separate times:
 *
 *   1. `apps/web/src/hooks/usePreloadedPlayers.ts` — an unpaged
 *      `player_directory` read returned ~1,000 rows in physical-row order.
 *      McDavid and MacKinnon were simply absent from the window and a
 *      fringe player led the draft board (`docs/ARCHITECT_INBOX.md`).
 *   2. `server/src/draft/autopickStrategy.ts` — `player_season_stats`,
 *      1,066 rows, ~66 players silently dropped to a default games-played
 *      estimate ("AUTOPICK-TRUNCATION", 2026-08-12).
 *   3. The same file's `player_ros_projections` read, one statement above
 *      the query fixed in (2), missed by a single query
 *      ("AUTOPICK-TRUNCATION-2", 2026-08-13).
 *   4. `server/src/services/PlayerDashboardService.ts` — caught in review
 *      before it shipped; its header note is the canonical write-up.
 *
 * Each of those was fixed with a private copy of the same loop. This
 * module is the shared one, so the fifth site does not need a fifth copy.
 *
 * ── The two rules ────────────────────────────────────────────────────
 * 1. **Page.** Ask for at most `PAGE_SIZE` rows and keep asking until a
 *    short page comes back.
 * 2. **Order by something unique.** Postgres guarantees no row order
 *    across separate LIMIT/OFFSET statements. Paging on a non-unique sort
 *    (or no sort at all) lets adjacent windows overlap and skip, which
 *    produces the same silent data loss the paging was meant to prevent.
 *    Pass a primary key, or a column set that is unique per row.
 */

/** PostgREST's clamp on this project. Asking for more returns this many. */
export const PAGE_SIZE = 1000;

/**
 * Runaway guard. A table that returns full pages forever (a filter that
 * does not narrow, a mis-specified sort) stops here instead of looping
 * until the process runs out of memory.
 */
export const MAX_PAGES = 25;

export interface PagedReadSpec {
  table: string;
  /** Explicit column list. `select('*')` on a wide table is its own tax. */
  columns: string;
  /** Equality filters, applied in order before the sort. */
  filters?: Array<[column: string, value: string | number | boolean]>;
  /**
   * Sort columns, applied in order, ascending. MUST be unique per row —
   * see rule 2 above. A primary key is the safe answer.
   */
  orderBy: string[];
}

export interface PagedReadResult<T> {
  data: T[];
  error: { message: string } | null;
}

/**
 * Read every row matching `spec`, one `PAGE_SIZE` window at a time.
 *
 * Returns `{ data, error }` rather than throwing so callers keep the
 * Supabase-shaped control flow they already have.
 */
export async function readAllPaged<T>(
  supabase: SupabaseClient,
  spec: PagedReadSpec,
): Promise<PagedReadResult<T>> {
  const out: T[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;

    let query = supabase.from(spec.table).select(spec.columns);
    for (const [column, value] of spec.filters ?? []) {
      query = query.eq(column, value);
    }
    for (const column of spec.orderBy) {
      query = query.order(column, { ascending: true });
    }

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error };

    const rows = (data ?? []) as T[];
    out.push(...rows);

    // A short page means the end. An exactly-full page is ambiguous, so
    // go round again and accept one wasted empty read.
    if (rows.length < PAGE_SIZE) return { data: out, error: null };
  }

  return {
    data: out,
    error: {
      message: `${spec.table}: exceeded ${MAX_PAGES} pages (${MAX_PAGES * PAGE_SIZE} rows) while paging`,
    },
  };
}

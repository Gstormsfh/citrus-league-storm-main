import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * PAGED READS, BECAUSE POSTGREST LIES QUIETLY ABOUT UNBOUNDED ONES.
 *
 * PostgREST silently clamps an unbounded `.select()` to the project's
 * `db-max-rows` (1000 here) and answers 200 with a truncated body — no error,
 * no header, no warning. This codebase has been bitten by exactly that: see
 * the field note in `apps/web/src/hooks/usePreloadedPlayers.ts`, where an
 * unpaged `player_directory` read came back at 1000 rows in physical-row
 * order and McDavid was simply absent from the window.
 *
 * `server/src/services/PlayerDashboardService.ts` carries the same helper,
 * privately, and its long header comment is the canonical write-up of why.
 * This module is a SECOND copy on purpose, not an oversight: retrofitting a
 * 951-line service that shipped one commit ago, on a branch about scores, is
 * the kind of unrelated change the repo's own git workflow tells you not to
 * make inline. The two should be merged — into this module — in a follow-up
 * whose diff is only that.
 *
 * `orderBy` is REQUIRED and must be unique per row. Postgres guarantees no
 * stable row order across separate LIMIT/OFFSET queries, so paging on a
 * non-unique sort duplicates rows in one window and skips them in the next —
 * the precise failure this helper exists to prevent.
 */

const PAGE_SIZE = 1000;

/** Guard against a pathological loop if a table ever returns full pages forever. */
const MAX_PAGES = 25;

export interface PagedRead {
  table: string;
  columns: string;
  /** Equality filters, applied in order before the sort. */
  filters?: Array<[column: string, value: string | number | boolean]>;
  /** `IN (...)` filters, applied after the equality filters. */
  inFilters?: Array<[column: string, values: Array<string | number>]>;
  /** Inclusive lower / upper bounds, applied after the `IN` filters. */
  rangeFilters?: Array<[column: string, op: 'gte' | 'lte', value: string | number]>;
  /**
   * Sort columns, applied in order. Pass a key that is UNIQUE per row — a
   * primary key, or a tuple that is one. Anything less and two adjacent
   * windows can overlap or skip.
   */
  orderBy: string[];
  /**
   * Hard ceiling on returned rows. Reached ⇒ `truncated: true`, and the
   * caller must say so on the wire; a silently-clipped list is the same lie
   * as a silently-clamped one.
   */
  maxRows?: number;
}

export interface PagedResult<T> {
  data: T[];
  error: { message: string } | null;
  truncated: boolean;
}

export async function pagedSelect<T>(
  supabase: SupabaseClient,
  read: PagedRead,
): Promise<PagedResult<T>> {
  const out: T[] = [];
  const cap = read.maxRows ?? Infinity;

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    let query = supabase.from(read.table).select(read.columns);
    for (const [column, value] of read.filters ?? []) query = query.eq(column, value);
    for (const [column, values] of read.inFilters ?? []) query = query.in(column, values);
    for (const [column, op, value] of read.rangeFilters ?? []) {
      query = op === 'gte' ? query.gte(column, value) : query.lte(column, value);
    }
    for (const column of read.orderBy) query = query.order(column, { ascending: true });

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error, truncated: false };

    const rows = (data ?? []) as T[];
    out.push(...rows);

    if (out.length >= cap) {
      return {
        data: out.slice(0, cap),
        error: null,
        truncated: out.length > cap || rows.length === PAGE_SIZE,
      };
    }
    // A short page means the end. An exactly-full page is ambiguous, so go
    // round again and accept one wasted empty read.
    if (rows.length < PAGE_SIZE) return { data: out, error: null, truncated: false };
  }

  return {
    data: out,
    error: { message: `${read.table}: exceeded ${MAX_PAGES} pages (${MAX_PAGES * PAGE_SIZE} rows) while paging` },
    truncated: false,
  };
}

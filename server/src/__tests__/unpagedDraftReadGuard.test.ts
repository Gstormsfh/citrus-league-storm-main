/**
 * UNPAGED-READ GUARD (2026-09-03).
 *
 * PostgREST clamps EVERY unbounded `.select()` at the project's
 * `db-max-rows` (1,000 here) and answers HTTP 200 with a short body.
 * No error, no warning, nothing in the response that distinguishes a
 * truncated answer from a complete one. `server/src/lib/pagedRead.ts`
 * lists the four times this repo has already shipped that bug.
 *
 * Four more were found on the draft-engine boot/recovery paths:
 *
 *   1. `LobbyRegistry.performBootScan`      leagues, draft_status=in_progress
 *   2. `OrphanedDraftScanner.scan`          leagues, draft_status=in_progress
 *   3. `DraftServiceV2.listDraftEvents`     draft_events, full replay
 *   4. `scheduled.ts` matchup-sweep         leagues, draft_status=completed
 *      + `scheduled.ts` waiver-process      waiver_claims, status=pending
 *
 * (1) and (2) mean that past 1,000 concurrent in-progress drafts some
 * drafts are never resumed. (3) is worse: the replay is ordered by
 * `seq` ASC, so the clamp drops the NEWEST events and the lobby
 * rebuilds a board that is missing its most recent picks.
 *
 * WHAT THIS FILE PINS. For each watched (file, table) pair, every
 * Supabase read of that table must be BOUNDED: paged through the
 * shared helper, or explicitly limited (`.limit`, `.single`,
 * `.maybeSingle`, `.range`). A bare `.from(t).select(...)` chain with
 * no bound is the defect shape and fails here.
 *
 * The detector is exercised against synthetic good AND bad sources
 * below, so a regex that silently stops matching cannot leave this
 * suite green forever.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf-8');

/** Anything that makes a PostgREST read bounded rather than clamped. */
const BOUNDS = ['.range(', '.limit(', '.single(', '.maybeSingle(', '.csv('];

/**
 * Every UNBOUNDED read of `table` in `source`.
 *
 * Walks from each `.from('<table>')` to the end of that statement (the
 * next `;` at or after the chain) and reports the chain when it selects
 * rows without any of `BOUNDS`. Statement-scoped on purpose: a file is
 * allowed to hold a bounded read of the same table right next to a
 * paged one, which `scheduled.ts` and `DraftServiceV2.ts` both do.
 */
function unboundedReads(source: string, table: string): string[] {
  const marker = `.from('${table}')`;
  const found: string[] = [];
  let at = source.indexOf(marker);
  while (at !== -1) {
    const end = source.indexOf(';', at);
    const stmt = end === -1 ? source.slice(at) : source.slice(at, end + 1);
    // `.insert(...).select()` and friends return the written rows; they
    // are bounded by the payload, not by db-max-rows.
    const isWrite = ['.insert(', '.update(', '.upsert(', '.delete('].some((w) =>
      stmt.includes(w),
    );
    if (
      stmt.includes('.select(') &&
      !isWrite &&
      !BOUNDS.some((b) => stmt.includes(b))
    ) {
      found.push(stmt.replace(/\s+/g, ' ').trim());
    }
    at = source.indexOf(marker, at + marker.length);
  }
  return found;
}

// --- The detector has to bite -------------------------------------
//
// Each BAD sample below is the literal shape of the code as it stood
// before this fix. If the detector stops flagging these, every
// assertion further down is vacuous.

describe('the unbounded-read detector still detects', () => {
  const BAD_BOOT_SCAN = `
      const { data, error } = await (supabaseAdmin.from('leagues') as any)
        .select('id')
        .eq('draft_status', 'in_progress');
  `;
  const BAD_EVENT_REPLAY = `
    let query = this.supabase
      .from('draft_events')
      .select('id, league_id, seq, event_type')
      .eq('league_id', leagueId)
      .order('seq', { ascending: true });
  `;
  const BAD_WAIVER_SWEEP = `
    const { data: pending } = await admin
      .from('waiver_claims')
      .select('league_id')
      .eq('status', 'pending');
  `;

  it('flags the boot scan exactly as it was written before the fix', () => {
    expect(unboundedReads(BAD_BOOT_SCAN, 'leagues')).toHaveLength(1);
  });

  it('flags the unpaged draft_events replay', () => {
    expect(unboundedReads(BAD_EVENT_REPLAY, 'draft_events')).toHaveLength(1);
  });

  it('flags the unpaged pending-waiver population read', () => {
    expect(unboundedReads(BAD_WAIVER_SWEEP, 'waiver_claims')).toHaveLength(1);
  });

  it('does NOT flag a read that carries an explicit bound', () => {
    const single = `
      const { data } = await admin.from('leagues')
        .select('waiver_type').eq('id', leagueId).single();
    `;
    const limited = `
      const { data } = await admin.from('waiver_claims')
        .select('id, league_id').in('status', ['failed']).limit(500);
    `;
    const ranged = `
      const { data } = await supabase.from('draft_events')
        .select('seq').eq('league_id', id).range(0, 999);
    `;
    expect(unboundedReads(single, 'leagues')).toEqual([]);
    expect(unboundedReads(limited, 'waiver_claims')).toEqual([]);
    expect(unboundedReads(ranged, 'draft_events')).toEqual([]);
  });

  it('does NOT flag a write that returns its own rows', () => {
    const write = `
      const { data } = await supabase.from('leagues')
        .update({ draft_status: 'completed' }).eq('id', id).select('id');
    `;
    expect(unboundedReads(write, 'leagues')).toEqual([]);
  });

  it('reports one entry per offending statement, not one per file', () => {
    expect(unboundedReads(BAD_BOOT_SCAN + BAD_BOOT_SCAN, 'leagues')).toHaveLength(2);
  });
});

// --- The real source files -----------------------------------------

const WATCHED: Array<{ file: string; table: string; why: string }> = [
  {
    file: 'draft/LobbyRegistry.ts',
    table: 'leagues',
    why: 'performBootScan resumes every in_progress draft at engine start',
  },
  {
    file: 'draft/orphanedDraftScanner.ts',
    table: 'leagues',
    why: 'the orphan scanner is the last line of defence for an evicted lobby',
  },
  {
    file: 'services/DraftServiceV2.ts',
    table: 'draft_events',
    why: 'seq-ordered replay: a clamp drops the NEWEST events',
  },
  {
    file: 'routes/scheduled.ts',
    table: 'leagues',
    why: 'the matchup sweep population only ever grows',
  },
  {
    file: 'routes/scheduled.ts',
    table: 'waiver_claims',
    why: 'pending claims decide which leagues get their waivers run at all',
  },
];

describe('no unbounded Supabase read on the draft boot/recovery paths', () => {
  for (const { file, table, why } of WATCHED) {
    it(`${file} reads ${table} with a bound (${why})`, () => {
      const offenders = unboundedReads(read(file), table);
      expect(
        offenders,
        `${file}: unbounded read of '${table}'. PostgREST clamps this at ` +
          `1000 rows and returns HTTP 200. Route it through readAllPaged / ` +
          `pagedSelect, or add an explicit bound. Offending chain(s):\n` +
          offenders.join('\n'),
      ).toEqual([]);
    });
  }
});

// --- The replacements are the right replacements --------------------
//
// "No unbounded read" is satisfied by deleting the query too. These
// pin that the paged read is actually there, on the same filter, with
// a sort that is unique per row (the paging contract's rule 2: a
// non-unique sort lets adjacent windows overlap and skip, which is the
// same silent data loss paging was meant to prevent).

describe('the in_progress league scans page on the primary key', () => {
  for (const file of ['draft/LobbyRegistry.ts', 'draft/orphanedDraftScanner.ts']) {
    it(`${file} scans via readAllPaged, filter and sort intact`, () => {
      const src = read(file);
      expect(src).toContain("import { readAllPaged } from '../lib/pagedRead';");
      expect(src).toContain("table: 'leagues',");
      expect(src).toContain("filters: [['draft_status', 'in_progress']],");
      // `id` is the leagues primary key. Paging on anything non-unique
      // reintroduces the skip this fix removed.
      expect(src).toContain("orderBy: ['id'],");
    });
  }
});

describe('the draft_events replay pages in seq order', () => {
  const src = read('services/DraftServiceV2.ts');

  it('listDraftEvents goes through pagedSelect', () => {
    expect(src).toContain("import { pagedSelect } from '../lib/pagedSelect';");
    expect(src).toContain("table: 'draft_events',");
    expect(src).toContain("filters: [['league_id', leagueId]],");
  });

  it('keeps seq ASC, the only ordering bootstrap can replay', () => {
    // Bootstrap applies events in seq order and tracks lastAppliedSeq.
    // Any other sort corrupts the replay regardless of paging.
    expect(src).toContain("orderBy: ['seq'],");
  });

  it('keeps the sinceSeq cursor EXCLUSIVE', () => {
    // The predicate it replaced was `.gt('seq', sinceSeq)`. `gte` here
    // would re-apply the last event the lobby already consumed.
    expect(src).toContain("[['seq', 'gt', sinceSeq]]");
    expect(src).not.toContain("[['seq', 'gte', sinceSeq]]");
  });
});

describe('the scheduled sweeps page their league populations', () => {
  const src = read('routes/scheduled.ts');

  it('matchup-sweep pages the completed-league population', () => {
    expect(src).toContain("import { readAllPaged } from '../lib/pagedRead';");
    expect(src).toContain("filters: [['draft_status', 'completed']],");
  });

  it('waiver-process pages the pending-claim population', () => {
    expect(src).toContain("table: 'waiver_claims',");
    expect(src).toContain("filters: [['status', 'pending']],");
    // id is the waiver_claims primary key and must be SELECTED, not just
    // sorted on, so the page key is visible in the returned rows.
    expect(src).toContain("columns: 'id, league_id',");
  });
});

// --- The eviction path must not swallow its shutdown error ----------
//
// This catch used to log at `debug` with the error explicitly discarded
// (`void err;`). `debug` is dropped outright under the default
// LOG_LEVEL=INFO, so a lobby whose shutdown threw left no trace at all
// while its timers stayed armed.

describe('idle eviction reports a failed shutdown', () => {
  const src = read('draft/LobbyRegistry.ts');

  it('carries the error at a level that is actually emitted', () => {
    const at = src.indexOf('registry.idle_eviction_shutdown_threw');
    expect(at, 'idle-eviction shutdown catch not found').toBeGreaterThan(-1);
    const block = src.slice(at - 200, at + 300);
    expect(block).toContain('structuredLogger.warn');
    expect(block).toContain('err: err instanceof Error ? err.message : String(err)');
  });

  it('never re-introduces the discard', () => {
    expect(src).not.toContain('void err;');
  });
});

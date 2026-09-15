/**
 * FEATURE FLAGS.
 *
 * `FEATURE_PRACTICE_DRAFT` was written on 2026-08-09 for a server-side
 * practice-league mode that did not exist; on 2026-09-03 it was flipped on
 * and pointed at the only practice surface there was, the client-side Mock
 * Draft Simulator, with a tripwire test that failed the moment a real
 * practice-league service landed, so the flag's contract would be re-read
 * before the same boolean started creating league rows.
 *
 * THE MOCK DRAFT IS A REAL DRAFT (2026-09-14): that service landed, and the
 * tripwire did its job. The flag now gates the real thing — the League HQ
 * entry to /mock-draft, which creates a throwaway league (settings.practice)
 * and opens the live V2 room with AI in every other seat — and these tests
 * pin the guardrails the design demanded before that was allowed:
 *
 *   * the server path exists and is the one path (PracticeDraftService);
 *   * practice leagues are filtered out of the user's league list;
 *   * the deploy freeze gate and a nightly sweep know about them (the
 *     migration exists);
 *   * the room never claims a mock as the user's active league;
 *   * the guest simulator remains public, for the marketing pages that
 *     promise "no account needed", and no signed-in surface points at it.
 *
 * Same idiom as the other source-contract guards: walk the source, extract
 * the fact, fail loudly.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_PRACTICE_DRAFT } from '../featureFlags';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = resolve(HERE, '../..').replace(/\\/g, '/');
const REPO = resolve(SRC, '../../..').replace(/\\/g, '/');
const SERVER_SRC = `${REPO}/server/src`;

const MOCK_TARGET = '/mock-draft?league=${leagueId}';
const SIMULATOR = '/armchair-gm?tab=mockdraft';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

const read = (abs: string) => readFileSync(abs, 'utf8');
/** Source with comments stripped, so a note about the old world is not read as code. */
const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');
const rel = (root: string) => (abs: string) => abs.slice(root.length + 1);

const WEB_FILES = walk(SRC);
const SERVER_FILES = walk(SERVER_SRC);

describe('FEATURE_PRACTICE_DRAFT', () => {
  it('is on for launch', () => {
    // The ritual ships. Turning it off is a deliberate one-line change that
    // updates this line with it, not a default that quietly went stale.
    expect(FEATURE_PRACTICE_DRAFT).toBe(true);
  });

  it('is read by League HQ, and by nothing else', () => {
    expect(WEB_FILES.length, 'the source walk found no files').toBeGreaterThan(100);
    const consumers = WEB_FILES.filter(
      (f) => !f.endsWith('/lib/featureFlags.ts') && read(f).includes('FEATURE_PRACTICE_DRAFT'),
    ).map(rel(SRC));
    expect(
      consumers,
      'the consumer list changed: update the WHAT IT GATES paragraph in lib/featureFlags.ts with it',
    ).toEqual(['pages/LeagueDashboard.tsx']);
  });

  it('gates the HQ entry to the real mock draft, scoped to the league, and nothing renders it un-gated', () => {
    const hq = read(`${SRC}/pages/LeagueDashboard.tsx`);
    const targets = [...hq.matchAll(new RegExp(MOCK_TARGET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((m) => m.index!);
    expect(targets.length, 'one practice entry per screen').toBe(2);
    for (const at of targets) {
      const gateAt = hq.lastIndexOf('FEATURE_PRACTICE_DRAFT &&', at);
      expect(gateAt, 'every practice entry is gated').toBeGreaterThan(-1);
      expect(at - gateAt, 'the entry sits inside the gated block').toBeLessThan(1500);
    }
    expect(hq).toContain('<Link to={`' + MOCK_TARGET + '`}>');
    expect(hq).not.toContain(SIMULATOR);
  });

  it('no signed-in surface points at the guest simulator any more', () => {
    for (const f of ['components/Navbar.tsx', 'components/pressbox/leagueMenuTiles.ts', 'pages/LeagueDashboard.tsx', 'components/league/LeagueHQPhone.tsx']) {
      expect(read(`${SRC}/${f}`), f).not.toContain(SIMULATOR);
    }
  });

  it('the guest simulator still cannot write: React state and one player read', () => {
    const sim = code(read(`${SRC}/components/armchair-gm/MockDraftSimulator.tsx`));
    const dataImports = [...sim.matchAll(/from '(@\/(?:services|api|integrations)\/[^']+)'/g)].map((m) => m[1]);
    expect(new Set(dataImports)).toEqual(new Set(['@/services/PlayerService']));
    expect(sim).toMatch(/PlayerService\.getAllPlayers\(\)/);
    expect(sim).not.toMatch(/\.(insert|upsert|update|delete|rpc)\(/);
    expect(sim).not.toMatch(/supabase/i);
  });

  it('the real practice mode exists, in one place, with its guardrails', () => {
    expect(SERVER_FILES.length, 'the server walk found no files').toBeGreaterThan(50);
    const creators = SERVER_FILES.filter((f) => /buildPracticeLeaguePayload/.test(code(read(f)))).map(rel(REPO));
    expect(creators, 'one server path creates practice leagues').toEqual(['server/src/services/PracticeDraftService.ts']);
    // The list filter: practice leagues never appear as one of the user's leagues.
    expect(code(read(`${SERVER_SRC}/services/LeagueService.ts`))).toMatch(/!isPracticeLeagueSettings\(/);
    // The freeze gate and the sweep: a migration that names both.
    const migrations = readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith('.sql'));
    const gate = migrations.find((f) => /practice/.test(f));
    expect(gate, 'a migration teaches the freeze gate about practice leagues').toBeTruthy();
    const sql = read(`${REPO}/supabase/migrations/${gate}`);
    expect(sql).toContain("settings ->> 'practice'");
    expect(sql).toContain('draft_freeze_blockers');
    expect(sql).toContain('sweep_practice_leagues');
    // The client never calls the factory itself; the server owns the row.
    const web = WEB_FILES.filter((f) => /buildPracticeLeaguePayload/.test(code(read(f)))).map(rel(SRC));
    expect(web).toEqual([]);
  });
});

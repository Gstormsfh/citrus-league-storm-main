/**
 * FEATURE FLAGS (2026-09-03, launch).
 *
 * `FEATURE_PRACTICE_DRAFT` was written on 2026-08-09 with its consumer
 * deferred "until the Sunday walk names the button location". The walk never
 * named one, so the flag sat at `false` with nothing reading it, under a
 * comment that described a server-side practice-league mode nobody had
 * built. A flag with no reader is a claim, not a switch, and a flag whose
 * comment describes the wrong feature is worse than no flag: the next person
 * flips it expecting a throwaway league and gets nothing.
 *
 * These tests pin what the flag actually does, in both directions:
 *
 *   * it IS read, by League HQ alone, and the entry it gates goes to the one
 *     practice surface that exists: the client-side Mock Draft Simulator,
 *     which reads the player list and writes nothing;
 *   * it gates NOTHING that writes. The T15 throwaway-league service does not
 *     exist in this repo. If it ever lands, the last test fails on purpose so
 *     the flag's blast radius (zero DB writes today) is re-read before the
 *     same boolean starts creating real league rows. That is the failure
 *     mode DESIGN_T15 §7 argues against, and the argument only holds while
 *     the service is absent.
 *
 * Same idiom as the other source-contract guards: walk the source, extract
 * the fact, fail loudly. The consumer list is pinned exactly, so adding a
 * second reader means updating the flag's own comment and this list in the
 * same diff.
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

const MOCK_TARGET = '/armchair-gm?tab=mockdraft';

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

  it('gates the HQ entry to the public simulator, and nothing renders that target un-gated', () => {
    const hq = read(`${SRC}/pages/LeagueDashboard.tsx`);
    // PRESS BOX (2026-09-04): the target appears twice in the SOURCE — the
    // desktop card's <Link> and the phone layer's `mock:` entry
    // (LeagueHQPhone) — and a viewer only ever sees one. Each must sit
    // inside its own gate: the nearest `FEATURE_PRACTICE_DRAFT &&` before
    // it, within the same block.
    const targets = [...hq.matchAll(new RegExp(MOCK_TARGET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((m) => m.index!);
    expect(targets.length, 'one practice entry per screen').toBe(2);
    for (const at of targets) {
      const gateAt = hq.lastIndexOf('FEATURE_PRACTICE_DRAFT &&', at);
      expect(gateAt, 'every practice entry is gated').toBeGreaterThan(-1);
      expect(at - gateAt, 'the entry sits inside the gated block').toBeLessThan(1500);
    }
    expect(hq).toContain(`<Link to="${MOCK_TARGET}">`);
  });

  it('points at a surface that cannot write: React state and one player read', () => {
    const sim = code(read(`${SRC}/components/armchair-gm/MockDraftSimulator.tsx`));
    // The only data module it touches is the player read.
    const dataImports = [...sim.matchAll(/from '(@\/(?:services|api|integrations)\/[^']+)'/g)].map((m) => m[1]);
    expect(new Set(dataImports)).toEqual(new Set(['@/services/PlayerService']));
    expect(sim).toMatch(/PlayerService\.getAllPlayers\(\)/);
    // No write verb of any client this app uses, and no client at all.
    expect(sim).not.toMatch(/\.(insert|upsert|update|delete|rpc)\(/);
    expect(sim).not.toMatch(/supabase/i);
  });

  it('gates zero DB writes: the T15 server-side practice league is not in this repo', () => {
    expect(SERVER_FILES.length, 'the server walk found no files').toBeGreaterThan(50);
    const PRACTICE_PATH = /createPracticeLeague|buildPracticeLeaguePayload|isPracticeLeagueSettings/;
    const server = SERVER_FILES.filter((f) => PRACTICE_PATH.test(code(read(f)))).map(rel(REPO));
    const web = WEB_FILES.filter((f) => /buildPracticeLeaguePayload/.test(code(read(f)))).map(rel(SRC));
    expect(
      [...server, ...web],
      [
        'a practice-league creation path now exists. Before it shares FEATURE_PRACTICE_DRAFT:',
        'read the WHAT IT DOES NOT GATE paragraph in lib/featureFlags.ts, clear the',
        'DESIGN_T15 §5 ratification bars, land the §3 aggregation guardrails, and give',
        'the server mode its own flag. This boolean gates a link to a client-side',
        'simulator, and its blast radius is zero DB writes.',
      ].join(' '),
    ).toEqual([]);
  });
});

/**
 * FABRICATION GUARD (2026-08-26).
 *
 * A pre-App-Store sweep found the app asserting things about the world that
 * were not true. Not bugs — invented facts, rendered with the same confidence
 * as the real ones:
 *
 *   - "47,000+ MANAGERS drafting on Citrus this season", with a row of invented
 *     member avatars, on three PUBLIC unauthenticated routes.
 *   - Four podcast episodes, and a "Featured Episode" crediting "three-time
 *     fantasy champion Marcus Johnson" — a named person who does not exist.
 *   - Six blog articles bylined to six invented authors, including an "Injury
 *     Report Updates: What You Need to Know This Week" — the exact kind of
 *     claim a fantasy manager acts on.
 *   - "7 Games Tonight · Puck drops 7pm ET" under the live-pulse dot, on the
 *     production homepage, 34 days before the season opened.
 *   - Four job openings under "Where we're hiring", with an Apply button wired
 *     to nothing.
 *   - Four hardcoded team grades (Offense A-, Defense B, Goalie A, Depth C+),
 *     identical for every team in every league.
 *
 * Every one of these came back to the same root cause: placeholder content
 * written to make a page look finished, then never replaced, and nothing in
 * the build could tell the difference between a fabricated string and a real
 * one. This test can. It is deliberately literal — it matches the exact
 * fictions that shipped, so it fails loudly if any of them return, without
 * pretending to be a general-purpose lie detector.
 *
 * If you are here because this test failed: the fix is not to edit the pattern.
 * It is to delete the invented content, or compute it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(import.meta.url), '..', '..');

const SKIP_DIRS = new Set(['node_modules', '__tests__', 'test', 'dist']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(SRC).map((path) => ({ path: path.slice(SRC.length + 1).replace(/\\/g, '/'), body: readFileSync(path, 'utf8') }));

/**
 * Matches only OUTSIDE comments, so the notes explaining what was removed do
 * not trip the guard that removed it.
 */
function stripComments(body: string): string {
  // Blank out block comments (JSX `{/* */}` included) while preserving line
  // count, then line comments. Without this the notes explaining what was
  // deleted would themselves trip the guard that deleted it.
  const withoutBlocks = body.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, (m) => m.replace(/[^\n]/g, ' '));
  return withoutBlocks
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

function findLive(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const { path, body } of FILES) {
    stripComments(body).split('\n').forEach((code, i) => {
      if (pattern.test(code)) hits.push(`${path}:${i + 1}  ${code.trim().slice(0, 260)}`);
    });
  }
  return hits;
}

describe('no fabricated content', () => {
  it('claims no user count we cannot substantiate', () => {
    expect(findLive(/47[,K]?0?0?0?\+?\s*(managers|MANAGERS|leagues|players|pools|brackets)/i)).toEqual([]);
  });

  it('does not invent named people', () => {
    // The podcast credit and the six blog bylines.
    //
    // The demo league's ten team owners are deliberately exempt. Invented
    // names are only a problem when they are presented as real; the demo
    // league announces itself as a demo on every surface that renders it, and
    // a sample league needs somebody's name on each team.
    const DEMO_DATA = ['services/LeagueService.ts', 'services/DemoLeagueService.ts'];
    const names = /(Marcus Johnson|Alex Johnson|Samantha Lee|Carlos Rodriguez|Taylor Kim|Morgan Williams|Jordan Patel)/;
    const hits = findLive(names).filter((h) => !DEMO_DATA.some((d) => h.startsWith(d)));
    expect(hits).toEqual([]);
  });

  it('does not assert a live NHL slate from a hardcoded string', () => {
    expect(findLive(/\d+\s+Games Tonight/i)).toEqual([]);
  });

  it('does not advertise job openings', () => {
    // Owner confirmed 2026-08-26 that no roles are open.
    expect(findLive(/Senior Frontend Engineer|Product Marketing Manager|Data Scientist \(AI\/ML\)/)).toEqual([]);
  });

  it('does not hardcode the team grades that used to be constants', () => {
    // The Power Rankings card. Grades now come from utils/teamGrades.ts.
    // Requires the +/- modifier: a bare single letter in a Badge is a
    // POSITION (C, D, G) all over this app, and a guard that cries wolf on
    // every position chip is a guard somebody deletes.
    const hits = findLive(/<Badge[^>]*>\s*[ABCDF][+-]\s*<\/Badge>/);
    expect(hits).toEqual([]);
  });

  it('claims AI only where an actual model answers', () => {
    // Stormy is a real Claude call. The trade "analysis" is an if/else over
    // real numbers — honest arithmetic, but not a model.
    // Stormy is a real Claude call, so copy that names Stormy may claim it.
    const hits = findLive(/AI-[Pp]owered|AI-driven/).filter(
      (h) => !h.startsWith('services/StormyService.ts') && !/Stormy/.test(h),
    );
    expect(hits).toEqual([]);
  });

  it('does not label a house ad as a sponsor', () => {
    expect(findLive(/label=["']Featured Sponsor["']/)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeadshotUrl } from '@citrus/shared';
import { HARNESS_PLAYERS, harnessHeadshotUrl } from '../../harness/players';

/**
 * Harness fixture guard — real players, real faces (2026-09-02).
 *
 * `harness/README.md` promises "what renders here is what renders in the
 * app". That was false for the most visible element on every row. Measured
 * the same day on the production project:
 *
 *   select count(*), count(headshot_url) from players  ->  801 / 801
 *
 * Every one of those 801 headshots is on the NHL CDN, and the app draws it.
 * The harness drew none of them. Three fixtures set `headshot_url: null`
 * outright (harness/page.tsx, harness/main.tsx, harness/stubs/draftFixtures.ts)
 * and the other six entry points built their players with no face field at
 * all, so `Mug` fell through headshot -> team crest -> initials on EVERY
 * harness surface. Every phone screenshot this repo has produced shows
 * initials discs — a roster the app has never rendered.
 *
 * The names were worse than absent. page.tsx wrapped an 18-name list to 60 by
 * appending a counter ("Connor McDavid 2", "Nathan MacKinnon 2"),
 * draftFixtures.ts did the same to reach 240 ("Cale Makar 3"), and main.tsx
 * numbered its rows outright ("Roster Player 01"). All three put a string no
 * NHL roster can produce where the row's primary read belongs, and all three
 * went out in review screenshots.
 *
 * This guard reads the harness sources off disk and fails if any of that
 * comes back. It also pins the shared roster itself: real 7-digit NHL ids,
 * real 2-3 letter team codes, no duplicate or numbered names, and a first 18
 * that is a startable lineup.
 *
 * NOTE ON THE FALLBACK, so a red run is read correctly: a machine with no
 * route to assets.nhle.com still renders crests or initials, because that is
 * what `Mug` is for. This guard therefore asserts on the SOURCE — the URL the
 * row asks for — and never on a pixel.
 */

const HERE = resolve(fileURLToPath(import.meta.url), '..');
// Posix separators from here down, matching darkThemeContrastGuard.test.ts:
// walk() joins with backslashes on Windows, and REL() is a plain prefix strip.
const WEB = resolve(HERE, '..', '..').replace(/\\/g, '/');
const HARNESS = `${WEB}/harness`;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments so this file's own explanatory notes — several of which
 * quote the defect verbatim, including the literal `headshot_url: null` —
 * do not trip the guards.
 *
 * Differs from darkThemeContrastGuard's `code()` in two ways, both forced by
 * this guard reporting a LINE:
 *
 *   * a block comment is blanked in place rather than deleted, so line
 *     numbers survive the strip and the failure message can point at the
 *     offending line rather than at the file;
 *   * a `//` is only treated as a comment when the character before it is
 *     not a colon, so `https://assets.nhle.com/...` inside a template
 *     literal is not truncated away mid-URL.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/([^:])\/\/.*$/, '$1'))
    .join('\n');
}

const FILES = walk(HARNESS).map((f) => f.replace(/\\/g, '/'));
const REL = (f: string) => f.slice(WEB.length + 1);

/**
 * The value of an object property, given the index just past its colon.
 *
 * Line-scoped and bracket-aware: it stops at the first comma or unmatched
 * closer at depth 0, so `{ id: i + 1, name: p.name }` does not hand the
 * `name` rule the `+` that belongs to `id`. The fixtures write one property
 * per line where it matters, and a value split across lines is out of scope —
 * stated here rather than discovered later.
 */
function propertyValue(line: string, from: number): string {
  let depth = 0;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return line.slice(from, i);
      depth--;
    } else if (c === ',' && depth === 0) return line.slice(from, i);
  }
  return line.slice(from);
}

/** A face field explicitly set to nothing — the exact pre-fix defect. */
const NULLED_FACE = /\b(\w*headshot\w*|image)\s*:\s*(null|undefined)\b/;

/** `name:` / `full_name:` / `player_name:`. `\b` keeps `team_name:` out. */
const NAME_FIELD = /\b(?:full_name|player_name|name)\s*:/g;

/** A template literal that interpolates — `${name} ${tier + 1}`. */
const TEMPLATE_SUBST = /`[^`]*\$\{/;

/** String concatenation — `NAMES[i % NAMES.length] + (…)`. */
const CONCAT = /\+\s*[`'"(]|[`'")\]]\s*\+/;

/**
 * A display label welded to a counter — `Roster Player ${i}`. Caught
 * wherever it appears, not just in a name field, because the shape IS the
 * defect: no NHL player is called "Player 01".
 */
const NUMBERED_PERSON =
  /`[^`]*\b(?:Player|Skater|Goalie|Forward|Defender|Defenceman|Prospect|Rookie|Winger|Centre|Center)\s+\$\{/i;

/**
 * Every offender one file's source contains, as `path:line — why`.
 *
 * Extracted so the rules below and the "does this guard actually bite" test
 * run the same code. A guard whose detector is only ever exercised by the
 * codebase passing it is a guard that could be matching nothing at all.
 */
function fixtureOffenders(rel: string, src: string): string[] {
  const out: string[] = [];
  code(src)
    .split('\n')
    .forEach((line, i) => {
      const at = `${rel}:${i + 1}`;
      if (NULLED_FACE.test(line)) out.push(`${at} — face field set to nothing: ${line.trim()}`);
      if (NUMBERED_PERSON.test(line)) out.push(`${at} — name built from a counter: ${line.trim()}`);
      for (const m of line.matchAll(NAME_FIELD)) {
        const value = propertyValue(line, m.index! + m[0].length);
        if (TEMPLATE_SUBST.test(value) || CONCAT.test(value)) {
          out.push(`${at} — name built from an expression:${value}`);
          // One report per line. `full_name: tier === 0 ? name : \`…\`` has a
          // second `name:` inside the ternary; the first match already carries
          // the whole value, so a second entry is the same defect twice.
          break;
        }
      }
    });
  return out;
}

describe('harness fixtures render real players with real faces', () => {
  it('the walk actually found the harness sources', () => {
    // A wrong prefix here would make every rule below pass on an empty list.
    expect(FILES.length, `no harness sources under ${HARNESS}`).toBeGreaterThan(10);
    expect(FILES.map(REL)).toContain('harness/page.tsx');
    expect(FILES.map(REL)).toContain('harness/stubs/draftFixtures.ts');
  });

  it('no harness fixture nulls a face or synthesises a name', () => {
    const offenders: string[] = [];
    for (const f of FILES) offenders.push(...fixtureOffenders(REL(f), readFileSync(f, 'utf8')));
    expect(
      offenders,
      `harness fixtures that do not render what the app renders:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the rules bite: the pre-fix source is caught, the post-fix source is not', () => {
    // The three lines below are the defect verbatim, copied off the parent
    // commit (bcb60477). Without this, deleting a rule or breaking an anchor
    // would leave a permanently-green test guarding nothing.
    expect(fixtureOffenders('page.tsx', '    headshot_url: null, last_updated: null,')).toEqual([
      'page.tsx:1 — face field set to nothing: headshot_url: null, last_updated: null,',
    ]);
    expect(
      fixtureOffenders(
        'page.tsx',
        '    full_name: NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : \'\'),',
      ),
    ).toEqual([
      'page.tsx:1 — name built from an expression: NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : \'\')',
    ]);
    expect(
      fixtureOffenders('main.tsx', '    full_name: `Roster Player ${String(i + 1).padStart(2, \'0\')}`,'),
    ).toEqual([
      'main.tsx:1 — name built from a counter: full_name: `Roster Player ${String(i + 1).padStart(2, \'0\')}`,',
      'main.tsx:1 — name built from an expression: `Roster Player ${String(i + 1).padStart(2, \'0\')}`',
    ]);
    expect(
      fixtureOffenders('draftFixtures.ts', '    full_name: tier === 0 ? name : `${name} ${tier + 1}`,'),
    ).toEqual([
      'draftFixtures.ts:1 — name built from an expression: tier === 0 ? name : `${name} ${tier + 1}`',
    ]);

    // Line numbers are real, not always 1.
    expect(fixtureOffenders('x.ts', 'const a = 1;\nconst b = 2;\n  image: null,')).toEqual([
      'x.ts:3 — face field set to nothing: image: null,',
    ]);

    // ...and the shapes the fix actually shipped are clean.
    expect(fixtureOffenders('players.ts', '  { name: "Connor McDavid", position: \'C\', team: \'EDM\' },')).toEqual([]);
    expect(fixtureOffenders('players.ts', '    full_name: p.name,')).toEqual([]);
    expect(fixtureOffenders('players.ts', '  return { name: p.name, image: harnessHeadshotUrl(p.team, p.nhlId) };')).toEqual([]);
    expect(fixtureOffenders('page.tsx', '  return { id: i + 1, name: p.name, position: p.position };')).toEqual([]);
    expect(fixtureOffenders('players.ts', 'export function harnessPlayer(name: string): HarnessPlayer {')).toEqual([]);
    // Team and owner labels are not player identities; `\b` has to keep them out.
    expect(fixtureOffenders('page.tsx', '  team_name: `Team ${i + 1}`, owner_name: `Owner ${i + 1}`,')).toEqual([]);
    // A comment quoting the defect is documentation, not a defect.
    expect(fixtureOffenders('page.tsx', '// this file used to set headshot_url: null on every row')).toEqual([]);
    expect(fixtureOffenders('page.tsx', '/* it wrapped the list with `${name} ${tier + 1}` */')).toEqual([]);
    // A URL is not a comment.
    expect(
      fixtureOffenders('players.ts', '  return `https://assets.nhle.com/mugs/nhl/${s}/${team}/${id}.png`;'),
    ).toEqual([]);
  });

  it('every entry point that renders a player sources it from harness/players.ts', () => {
    // Named rather than inferred: an entry point that stops importing the
    // shared roster is exactly how a hand-typed fixture gets back in, and it
    // leaves no other trace a text scan can see. scoreboard.tsx and tabs.tsx
    // are absent on purpose — neither renders a player.
    const PLAYER_BEARING = [
      'harness/page.tsx',
      'harness/main.tsx',
      'harness/cards.tsx',
      'harness/today.tsx',
      'harness/slot.tsx',
      'harness/matchup.tsx',
      'harness/analytics.tsx',
      'harness/advanced.tsx',
      'harness/stubs/draftFixtures.ts',
    ];
    const offenders: string[] = [];
    for (const rel of PLAYER_BEARING) {
      const f = FILES.find((x) => REL(x) === rel);
      if (!f) {
        offenders.push(`${rel} — listed here but not on disk`);
        continue;
      }
      if (!/from '\.\.?\/players'/.test(readFileSync(f, 'utf8'))) {
        offenders.push(`${rel} — builds players without importing the shared roster`);
      }
    }
    expect(offenders, `harness entry points off the shared roster:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('the shared harness roster', () => {
  it('is 60 players with no duplicate and no numbered name', () => {
    expect(HARNESS_PLAYERS).toHaveLength(60);

    const seen = new Map<string, number>();
    const offenders: string[] = [];
    HARNESS_PLAYERS.forEach((p, i) => {
      const first = seen.get(p.name);
      if (first !== undefined) offenders.push(`[${i}] "${p.name}" duplicates [${first}]`);
      else seen.set(p.name, i);
      // A trailing digit is the fingerprint of the counter this branch
      // removed — "Connor McDavid 2" is what the fixtures used to ship.
      if (/\d\s*$/.test(p.name)) offenders.push(`[${i}] "${p.name}" ends in a digit`);
    });
    expect(offenders, `harness roster names:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('carries a real 7-digit NHL id and a real team code for every player', () => {
    const offenders: string[] = [];
    for (const p of HARNESS_PLAYERS) {
      // NHL player ids are 7 digits (8471214 Ovechkin .. 8485366 Schaefer).
      // Half of the headshot URL is this id; a wrong one is a silent 404 and
      // a row that falls back to a crest for a reason nobody can see.
      if (!/^\d{7}$/.test(p.nhlId)) offenders.push(`${p.name}: nhlId "${p.nhlId}" is not 7 digits`);
      if (!/^[A-Z]{2,3}$/.test(p.team)) offenders.push(`${p.name}: team "${p.team}" is not a 2-3 letter code`);
    }
    expect(offenders, `harness roster ids and teams:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('builds every face at the URL production stores', () => {
    // `getHeadshotUrl` in @citrus/shared is what PlayerService puts on every
    // real row. Asserting equality — not just a shape — is what makes "the
    // harness asks for the same picture the app asks for" a fact rather than
    // a claim.
    const offenders: string[] = [];
    for (const p of HARNESS_PLAYERS) {
      const ours = harnessHeadshotUrl(p.team, p.nhlId);
      const theirs = getHeadshotUrl(p.team, p.nhlId);
      if (ours !== theirs) offenders.push(`${p.name}: ${ours} !== ${theirs}`);
    }
    expect(offenders, `harness headshot URLs diverged from production:\n${offenders.join('\n')}`).toEqual([]);
    expect(harnessHeadshotUrl('EDM', '8478402')).toBe(
      'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png',
    );
  });

  it('opens with a legal 18-man roster', () => {
    // Every entry point that slices the head of the list gets a startable
    // lineup. A fixture that cannot be started is one nobody reviews twice.
    const counts: Record<string, number> = {};
    for (const p of HARNESS_PLAYERS.slice(0, 18)) counts[p.position] = (counts[p.position] ?? 0) + 1;
    expect(counts).toEqual({ C: 5, LW: 3, RW: 3, D: 5, G: 2 });
  });
});

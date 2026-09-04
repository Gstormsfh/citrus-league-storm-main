/**
 * SCORES ARCHITECTURE GUARD (2026-09-03).
 *
 * The Scores screen borrowed its information architecture from theScore,
 * ESPN and the CBS Sports NHL scoreboard, then diverged from them in two
 * places on purpose: a tap expands in place, and the slot those apps give to
 * a betting line goes to Citrus projections. Every one of those decisions was
 * written down, and every one was written down in a COMMENT HEADER:
 * `pages/Scores.tsx` and every file under `components/scores/` carry the
 * reasoning above the code that does it. The two tests the section
 * had (`components/scores/__tests__/ScoreboardGameRow.test.tsx` and
 * `scoresFormat.test.ts`) check what a row is allowed to SAY. Nothing
 * checked the shape. A refactor that hoisted live games into their own
 * section, let two rows expand at once, or dropped a moneyline into the strip
 * would have failed nothing: a silent-failure surface, in the sense the
 * other guards in this directory exist to close.
 *
 * This file pins the decisions as SOURCE CONTRACTS, the way
 * `playerCardInstantOpenGuard` and `matchupLoadEfficiencyGuard` do: jsdom has
 * no layout engine and no network, so the construct that implements each
 * rule is read out of the source and asserted on. Two habits are taken from
 * `aiVoiceGuard` and `phoneRowTypeScaleGuard`:
 *
 *   * every detector is a pure function on source text and runs twice, once
 *     against the real tree and once against a PLANTED offender, so a
 *     detector that quietly matches nothing cannot keep the suite green;
 *   * where a rule is a relationship rather than a value (the score is the
 *     largest type in the row; the poll interval is not shorter than the
 *     client cache that would swallow it) the relationship is what is
 *     pinned, not the number.
 *
 * WHAT IS PINNED, AND THE CONSTRUCT THAT IMPLEMENTS IT (measured on this
 * tree, 2026-09-03, so a failure message can be read against a line):
 *
 *   1. AWAY ON TOP. `ScoreboardGameRow.tsx` renders exactly two `<TeamLine>`
 *      elements, `team={game.away}` first (lines 126-137), and the row's
 *      aria-label is spoken in the same order, "away at home" (line 121).
 *      The score span is `font-varsity text-xl ... text-right` (line 81)
 *      against a `text-sm` name (line 71) and a `text-[10px]` status
 *      (line 145): the largest type in the row belongs to the score.
 *   2. ONE STATUS COLUMN. The row renders `{status}` once (line 149), from
 *      `rowStatusText(game)` (line 103), which defers to `gameStateLabel`
 *      imported from @citrus/shared (`scoresFormat.ts` lines 8-15, 33). The
 *      row never calls `gameStateLabel` itself, and no file under `scores/`
 *      keeps its own table of status words. The vocabulary the sweep bans is
 *      built by CALLING `gameStateLabel`, so it follows the shared function.
 *      One literal is measured and quarantined: the `'Scheduled'` fallback
 *      for a game with no puck drop (`scoresFormat.ts` line 31). It says the
 *      same word `gameStateLabel('scheduled')` says and should come from it;
 *      the fix is a one-line diff in a file this pass did not own, and the
 *      quarantine below may only shrink.
 *   3. LIVE STAYS INLINE. `ScoresList.tsx` has one `games.map(...)` and no
 *      `.filter`, no heading, no section (lines 26-40). The page filters on
 *      `state === 'live'` exactly once and only to count for the subtitle
 *      (`Scores.tsx` line 81); the whole ordered list goes to one
 *      `<ScoresList games={games}>` (lines 147-152), ordered once per fetch
 *      by `useMemo(..., [data])` (line 79). Live is marked in the row by a
 *      ring (line 114) and a pulse (line 142), not by a move.
 *   4. ONE ROW OPEN. The expansion state is `useState<number | null>` in
 *      `Scores.tsx` (line 54), toggled with `current === gameId ? null :
 *      gameId` (line 84), cleared on a date change (line 58), and
 *      `ScoresList` accepts `expandedGameId: number | null` (line 20) and
 *      mounts the detail panel only for that id (lines 34-36). Not a Set,
 *      not an array.
 *   5. PROJECTIONS, NOT ODDS. No code under `scores/`, in the page, or in
 *      `api/scores.ts` reads `moneyline_*`, `implied_win_probability_*`,
 *      `over_under`, `*_spread` or `bookmaker` (the only mentions are the
 *      header comments that explain WHY, and comments are stripped before
 *      the scan). `CitrusRowStrip.tsx` reads `projectedPoints` (lines 71,
 *      77) and `confidenceLabel` (lines 80, 82) and titles itself
 *      'Citrus projections' (line 102).
 *   6. NOTHING INVENTED. The strip returns null with no projection
 *      (`CitrusRowStrip.tsx` line 94) and never renders "0 projected"; the
 *      summary line is '' with no projection (`scoresFormat.ts` line 99)
 *      and the row omits the element (row line 167). The detail panel prints
 *      a stat line only inside `{a ? (` where `a = player.actuals`
 *      (`GameDetailPanel.tsx` lines 50, 80-86) and leads with the actual
 *      only when `actualPoints !== null` (line 94); nothing under `scores/`
 *      zero-fills `actualPoints`, `projectedPoints` or `actuals`. Venue
 *      renders only inside `{venue ? (` (lines 172-174); the row never
 *      reads it.
 *   7. POLLING. `LIVE_POLL_MS = 20_000` (`Scores.tsx` line 45) and
 *      `refetchInterval` is a PREDICATE that returns the interval only while
 *      `games.some((g) => g.state === 'live')` and `false` otherwise (lines
 *      71-72). The relationship: the interval is not shorter than
 *      `CACHE_TTL.SHORT`, the client cache `api/scores.ts` wraps the day
 *      read in (lines 50-55), because a poll inside that window is answered
 *      from cache and polls nothing.
 *   8. A STRIP, NOT A PICKER. `ScoresDateStrip.tsx` renders a `role="tablist"`
 *      container that is `flex ... overflow-x-auto ... snap-x` (line 64),
 *      cells that are `flex-shrink-0 snap-center` (line 79), scrolls the
 *      selected cell into view (line 32), and contains no date input, no
 *      select, no calendar, popover or dialog. The page pins it under the
 *      header with `sticky top-0` (`Scores.tsx` lines 116-118).
 *
 * House voice rule: no em dashes anywhere in this file, including planted
 * fixtures.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameStateLabel, type GameState } from '@citrus/shared';
import { CACHE_TTL } from '@/api/cache';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');

const FILES = {
  page: 'pages/Scores.tsx',
  row: 'components/scores/ScoreboardGameRow.tsx',
  list: 'components/scores/ScoresList.tsx',
  strip: 'components/scores/CitrusRowStrip.tsx',
  detail: 'components/scores/GameDetailPanel.tsx',
  dateStrip: 'components/scores/ScoresDateStrip.tsx',
  format: 'components/scores/scoresFormat.ts',
  empty: 'components/scores/ScoresEmptyDay.tsx',
  api: 'api/scores.ts',
} as const;

const SCORES_DIR = 'components/scores';

/** Every source file under components/scores, tests excluded, as SRC-relative paths. */
function scoresSources(): string[] {
  return readdirSync(resolve(SRC, SCORES_DIR))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `${SCORES_DIR}/${f}`)
    .sort();
}

// ── Scanner ──────────────────────────────────────────────────────────
//
// A cut-down version of the state machine in aiVoiceGuard: one pass that
// blanks comments out of the source (offsets preserved, so line numbers stay
// honest) and collects every string and template literal with its line. The
// detectors below read `code` when they pin a construct and `strings` when
// they ban a word, and neither can be fooled by a comment that quotes the
// thing being banned, which every header in `scores/` does.

export interface Literal {
  text: string;
  line: number;
  /** Character offset of `text` within the file. */
  start: number;
}

export interface Scanned {
  /** The source with comments blanked to spaces. Strings are kept. */
  code: string;
  strings: Literal[];
}

/** Keywords a string literal may legally follow. Otherwise a quote after a letter is an apostrophe in JSX prose. */
const KEYWORD_BEFORE_STRING = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'await',
  'yield', 'else', 'do', 'instanceof', 'throw', 'from', 'import', 'export',
  'default', 'as', 'extends', 'satisfies',
]);

function opensString(src: string, pos: number, prev: string): boolean {
  if (prev === '>') {
    const arrow = src.lastIndexOf('>', pos);
    return arrow > 0 && src[arrow - 1] === '=';
  }
  if (/[A-Za-z_$]/.test(prev)) {
    let k = pos - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    const end = k + 1;
    while (k >= 0 && /[A-Za-z_$]/.test(src[k])) k--;
    return KEYWORD_BEFORE_STRING.has(src.slice(k + 1, end));
  }
  return !/[0-9)\]}]/.test(prev);
}

/** Index just past the string literal opening at `i`. */
function skipString(src: string, i: number): number {
  const q = src[i];
  i++;
  while (i < src.length && src[i] !== q && src[i] !== '\n') {
    if (src[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

/** Index just past the template literal whose backtick is at `i`. */
function skipTemplate(src: string, i: number): number {
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') {
      i = skipExpr(src, i + 2);
      continue;
    }
    i++;
  }
  return i;
}

/** Index just past the `}` that closes an interpolation opened before `i`. */
function skipExpr(src: string, i: number): number {
  let depth = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '`') {
      i = skipTemplate(src, i);
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(src, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

const lineAt = (src: string, idx: number): number => {
  let line = 1;
  for (let k = 0; k < idx && k < src.length; k++) if (src[k] === '\n') line++;
  return line;
};

export function scan(src: string): Scanned {
  const chars = src.split('');
  const strings: Literal[] = [];
  const n = src.length;
  const blank = (a: number, b: number) => {
    for (let k = a; k < b && k < n; k++) if (chars[k] !== '\n') chars[k] = ' ';
  };

  let i = 0;
  // Last significant code character: tells a regex `/` from division and an
  // apostrophe from a string opener.
  let prev = '\n';

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === '/' && c2 === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && c2 === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if ((c === '"' || c === "'") && opensString(src, i, prev)) {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      strings.push({ text: src.slice(i + 1, j), line: lineAt(src, i), start: i + 1 });
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let chunkStart = j;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '$' && src[j + 1] === '{') {
          strings.push({ text: src.slice(chunkStart, j), line: lineAt(src, chunkStart), start: chunkStart });
          // The interpolation is scanned, not skipped, so a literal nested in
          // a ternary inside a template is still seen.
          const exprStart = j + 2;
          const after = skipExpr(src, exprStart);
          const inner = scan(src.slice(exprStart, after - 1));
          for (const s of inner.strings) {
            strings.push({ text: s.text, line: lineAt(src, exprStart + s.start), start: exprStart + s.start });
          }
          for (let k = 0; k < inner.code.length; k++) {
            if (inner.code[k] === ' ' && src[exprStart + k] !== ' ') chars[exprStart + k] = ' ';
          }
          j = after;
          chunkStart = j;
          continue;
        }
        if (src[j] === '`') break;
        j++;
      }
      strings.push({ text: src.slice(chunkStart, j), line: lineAt(src, chunkStart), start: chunkStart });
      i = j + 1;
      prev = '`';
      continue;
    }
    // A regex literal is skipped whole so a `//` inside it cannot open a
    // comment. `<` and `>` are deliberately absent from the set: `</span>`
    // is a closing tag, not a regex.
    if (c === '/' && /[(,=:[!&|?{};+\n*%~^-]/.test(prev)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) {
          closed = true;
          break;
        } else if (src[j] === '\n') break;
        j++;
      }
      if (closed) {
        i = j + 1;
        prev = '/';
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }

  return { code: chars.join(''), strings };
}

export const codeOf = (src: string): string => scan(src).code;
export const literalsOf = (src: string): Literal[] => scan(src).strings.filter((s) => s.text.length > 0);

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

/**
 * The end of the JSX opening tag that starts at `start`: the first `>` at
 * brace depth 0 that is not the tail of an arrow, so `onClick={() => x}`
 * inside the tag does not end it early.
 */
function tagEnd(code: string, start: number): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && code[i - 1] !== '=') return i;
  }
  return code.length;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Start and end of the opening tag of the element whose first child is
 * `marker`, as `[indexOfTagStart, indexOfMarker]`. A `${marker}` inside a
 * template literal (the row's aria-label splices `status` that way) is not a
 * render and is skipped.
 */
function openingTagBefore(code: string, marker: string): [number, number] | null {
  const m = new RegExp(`(?<!\\$)${escapeRegex(marker)}`).exec(code);
  if (!m) return null;
  const open = code.lastIndexOf('<', m.index);
  return open === -1 ? null : [open, m.index];
}

// ── Detectors ────────────────────────────────────────────────────────

/** `team={game.X}` of every `<TeamLine>` in document order. */
export function teamLineOrder(src: string): string[] {
  const code = codeOf(src);
  const out: string[] = [];
  for (const m of code.matchAll(/<TeamLine\b([\s\S]*?)\/>/g)) {
    const team = /team=\{game\.(\w+)\}/.exec(m[1]);
    out.push(team ? team[1] : '?');
  }
  return out;
}

/** The two `teamFullName(game.X)` calls in the row's aria-label, in order. */
export function ariaLabelOrder(src: string): string[] {
  const m = /aria-label=\{`\$\{teamFullName\(game\.(\w+)\)\} at \$\{teamFullName\(game\.(\w+)\)\}/.exec(codeOf(src));
  return m ? [m[1], m[2]] : [];
}

const TW_TEXT: Record<string, number> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30,
};
const TEXT_SIZE = /(?<![\w-])text-(?:\[(\d+)px\]|(xs|sm|base|lg|xl|2xl|3xl))(?![\w-])/g;

/** The largest Tailwind text size declared in a class string, in px. */
export function maxTextPx(classes: string): number | null {
  let max: number | null = null;
  for (const m of classes.matchAll(TEXT_SIZE)) {
    const px = m[1] ? Number(m[1]) : TW_TEXT[m[2]];
    if (max === null || px > max) max = px;
  }
  return max;
}

/** Largest text size on the element that renders `marker` as its first child. */
export function textPxOfElementRendering(src: string, marker: string): number | null {
  const { code, strings } = scan(src);
  const range = openingTagBefore(code, marker);
  if (!range) return null;
  const [open, at] = range;
  const classes = strings.filter((s) => s.start > open && s.start < at).map((s) => s.text).join(' ');
  return maxTextPx(classes);
}

/** Largest text size declared anywhere in the file. */
export function maxTextPxInFile(src: string): number | null {
  return maxTextPx(literalsOf(src).map((s) => s.text).join(' '));
}

export interface StatusColumn {
  /** `{status}` renders in JSX. */
  statusRenders: number;
  /** `rowStatusText(` calls. */
  rowStatusTextCalls: number;
  /** True when the row reaches for the shared function itself instead of going through rowStatusText. */
  callsGameStateLabelDirectly: boolean;
}

export function statusColumn(src: string): StatusColumn {
  const code = codeOf(src);
  return {
    // `${status}` inside the aria-label template is a splice, not a render.
    statusRenders: count(code, /(?<!\$)\{status\}/g),
    rowStatusTextCalls: count(code, /\browStatusText\(/g),
    callsGameStateLabelDirectly: /\bgameStateLabel\b/.test(code),
  };
}

/**
 * The words the status column may print, built by calling the shared
 * function rather than restating its output, so the ban follows the source.
 * Clock and period echoes ('10:32 2nd', '3rd') are left out on purpose: they
 * are data, not vocabulary.
 */
export function statusVocabulary(label: typeof gameStateLabel): Set<string> {
  const words = new Set<string>();
  for (const state of ['scheduled', 'live', 'final', 'postponed', 'unknown'] as GameState[]) {
    words.add(label(state, null, null));
  }
  words.add(label('live', null, 'INT'));
  words.add(label('final', 'OT', null));
  words.add(label('final', 'SO', null));
  return words;
}

/** String literals in `src` that are status words, i.e. a local copy of the vocabulary. */
export function localStatusLiterals(src: string, vocab: Set<string>): Literal[] {
  return literalsOf(src).filter((s) => vocab.has(s.text) || /^Final\b/.test(s.text) || /^INT\b/.test(s.text));
}

/** Matching close paren for the `(` at `open`. */
function matchingParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return code.length;
}

/** `.filter(...)` calls whose result is rendered through `.map(`: a list partitioned before it is drawn. */
export function renderedFilters(src: string): number {
  const code = codeOf(src);
  let hits = 0;
  for (const m of code.matchAll(/\.filter\(/g)) {
    const close = matchingParen(code, m.index + '.filter'.length);
    if (/^\s*\.map\(/.test(code.slice(close + 1))) hits++;
  }
  return hits;
}

/** Headings or sections whose own text says "live": a hoisted live section. */
export function hoistedLiveHeadings(src: string): number {
  return count(codeOf(src), /<(?:h[1-6]|section|header)\b[^>]*>[^<{]*\blive\b/gi);
}

export interface ListShape {
  mapsOverGames: number;
  filters: number;
  headings: number;
}

export function listShape(src: string): ListShape {
  const code = codeOf(src);
  return {
    mapsOverGames: count(code, /\bgames\.map\(/g),
    filters: count(code, /\.filter\(/g),
    headings: count(code, /<(?:h[1-6]|section|header)\b/g),
  };
}

/** The generic of the `expandedGameId` useState, whitespace-normalised, or null when absent. */
export function expansionStateType(src: string): string | null {
  const m = /const \[expandedGameId, setExpandedGameId\] = useState<([^(]+)>\(/.exec(codeOf(src));
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

const ODDS = /\b(?:moneyline\w*|implied_win_probability\w*|impliedWin\w*|over_under\b|overUnder\b|bookmaker\w*|(?:home|away)_spread\b)/g;

/** Identifiers that read a betting line, comments excluded. */
export function oddsReads(src: string): string[] {
  return codeOf(src).match(ODDS) ?? [];
}

/** Copy that describes an empty projection strip as a finding ("0 projected"), in a literal or in JSX text. */
export function emptyStripCopy(src: string): string[] {
  return codeOf(src).match(/\b0 projected\b|\bno projections?\b|\bnobody projected\b/gi) ?? [];
}

/** `actualPoints ?? 0`, `projectedPoints || 0`, `actuals ?? 0`: a missing row printed as a zero. */
export function zeroFilledPoints(src: string): string[] {
  return codeOf(src).match(/\b(?:actualPoints|projectedPoints|actuals)\b\s*(?:\?\?|\|\|)\s*0\b/g) ?? [];
}

/**
 * Is the detail panel's stat line inside the `{a ? (` branch? Returns the
 * order of the three constructs so a failure says which one moved.
 */
export function statLineGuard(src: string): { guardOpen: number; statLine: number; elseBranch: number } {
  const code = codeOf(src);
  const guardOpen = code.indexOf('{a ? (');
  const statLine = code.indexOf('${a.goals}G ${a.assists}A');
  const elseBranch = guardOpen === -1 ? -1 : code.indexOf(') : (', guardOpen);
  return { guardOpen, statLine, elseBranch };
}

/** Lines that render `{venue}` without a `venue ?` or `venue &&` guard just before them. */
export function unguardedVenueRenders(src: string): number[] {
  const code = codeOf(src);
  const out: number[] = [];
  for (const m of code.matchAll(/(?<!\$)\{venue\}/g)) {
    const before = code.slice(Math.max(0, m.index - 160), m.index);
    if (!/\bvenue\s*(?:\?|&&)/.test(before)) out.push(lineAt(code, m.index));
  }
  return out;
}

export interface PollingContract {
  pollMs: number | null;
  /** refetchInterval is a function of the query, not a constant. */
  predicate: boolean;
  /** ...and the function looks for a live game. */
  checksLive: boolean;
  /** ...and returns false (stop polling) when there is none. */
  offOtherwise: boolean;
}

export function pollingContract(src: string): PollingContract {
  const code = codeOf(src);
  const ms = /const LIVE_POLL_MS = ([\d_]+);/.exec(code);
  const at = code.indexOf('refetchInterval:');
  let expr = '';
  if (at !== -1) {
    // The option's value runs to the first comma or closing brace at depth 0.
    let depth = 0;
    let i = at + 'refetchInterval:'.length;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
    }
    expr = code.slice(at + 'refetchInterval:'.length, i).trim();
  }
  return {
    pollMs: ms ? Number(ms[1].replace(/_/g, '')) : null,
    predicate: /^\(?\s*\w*\s*\)?\s*=>/.test(expr),
    checksLive: /\.some\(/.test(expr) && /state\s*===\s*'live'/.test(expr),
    offOtherwise: /:\s*false\s*$/.test(expr),
  };
}

export interface DateStripShape {
  /** The tablist lays its cells out in a row that scrolls sideways. */
  horizontal: boolean;
  /** Cells do not shrink and snap to centre. */
  snaps: boolean;
  scrollsSelectedIntoView: boolean;
  /** Anything that would turn the strip into a picker you have to open. */
  pickerConstructs: string[];
}

export function dateStripShape(src: string): DateStripShape {
  const { code, strings } = scan(src);
  const classesOfTagContaining = (attr: string): string => {
    const at = code.indexOf(attr);
    if (at === -1) return '';
    const open = code.lastIndexOf('<', at);
    const end = tagEnd(code, open);
    return strings.filter((s) => s.start > open && s.start < end).map((s) => s.text).join(' ');
  };
  const tablist = classesOfTagContaining('role="tablist"').split(/\s+/);
  const tab = classesOfTagContaining('role="tab"').split(/\s+/);

  const pickers: string[] = [];
  for (const m of code.matchAll(/<input\b[^>]*>/g)) {
    if (/type="date"/.test(m[0])) pickers.push('input[type=date]');
  }
  if (/<select\b/.test(code)) pickers.push('select');
  for (const m of code.matchAll(/<(Calendar|DatePicker|DayPicker|Popover|Dialog|Drawer|Sheet)\b/g)) {
    pickers.push(`<${m[1]}>`);
  }
  for (const m of code.matchAll(/from ['"]([^'"]*(?:calendar|date-?picker|day-?picker|popover|dialog)[^'"]*)['"]/gi)) {
    pickers.push(`import:${m[1]}`);
  }

  return {
    horizontal:
      tablist.includes('flex') &&
      tablist.includes('overflow-x-auto') &&
      !tablist.includes('flex-col') &&
      !tablist.includes('overflow-y-auto'),
    snaps: tablist.includes('snap-x') && tab.includes('flex-shrink-0') && tab.includes('snap-center'),
    scrollsSelectedIntoView: /\.scrollIntoView\(/.test(code),
    pickerConstructs: pickers,
  };
}

// ── The sweep ────────────────────────────────────────────────────────

const VOCAB = statusVocabulary(gameStateLabel);

/** Every file the status-word and odds sweeps read. */
const SWEEP = (): string[] => [...scoresSources(), FILES.page, FILES.api];

/**
 * QUARANTINE, in the aiVoiceGuard sense: a literal that is wrong, is named
 * here so nobody rediscovers it, and is waiting on the pass that owns its
 * file. It may only shrink. The sweep may not find a status word that is not
 * on this list, and every entry must still be a real offender, so fixing the
 * line forces its removal here rather than letting it rot into an exemption.
 */
const QUARANTINED_STATUS_LITERALS: Array<{ file: string; text: string; why: string }> = [
  // Empty on purpose. The one entry this list ever held (scoresFormat.ts printing
  // 'Scheduled' itself) was removed on 2026-09-03 when the fallback started
  // calling gameStateLabel. Add an entry only with a reason and a plan to remove it.
];

describe('scores architecture guard', () => {
  it('scans the surfaces it claims to scan', () => {
    for (const rel of Object.values(FILES)) {
      expect(existsSync(resolve(SRC, rel)), `${rel} moved; the guard is pinning nothing`).toBe(true);
    }
    const sources = scoresSources();
    // index.ts, the formatter and the six components.
    expect(sources.length).toBeGreaterThanOrEqual(8);
    for (const rel of [FILES.row, FILES.list, FILES.strip, FILES.detail, FILES.dateStrip, FILES.format, FILES.empty]) {
      expect(sources).toContain(rel);
    }
    expect(sources.some((f) => f.includes('__tests__'))).toBe(false);
    expect(VOCAB.size).toBeGreaterThanOrEqual(7);
    expect(VOCAB.has('Final')).toBe(true);
    expect(VOCAB.has('Scheduled')).toBe(true);
  });

  describe('1. away on top, home below, and the score is the biggest thing in the row', () => {
    const row = read(FILES.row);

    it('renders exactly two team lines, away first', () => {
      expect(teamLineOrder(row)).toEqual(['away', 'home']);
    });

    it('speaks the matchup in the same order: away at home', () => {
      expect(ariaLabelOrder(row)).toEqual(['away', 'home']);
    });

    it('the score is set larger than the name, which is larger than the status', () => {
      const score = textPxOfElementRendering(row, '{score}');
      const name = textPxOfElementRendering(row, '{teamDisplayName(team)}');
      const status = textPxOfElementRendering(row, '{status}');
      expect(score, 'score span not found').not.toBeNull();
      expect(name, 'name span not found').not.toBeNull();
      expect(status, 'status span not found').not.toBeNull();
      expect(score).toBeGreaterThan(name as number);
      expect(name).toBeGreaterThan(status as number);
      // Nothing in the row out-weighs the score. This is the property, not 20.
      expect(maxTextPxInFile(row)).toBe(score);
    });

    it('the score is right-aligned and tabular so a column of them lines up', () => {
      const { code, strings } = scan(row);
      const [open, at] = openingTagBefore(code, '{score}') as [number, number];
      const classes = strings.filter((s) => s.start > open && s.start < at).map((s) => s.text).join(' ');
      expect(classes).toContain('text-right');
      expect(classes).toContain('tabular-nums');
    });
  });

  describe('2. one status column, vocabulary from @citrus/shared', () => {
    const row = read(FILES.row);
    const format = read(FILES.format);

    it('the row renders one status, from rowStatusText, and never calls gameStateLabel itself', () => {
      expect(statusColumn(row)).toEqual({
        statusRenders: 1,
        rowStatusTextCalls: 1,
        callsGameStateLabelDirectly: false,
      });
    });

    it('rowStatusText defers to gameStateLabel imported from @citrus/shared', () => {
      const code = codeOf(format);
      expect(code).toMatch(/import \{[^}]*\bgameStateLabel\b[^}]*\} from '@citrus\/shared'/);
      expect(code).toContain('return gameStateLabel(game.state, game.period, game.periodTime);');
    });

    it('no file under scores/ keeps its own status words, beyond the quarantined fallback', () => {
      const found: Array<{ file: string; text: string; line: number }> = [];
      for (const rel of SWEEP()) {
        for (const lit of localStatusLiterals(read(rel), VOCAB)) found.push({ file: rel, text: lit.text, line: lit.line });
      }
      const key = (o: { file: string; text: string }) => `${o.file}|${o.text}`;
      const quarantined = new Set(QUARANTINED_STATUS_LITERALS.map(key));
      const real = found.filter((o) => !quarantined.has(key(o)));
      expect(
        real.map((o) => `${o.file}:${o.line} '${o.text}'`),
        'a status word is spelled locally; get it from gameStateLabel',
      ).toEqual([]);
      // ...and the quarantine only shrinks.
      const present = new Set(found.map(key));
      const stale = QUARANTINED_STATUS_LITERALS.filter((q) => !present.has(key(q)));
      expect(stale.map(key), 'no longer an offender; delete it from the quarantine').toEqual([]);
      expect(QUARANTINED_STATUS_LITERALS.length).toBeLessThanOrEqual(1);
    });
  });

  describe('3. live rows stay inline', () => {
    const page = read(FILES.page);
    const list = read(FILES.list);
    const row = read(FILES.row);

    it('the list is one map over the games it was given: no partition, no heading', () => {
      expect(listShape(list)).toEqual({ mapsOverGames: 1, filters: 0, headings: 0 });
    });

    it('nothing renders a filtered subset of the day, and nothing titles a live section', () => {
      for (const src of [page, list, row]) {
        expect(renderedFilters(src)).toBe(0);
        expect(hoistedLiveHeadings(src)).toBe(0);
      }
    });

    it('the page filters on live exactly once, to count for the subtitle, and hands the whole list down', () => {
      const code = codeOf(page);
      expect(count(code, /state === 'live'/g)).toBe(2); // liveCount + the poll predicate
      expect(code).toContain("const liveCount = games.filter((g) => g.state === 'live').length;");
      expect(count(code, /<ScoresList\b/g)).toBe(1);
      expect(code).toMatch(/<ScoresList\s+games=\{games\}/);
    });

    it('the day is ordered once per fetch, so rows cannot shuffle under a thumb between ticks', () => {
      expect(codeOf(page)).toContain('useMemo(() => [...(data?.games ?? [])].sort(compareGames), [data])');
    });

    it('live is marked in place with a ring and a pulse', () => {
      const code = codeOf(row);
      expect(code).toContain("game.state === 'live' && 'ring-1 ring-pastel-sage/30'");
      expect(code).toMatch(/\{showsLivePulse\(game\) \? <LivePulse\b/);
    });
  });

  describe('4. one row open at a time', () => {
    const page = read(FILES.page);
    const list = read(FILES.list);

    it('the expansion state is a single nullable id, not a set or an array', () => {
      expect(expansionStateType(page)).toBe('number | null');
    });

    it('the toggle swaps the one id, and a date change clears it', () => {
      const code = codeOf(page);
      expect(code).toContain('setExpandedGameId((current) => (current === gameId ? null : gameId))');
      const selectDate = code.slice(code.indexOf('const selectDate'), code.indexOf('const {', code.indexOf('const selectDate')));
      expect(selectDate).toContain('setExpandedGameId(null);');
    });

    it('the list accepts one id and mounts the detail panel only for it', () => {
      const code = codeOf(list);
      expect(code).toMatch(/expandedGameId:\s*number \| null;/);
      expect(code).toContain('expanded={expandedGameId === game.gameId}');
      expect(code).toMatch(/expandedGameId === game\.gameId \? \(\s*<GameDetailPanel\b/);
      expect(code).not.toMatch(/Set<number>|number\[\]/);
    });
  });

  describe('5. the odds slot is the projection slot', () => {
    it('no scores code reads a betting line', () => {
      for (const rel of SWEEP()) {
        expect(oddsReads(read(rel)), `${rel} reads a betting line`).toEqual([]);
      }
    });

    it('the strip reads the projection and its confidence, and says so', () => {
      const strip = read(FILES.strip);
      const code = codeOf(strip);
      expect(count(code, /\bprojectedPoints\b/g)).toBeGreaterThanOrEqual(2);
      expect(count(code, /\bconfidenceLabel\b/g)).toBeGreaterThanOrEqual(2);
      expect(literalsOf(strip).map((s) => s.text)).toContain('Citrus projections');
    });

    it('the wire shape carries no odds field either', () => {
      const shared = readFileSync(resolve(SRC, '../../../packages/shared/src/types/scores.ts'), 'utf-8');
      const code = codeOf(shared);
      const game = code.slice(code.indexOf('export interface ScoreboardGame {'));
      expect(game.length).toBeGreaterThan(100);
      expect(oddsReads(game)).toEqual([]);
    });
  });

  describe('6. nothing is invented', () => {
    const strip = read(FILES.strip);
    const row = read(FILES.row);
    const format = read(FILES.format);
    const detail = read(FILES.detail);
    const list = read(FILES.list);

    it('the strip renders nothing at all when there is no projection', () => {
      expect(codeOf(strip)).toContain('if (!citrus || citrus.players.length === 0) return null;');
      expect(emptyStripCopy(strip)).toEqual([]);
    });

    it('the summary line is empty with no projection and the row omits the element', () => {
      expect(codeOf(format)).toContain("if (!citrus || citrus.projectedPlayers === 0) return '';");
      expect(codeOf(row)).toMatch(/\{summary \? \(/);
    });

    it('a stat line prints only when a stat row exists, and nothing zero-fills a missing one', () => {
      const { guardOpen, statLine, elseBranch } = statLineGuard(detail);
      expect(guardOpen, '`{a ? (` guard missing').toBeGreaterThan(-1);
      expect(statLine, 'skater stat line missing').toBeGreaterThan(guardOpen);
      expect(elseBranch, 'else branch missing').toBeGreaterThan(statLine);
      expect(codeOf(detail)).toContain('const a = player.actuals;');
      expect(codeOf(detail)).toContain('{player.actualPoints !== null ? (');
      expect(codeOf(strip)).toContain('const hasActual = player.actualPoints !== null;');
      for (const rel of scoresSources()) {
        expect(zeroFilledPoints(read(rel)), `${rel} prints a zero for a missing number`).toEqual([]);
      }
    });

    it('venue renders only when it exists, and only in the detail panel', () => {
      expect(unguardedVenueRenders(detail)).toEqual([]);
      expect(count(codeOf(detail), /(?<!\$)\{venue\}/g)).toBe(1);
      expect(codeOf(detail)).toMatch(/\{venue \? \(/);
      expect(codeOf(list)).toContain('venue={game.venue}');
      expect(codeOf(row)).not.toMatch(/\bvenue\b/);
      // No placeholder stands in for a venue we do not have.
      for (const rel of scoresSources()) {
        const placeholders = literalsOf(read(rel)).filter((s) => /venue (?:tba|tbd)|unknown venue/i.test(s.text));
        expect(placeholders, `${rel} invents a venue`).toEqual([]);
      }
    });
  });

  describe('7. polling only while something on screen is live', () => {
    const page = read(FILES.page);
    const contract = pollingContract(page);

    it('polls every 20 seconds, through a predicate, and stops when nothing is live', () => {
      expect(contract).toEqual({ pollMs: 20_000, predicate: true, checksLive: true, offOtherwise: true });
    });

    it('the interval is not shorter than the client cache, or the poll would be answered from cache', () => {
      // api/scores.ts wraps the day read in CACHE_TTL.SHORT. A refetch inside
      // that window returns the cached body: a poll that polls nothing.
      const api = codeOf(read(FILES.api));
      const getDay = api.slice(api.indexOf('async getDay('), api.indexOf('async getGame('));
      expect(getDay).toContain('CACHE_TTL.SHORT');
      expect(contract.pollMs).toBeGreaterThanOrEqual(CACHE_TTL.SHORT);
    });
  });

  describe('8. the date strip is a strip, not a picker', () => {
    const strip = read(FILES.dateStrip);
    const page = read(FILES.page);

    it('is a horizontal, scrollable, snapping run of days with nothing to open', () => {
      expect(dateStripShape(strip)).toEqual({
        horizontal: true,
        snaps: true,
        scrollsSelectedIntoView: true,
        pickerConstructs: [],
      });
    });

    it('is pinned under the header so the day is always visible', () => {
      expect(codeOf(page)).toMatch(/className="sticky top-0 z-sticky-raised">\s*<ScoresDateStrip\b/);
    });
  });

  // ── Self-tests: every detector bites on a planted offender ──────────

  describe('the detectors bite', () => {
    it('team order: home planted first is reported first', () => {
      const planted = `
        <TeamLine team={game.home} score={game.homeScore} emphasised={false} dimmed={false} />
        <TeamLine team={game.away} score={game.awayScore} emphasised={false} dimmed={false} />`;
      expect(teamLineOrder(planted)).toEqual(['home', 'away']);
      expect(ariaLabelOrder('aria-label={`${teamFullName(game.home)} at ${teamFullName(game.away)}, x`}')).toEqual(['home', 'away']);
    });

    it('type scale: a name set larger than the score is measured as larger', () => {
      const planted = `
        <span className={cn('font-display text-2xl truncate', x)}>{teamDisplayName(team)}</span>
        <span className="font-varsity text-xl text-right">{score}</span>
        <span className="font-jbmono text-[10px]">{status}</span>`;
      expect(textPxOfElementRendering(planted, '{teamDisplayName(team)}')).toBe(24);
      expect(textPxOfElementRendering(planted, '{score}')).toBe(20);
      expect(textPxOfElementRendering(planted, '{status}')).toBe(10);
      expect(maxTextPxInFile(planted)).toBe(24);
      // Colour and alignment tokens are not sizes.
      expect(maxTextPx('text-pastel-cream text-right text-center')).toBeNull();
    });

    it('status column: a second status render and a local vocabulary are both caught', () => {
      expect(statusColumn('<span>{status}</span><span>{status}</span>').statusRenders).toBe(2);
      expect(statusColumn("const s = gameStateLabel(game.state, null, null);").callsGameStateLabelDirectly).toBe(true);
      const table = "const LABELS = { live: 'Live', final: 'Final', ot: 'Final/OT', int: 'INT 2nd' };";
      expect(localStatusLiterals(table, VOCAB).map((l) => l.text)).toEqual(['Live', 'Final', 'Final/OT', 'INT 2nd']);
      // A comment that quotes the vocabulary is not a table.
      expect(localStatusLiterals("// prints 'Final' or 'Live'\nconst x = 1;", VOCAB)).toEqual([]);
      // Nor is a template that splices data in.
      expect(localStatusLiterals('const t = `${clock} ${period}`;', VOCAB)).toEqual([]);
    });

    it('live inline: a filtered render and a live heading are both caught', () => {
      const partitioned = "{games.filter((g) => g.state === 'live').map((g) => <Row key={g.gameId} game={g} />)}";
      expect(renderedFilters(partitioned)).toBe(1);
      expect(renderedFilters("const n = games.filter((g) => g.state === 'live').length;")).toBe(0);
      expect(hoistedLiveHeadings('<h2 className="x">Live now</h2>')).toBe(1);
      expect(hoistedLiveHeadings('<section aria-label="x">LIVE</section>')).toBe(1);
      expect(hoistedLiveHeadings('<p>{n} live now</p>')).toBe(0);
      expect(listShape(`{games.map((g) => <Row />)}\n<h3>Final</h3>\n{games.filter(f).map((g) => <Row />)}`)).toEqual({
        mapsOverGames: 1,
        filters: 1,
        headings: 1,
      });
    });

    it('expansion: a set or an array of ids is reported as such', () => {
      expect(expansionStateType('const [expandedGameId, setExpandedGameId] = useState<Set<number>>(new Set());')).toBe('Set<number>');
      expect(expansionStateType('const [expandedGameId, setExpandedGameId] = useState<number[]>([]);')).toBe('number[]');
      expect(expansionStateType('const [open, setOpen] = useState(false);')).toBeNull();
    });

    it('odds: a moneyline read is caught, a comment about one is not', () => {
      expect(oddsReads('const ml = game.moneyline_home ?? game.implied_win_probability_away;')).toEqual([
        'moneyline_home',
        'implied_win_probability_away',
      ]);
      expect(oddsReads('/* moneyline_home is NULL on every row */ const x = 1; // bookmaker')).toEqual([]);
      expect(oddsReads("const cols = 'home_spread, over_under, bookmaker';")).toEqual(['home_spread', 'over_under', 'bookmaker']);
    });

    it('nothing invented: empty-strip copy, zero fills and a bare venue are caught', () => {
      expect(emptyStripCopy('return <span>0 projected</span>;')).toEqual(['0 projected']);
      expect(emptyStripCopy("return <span>{n} projected</span>; // '0 projected' would be a claim")).toEqual([]);
      expect(zeroFilledPoints('<b>{player.actualPoints ?? 0}</b> {p.projectedPoints || 0}')).toHaveLength(2);
      expect(zeroFilledPoints('<b>{formatPoints(player.actualPoints)}</b>')).toEqual([]);
      expect(unguardedVenueRenders('<p>{venue}</p>')).toEqual([1]);
      expect(unguardedVenueRenders('{venue ? (\n<p>{venue}</p>\n) : null}')).toEqual([]);
      expect(unguardedVenueRenders('{venue && <p>{venue}</p>}')).toEqual([]);
      const guard = statLineGuard('{a ? (<i>x</i>) : (<i>y</i>)}\n`${a.goals}G ${a.assists}A`');
      expect(guard.statLine).toBeGreaterThan(guard.elseBranch);
    });

    it('polling: a constant interval, a predicate that ignores live, and a shorter interval are all caught', () => {
      const constant = 'const LIVE_POLL_MS = 20_000;\nuseQuery({ refetchInterval: LIVE_POLL_MS });';
      expect(pollingContract(constant)).toEqual({ pollMs: 20_000, predicate: false, checksLive: false, offOtherwise: false });
      const blind = 'const LIVE_POLL_MS = 20_000;\nuseQuery({ refetchInterval: () => LIVE_POLL_MS, staleTime: 1 });';
      expect(pollingContract(blind)).toMatchObject({ predicate: true, checksLive: false, offOtherwise: false });
      const fast = "const LIVE_POLL_MS = 5_000;\nuseQuery({\n  refetchInterval: (query) =>\n    query.state.data?.games.some((g) => g.state === 'live') ? LIVE_POLL_MS : false,\n});";
      expect(pollingContract(fast)).toEqual({ pollMs: 5_000, predicate: true, checksLive: true, offOtherwise: true });
      expect(pollingContract('const x = 1;')).toEqual({ pollMs: null, predicate: false, checksLive: false, offOtherwise: false });
    });

    it('date strip: a date input, a calendar import and a vertical list are all caught', () => {
      const picker = `import { Calendar } from '@/components/ui/calendar';
        <div role="tablist" className="flex flex-col overflow-y-auto snap-x">
          <button role="tab" onClick={() => onSelect(d.date)} className={cn('flex-shrink-0 snap-center', x)} />
        </div>
        <input type="date" value={selected} /> <select />`;
      expect(dateStripShape(picker)).toEqual({
        horizontal: false,
        snaps: true,
        scrollsSelectedIntoView: false,
        pickerConstructs: ['input[type=date]', 'select', 'import:@/components/ui/calendar'],
      });
      expect(dateStripShape('<Popover><DatePicker /></Popover>').pickerConstructs).toEqual(['<Popover>', '<DatePicker>']);
    });
  });

  describe('the scanner', () => {
    it('drops comments and keeps offsets, so line numbers stay honest', () => {
      const src = "// moneyline_home\nconst a = 1; /* implied_win_probability_home */\nconst b = 'Final';";
      const { code, strings } = scan(src);
      expect(code).not.toContain('moneyline');
      expect(code.length).toBe(src.length);
      expect(strings).toEqual([{ text: 'Final', line: 3, start: src.indexOf('Final') }]);
    });

    it('does not mistake an apostrophe in JSX prose for a string opener', () => {
      // GameDetailPanel.tsx line 150 has exactly this shape.
      const src = "<p>This game's detail did not load. {(error as Error | undefined)?.message ?? 'Try again.'}</p>";
      expect(literalsOf(src).map((s) => s.text)).toEqual(['Try again.']);
      expect(literalsOf("return 'Offseason';").map((s) => s.text)).toEqual(['Offseason']);
    });

    it('sees literals nested inside template interpolations, and skips regex bodies', () => {
      expect(literalsOf("const t = `${n > 0 ? 'Final' : ''} games`;").map((s) => s.text)).toEqual(['Final', ' games']);
      expect(codeOf("const ok = /^\\d{4}-\\d{2}$/.test(x); // Final")).not.toContain('Final');
    });
  });
});

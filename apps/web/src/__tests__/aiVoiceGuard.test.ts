import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AI-VOICE GUARD (2026-09-02 pre-TestFlight copy pass).
 *
 * Citrus ships prose in two places a user can tell apart from a human's: the
 * strings baked into the UI, and whatever Stormy says. Both had the same
 * tell. Before this guard the app carried 375 em dashes inside user-facing
 * string literals, and Stormy's system prompt licensed none of the habits
 * that stop a model sounding like a model. The founder's instruction is
 * blunt: "Less ai M DASHES, and bullshit that's clearly AI."
 *
 * This file is the regression test for that instruction. It is modelled on
 * `darkThemeContrastGuard.test.ts` — same idiom: walk the source, extract the
 * thing that matters, ban a whole defect class rather than a list of known
 * instances, and prove the detector bites with a planted offender so the
 * suite cannot go permanently green while guarding nothing.
 *
 * ── HOW USER-FACING STRINGS ARE EXTRACTED ────────────────────────────
 *
 * There is no AST tooling in this workspace and CLAUDE.md forbids adding a
 * runtime dependency for one, so `scan()` below is a character-state machine
 * that walks each file once and classifies every character as code, comment,
 * regex literal, or the CONTENTS of a string. It understands the four forms
 * prose actually ships in:
 *
 *   1. `'…'` and `"…"`      — attribute values, toasts, error copy
 *   2. `` `…` ``            — template literals; the interpolations (`${…}`)
 *                             are cut out and only the literal chunks kept,
 *                             so a player name spliced into a sentence is
 *                             never mistaken for authored copy
 *   3. JSX text             — the run between `>` and `<` with no braces in
 *                             it, taken only from spans the state machine
 *                             marked as code (so `"a > b < c"` inside a
 *                             string can never be read as markup)
 *
 * Comments are dropped wholesale. That is the single most important
 * exclusion: this repo comments heavily and in em dashes, and a guard that
 * fired on `// the roster — see below` would be deleted within a week.
 *
 * Extracted text is then run through `decodeEscapes`, because `"\u2014"` is
 * an em dash spelled in ASCII and a scanner that reads source rather than
 * runtime values cannot otherwise tell. `DraftRoom.tsx` shipped its tab
 * title that way, inside the scanned scope, unseen for the guard's life.
 *
 * ── WHAT IS DELIBERATELY OUT OF SCOPE, AND WHY ───────────────────────
 *
 *   * `src/components/ui/**` — shadcn-managed. CLAUDE.md: "Do not modify".
 *     A rule we are forbidden to fix is a rule we must not enforce.
 *   * `__tests__/**` — fixtures deliberately contain offenders (this file
 *     included: the planted-offender test below is full of them).
 *   * `logger.*(…)`, `structuredLogger.*(…)`, `console.*(…)` arguments —
 *     developer-facing, never rendered. Excluded by range, not by guessing at
 *     the text. The match is on ANY `<name>Logger` receiver: the server's
 *     logger is `structuredLogger`, and a rule that named only `logger`
 *     reported eleven operator log lines in `LobbyManager` as user-facing
 *     copy the moment `server/src/draft` entered the sweep.
 *   * import/export/`require`/`import()` specifiers — module paths.
 *   * Tailwind class strings — `className`/`class` attribute values and the
 *     arguments of `cn(`/`cva(`/`clsx(`/`twMerge(`.
 *   * URLs, absolute paths, kebab/snake identifiers, and single-token
 *     strings with no space — data and keys, not sentences.
 *
 * NOTHING ELSE IS EXEMPT. In particular there is NO aria-label exemption.
 * An `aria-label` is read aloud to a screen-reader user, which makes it as
 * user-facing as anything on the page; the three that carried an em dash
 * (`MascotAvatar`, `RinkHeatmap`, `ScoreboardStrip`) were rewritten rather
 * than excused. Per the brief: fix the string, do not widen the exemption.
 *
 * ── WHAT IT BANS ─────────────────────────────────────────────────────
 *
 *   1. The em dash (U+2014). Commas, periods and parentheses all exist.
 *   2. The stock AI phrasebook (see BANNED_PHRASES).
 *   3. Projection-accuracy claims. This one is not a style rule: there is no
 *      benchmark in this repo comparing Citrus's projections to anyone
 *      else's, so "most accurate projections in fantasy hockey" (PreviewRink)
 *      and "97.6% accuracy live" (PreviewMockups) were claims with nothing
 *      behind them. The founder's standing instruction is no accuracy claims
 *      without data.
 *   4. Overstating the pass-context ("moat") coverage. 10,047 of 2025's
 *      118,975 scored shots carry those features — about 8%. Copy implying
 *      every shot does is false.
 */

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = resolve(HERE, '..').replace(/\\/g, '/');
const REPO = resolve(SRC, '../../..').replace(/\\/g, '/');

/**
 * Stormy's own prose surfaces, scanned alongside the UI.
 *
 * The system prompt is the highest-leverage string in the product: every
 * answer Stormy gives is downstream of it. `StormyService` is here for a
 * subtler reason — it SERIALISES the roster/bracket context the model reads,
 * and a model mirrors the punctuation of its context. Feeding Stormy 40 lines
 * of `Name (TOR, C) — 12GP 8PTS` and then asking him not to write em dashes
 * is a fight the prompt loses.
 */
const PROSE_FILES = [
  `${REPO}/server/src/lib/stormy/systemPrompt.ts`,
  `${SRC}/services/StormyService.ts`,
];

// ── Extraction ───────────────────────────────────────────────────────

export interface Extracted {
  kind: 'string' | 'template' | 'jsx';
  text: string;
  /** Character offset of `text` within the file. */
  start: number;
}

interface ScanResult {
  strings: Extracted[];
  /** True where the character is real code (not comment/regex/string body). */
  isCode: boolean[];
}

/** Keywords a string literal may legally follow. See `opensString`. */
const KEYWORD_BEFORE_STRING = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'await',
  'yield', 'else', 'do', 'instanceof', 'throw', 'from', 'import', 'export',
  'default', 'as', 'extends', 'satisfies',
]);

/**
 * Is the quote at `pos` opening a string literal, or is it an apostrophe in
 * JSX prose?
 *
 * This distinction is load-bearing. `<p>Here's everything that ships — no
 * upsells.</p>` has one straight apostrophe in it. Treat that as a string
 * opener and the scanner swallows the rest of the line, which both invents a
 * literal nobody wrote AND blanks the real JSX text out of the code mask, so
 * the em dash on that line goes unseen. Five strings in `pages/` were shaped
 * exactly like that.
 *
 * A quote can only START an expression, so it is a string opener unless the
 * previous significant character ends one: an identifier, a number, a closing
 * bracket, or `}` (which in JSX is the end of an interpolation, as in
 * `{name}'s roster`). Two carve-outs:
 *
 *   * `>` ends a JSX tag but is also the tail of `=>`, so an arrow is let
 *     through.
 *   * a preceding IDENTIFIER may be a keyword. `return 'Offseason'` and
 *     `case 'x':` both put a letter immediately before a real string, and
 *     an earlier draft of this rule silently skipped eight error strings in
 *     `Auth.tsx`, every one of which begins `return "..."`.
 */
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

/** Index just past the template literal opening at `i` (backtick at `i`). */
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

/**
 * One pass, four states. Returns the literal contents plus a per-character
 * "this is code" mask that the JSX-text pass needs to avoid reading markup
 * out of the inside of a string.
 */
export function scan(src: string): ScanResult {
  const strings: Extracted[] = [];
  const isCode = new Array<boolean>(src.length).fill(true);
  const blank = (a: number, b: number) => {
    for (let k = a; k < b && k < src.length; k++) isCode[k] = false;
  };

  let i = 0;
  const n = src.length;
  // Last significant code character, used only to tell `/` (regex) from `/`
  // (division). Over-calling something a regex is safe here: regex bodies
  // hold no prose.
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
      const open = i;
      i++;
      const bodyStart = i;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        // An unterminated quote is a syntax error the build would catch;
        // stopping at the newline keeps this scanner from eating the file.
        if (src[i] === c || src[i] === '\n') break;
        i++;
      }
      strings.push({ kind: 'string', text: src.slice(bodyStart, i), start: bodyStart });
      blank(open, i + 1);
      i++;
      prev = '"';
      continue;
    }
    if (c === '`') {
      const open = i;
      i++;
      let chunkStart = i;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          strings.push({ kind: 'template', text: src.slice(chunkStart, i), start: chunkStart });
          blank(chunkStart, i);
          // The interpolation is SCANNED, not skipped. An earlier draft
          // stepped over it wholesale, which lost every literal nested inside
          // one: `${clears ? \` — ${clears}\` : ''}` in FreeAgentRow and
          // `${x ?? '—'}` in ProjectedVsActual both hid an em dash there.
          // Recursing and re-basing the offsets keeps them, and merging the
          // child's code mask keeps JSX inside a ternary visible to
          // `jsxText`.
          const exprStart = i + 2;
          const after = skipExpr(src, exprStart);
          const inner = scan(src.slice(exprStart, after - 1));
          for (const child of inner.strings) {
            strings.push({ kind: child.kind, text: child.text, start: child.start + exprStart });
          }
          for (let k = 0; k < inner.isCode.length; k++) {
            if (!inner.isCode[k]) isCode[exprStart + k] = false;
          }
          i = after;
          chunkStart = i;
          continue;
        }
        if (src[i] === '`') break;
        i++;
      }
      strings.push({ kind: 'template', text: src.slice(chunkStart, i), start: chunkStart });
      blank(chunkStart, i);
      blank(open, open + 1);
      i++;
      prev = '`';
      continue;
    }
    // `<` and `>` are DELIBERATELY absent from this set. `</span>` puts a
    // slash straight after a `<`, and treating that as a regex start made the
    // scanner swallow `</span> Ask follow-ups — I keep the thread context</`
    // as a regex body, hiding the em dash in two list items. Nothing real
    // writes `a < /re/.test(b)`.
    if (c === '/' && /[(,=:[!&|?{};+\n*%~^-]/.test(prev)) {
      const open = i;
      i++;
      let inClass = false;
      let closed = false;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) {
          closed = true;
          break;
        } else if (src[i] === '\n') break;
        i++;
      }
      if (closed) {
        blank(open, i + 1);
        i++;
        prev = '/';
        continue;
      }
      i = open + 1;
      prev = '/';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }

  return { strings, isCode };
}

/**
 * JSX text runs: everything between a `>` or `}` and the next `<` or `{`,
 * taken only from spans the scanner marked as code.
 *
 * `}` and `{` are in the delimiter set because prose routinely wraps an
 * interpolation: `<span>No sale — {playerName} went unsold</span>` is three
 * text runs, and a `>…<`-only regex sees none of them. That exact line in
 * `AuctionPanel` is how the gap was found. The cost is that some ordinary
 * code lands in the candidate set (`} catch {` yields " catch "), which is
 * harmless: a run only becomes an offender if it contains a banned
 * construction, and `} catch {` does not.
 */
export function jsxText(src: string, isCode: boolean[]): Extracted[] {
  const out: Extracted[] = [];
  const re = /[>}]([^<>{}]*)[<{]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (!/\S/.test(m[1])) continue;
    let allCode = true;
    for (let k = m.index; k < m.index + m[0].length; k++) {
      if (!isCode[k]) {
        allCode = false;
        break;
      }
    }
    if (allCode) out.push({ kind: 'jsx', text: m[1], start: m.index + 1 });
  }
  return out;
}

/** Character ranges whose strings are developer-facing, not user-facing. */
function excludedRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  // `logger.debug(...)` / `structuredLogger.warn(...)` / `console.warn(...)`
  // and friends: matched by name, then closed by paren depth so
  // multi-argument and multi-line calls are covered whole.
  //
  // `\w*[Ll]ogger` rather than a literal `logger`, because the server's
  // logger is `structuredLogger` and the web app's is `logger`. The `\s*\.`
  // that follows keeps it tight: `loggerFactory.create(` does not match,
  // because a receiver only qualifies when the call sits directly on it.
  const call = /\b(?:\w*[Ll]ogger|console)\s*\.\s*\w+\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    ranges.push([m.index, i]);
  }
  // NOTE: module specifiers get NO range exclusion. An earlier draft skipped
  // 400 characters after every `from '`, which `supabase.from('profiles')`
  // matches — that one line silently exempted eight error strings in Auth.tsx.
  // `isUserFacing` already rejects specifiers, because every one of them is
  // path- or identifier-shaped.
  //
  // Tailwind: className/class attributes and the class-merging helpers.
  const tw = /\b(?:className|class)\s*=\s*|(?:\b(?:cn|cva|clsx|twMerge)\s*\()/g;
  while ((m = tw.exec(src))) {
    let i = m.index + m[0].length;
    // Attribute form: cover the literal or the whole `{...}` expression.
    if (src[i] === '{') {
      let depth = 1;
      i++;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
      }
    } else if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      i++;
      while (i < src.length && src[i] !== q) i++;
      i++;
    } else {
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

const URL_OR_PATH = /^(?:https?:|mailto:|tel:|data:|blob:|\/|\.{1,2}\/|@\/|#[\w-]*$)/;
/** `player-dashboard`, `TEAM_ABBREV`, `sm:text-xs` — identifiers, not prose. */
const IDENTIFIER = /^[\w$@./:%[\]#-]*$/;

/**
 * `"\\u2014"` is an em dash. The scanner reads SOURCE, so it sees six ASCII
 * characters and waves it through, and `DraftRoom.tsx` has been shipping
 * `document.title = "\\uD83D\\uDFE2 Your Turn \\u2014 Citrus Draft"` past this
 * guard since the day it was written. An escape is a spelling of a
 * character, not an exemption from it, so every rule below runs on the
 * decoded text.
 *
 * `\\uXXXX`, `\\u{X...}` and `\\xNN` are decoded. Every other escape consumes
 * its next character verbatim, which is what keeps `\\\\u2014` (an escaped
 * backslash followed by the letter u) from being read as one.
 */
export function decodeEscapes(text: string): string {
  const SIMPLE: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') {
      out += text[i];
      continue;
    }
    const rest = text.slice(i);
    const m =
      /^\\u\{([0-9a-fA-F]{1,6})\}/.exec(rest) ||
      /^\\u([0-9a-fA-F]{4})/.exec(rest) ||
      /^\\x([0-9a-fA-F]{2})/.exec(rest);
    if (m) {
      out += String.fromCodePoint(parseInt(m[1], 16));
      i += m[0].length - 1;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) {
      out += '\\';
      continue;
    }
    out += SIMPLE[next] ?? next;
    i++;
  }
  return out;
}

/** Is this literal something a user could read on screen? */
export function isUserFacing(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (URL_OR_PATH.test(t)) return false;
  // No space anywhere means no sentence. A lone `—` is caught by the
  // em-dash rule before this returns, because it is checked on the raw text.
  if (IDENTIFIER.test(t)) return false;
  return true;
}

// ── The rules ────────────────────────────────────────────────────────

export const EM_DASH = /—/;

/**
 * The stock AI phrasebook, from the founder's list. Each is a construction
 * rather than a word wherever a word alone would be over-broad: "unlock" is
 * banned outright (it was slop in all three places it appeared), but
 * "not just" is only banned in the "it's not just X, it's Y" shape, because
 * "not just status" in a condition is ordinary English.
 */
/**
 * THE VOCABULARY NOW LIVES IN ONE FILE, read by two languages.
 *
 * Moved to `packages/shared/src/constants/aiVoice.json` on 2026-09-03, when
 * a second reader appeared: Draft Kit blurbs are database rows written by
 * `data-pipeline/draftkit/load_blurbs.py`, so they never passed through this
 * guard — the one body of prose in the product that is SOLD rather than
 * shipped had no voice rule on it at all. A Python copy of the list below
 * would have drifted from this one inside a month.
 *
 * The JSON stores patterns as strings restricted to syntax that means the
 * same thing in JS and Python, so both compile them directly and there is no
 * generation step to go stale. `patternsAreCrossLanguage` below pins that
 * restriction.
 */
const VOICE = JSON.parse(
  readFileSync(resolve(REPO, 'packages/shared/src/constants/aiVoice.json'), 'utf8'),
) as {
  bannedPhrases: Array<{ name: string; pattern: string }>;
  accuracyClaims: Array<{ name: string; pattern: string }>;
  moatOverstatement: { name: string; pattern: string };
  emDash: { char: string };
};

const compile = (list: Array<{ name: string; pattern: string }>) =>
  list.map(({ name, pattern }) => ({ name, re: new RegExp(pattern, 'i') }));

export const BANNED_PHRASES: Array<{ name: string; re: RegExp }> = compile(VOICE.bannedPhrases);

export const ACCURACY_CLAIMS: Array<{ name: string; re: RegExp }> = compile(VOICE.accuracyClaims);

export const MOAT_OVERSTATEMENT = new RegExp(VOICE.moatOverstatement.pattern, 'i');

/**
 * The JSON is read by `data-pipeline/draftkit/load_blurbs.py` as well, which
 * compiles the same strings with Python's `re`. That only works while every
 * pattern stays inside the syntax both engines agree on, and nothing about
 * a JSON string makes that obvious to the next person adding a phrase. This
 * is the test the JSON's header promises.
 *
 * Banned outright: lookbehind (`(?<=`), named groups (`(?<name>`), unicode
 * property escapes (`\p{...}`), possessive/atomic groups, and the `/.../flags`
 * wrapper (patterns are bare strings; flags are the reader's business).
 */
export const CROSS_LANGUAGE_VIOLATIONS: Array<{ name: string; re: RegExp }> = [
  { name: 'lookbehind', re: /\(\?<[=!]/ },
  { name: 'named group', re: /\(\?<[A-Za-z_]/ },
  { name: 'unicode property escape', re: /\\[pP]\{/ },
  { name: 'atomic or possessive group', re: /\(\?>|[*+?}]\+/ },
  { name: 'a slash-wrapped literal rather than a bare pattern', re: /^\/.*\/[a-z]*$/ },
];


export interface Offender {
  file: string;
  rule: string;
  text: string;
}

/**
 * Every offender in one file's source. Exported so the codebase sweep and
 * the planted-offender test run the SAME detector — a guard whose detector
 * is only ever exercised by source that passes it is a guard that could be
 * matching nothing at all.
 *
 * `phrases: false` runs the em-dash rule alone. Exactly one kind of file
 * needs it: a file whose job is to FORBID the phrase list has to quote the
 * phrase list. Stormy's system prompt tells the model, in as many words,
 * never to write "delve" or "tapestry" or "the most accurate projections",
 * and a scanner that cannot tell a prohibition from a violation would force
 * that instruction to be written in riddles. The em-dash rule still applies
 * there, because the prompt has no reason to contain the character at all,
 * and the prompt's own content is pinned separately by
 * "Stormy's prompt still carries the anti-tell contract" below, which is a
 * stronger test than a keyword scan: it fails if the ban goes MISSING.
 */
export function offendersIn(rel: string, src: string, phrases = true): Offender[] {
  const { strings, isCode } = scan(src);
  const skip = excludedRanges(src);
  const inSkip = (pos: number) => skip.some(([a, b]) => pos >= a && pos < b);

  const candidates = [...strings, ...jsxText(src, isCode)].filter(
    (s) => !inSkip(s.start) && isUserFacing(s.text),
  );

  const out: Offender[] = [];
  const quote = (t: string) => t.trim().replace(/\s+/g, ' ').slice(0, 120);
  for (const c of candidates) {
    // Decoded, so an escaped em dash is the same offence as a typed one.
    const text = decodeEscapes(c.text);
    if (EM_DASH.test(text)) out.push({ file: rel, rule: 'em dash', text: quote(text) });
    if (!phrases) continue;
    for (const p of BANNED_PHRASES) {
      if (p.re.test(text)) out.push({ file: rel, rule: `banned phrase: ${p.name}`, text: quote(text) });
    }
    for (const p of ACCURACY_CLAIMS) {
      if (p.re.test(text)) out.push({ file: rel, rule: `accuracy claim: ${p.name}`, text: quote(text) });
    }
    if (MOAT_OVERSTATEMENT.test(text)) {
      out.push({ file: rel, rule: 'overstates pass-context coverage', text: quote(text) });
    }
  }
  return out;
}

// ── The sweep ────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SERVER_SRC = `${REPO}/server/src`;

/**
 * THE SCANNED SURFACE (widened 2026-09-03).
 *
 * It was `pages/` and `components/` plus the two prose files, and that was
 * where the copy pass had run. It was also, quietly, the reason the guard
 * stayed green: every remaining offender in the product lived one directory
 * over. A hook writes the browser-tab title a drafter reads while the clock
 * runs; a util writes the scouting line on every roster card; the server's
 * middleware writes the sentence a user sees when their session dies. None
 * of those are less user-facing than a page, and none of them were scanned.
 *
 * What each directory adds:
 *
 *   * `utils/`      — `playerWriteup.ts` alone ships on three screens
 *                     (HockeyPlayerCard, MobileRosterList, PlayerStatsModal).
 *   * `hooks/`      — toast copy, notification bodies, `document.title`.
 *   * server `routes/`, `middleware/`, `lib/`, `draft/` — every API error
 *                     message and every WebSocket error payload. `error.message`
 *                     is rendered verbatim by the client's toast layer, so a
 *                     dash typed there reaches the same reader as a dash typed
 *                     in JSX.
 *
 * STILL OUT, and this is a measurement rather than a guess. Adding the rest
 * of the source tree to SCANNED_DIRS on 2026-09-03 reported 23 offenders,
 * every one an em dash in error copy, across eight files:
 *
 *     api/client.ts                        3
 *     lib/draftClient/submitPick.ts        5
 *     lib/draftClient/toasts.ts            2
 *     lib/userMessage.ts                   3
 *     contexts/LeagueContext.tsx           2
 *     server/src/services/StormyAssistantService.ts   5
 *     server/src/services/LineupService.ts            2
 *     server/src/services/WaiverService.ts            1
 *
 * They are out because they were not this pass's to fix, not because they
 * are excused: a guard that fails on arrival is a guard someone deletes.
 * Fix those eight files and the four directories they live in can join the
 * list in the same diff.
 *
 * `services/` and `stores/` on the web side measured CLEAN and are held back
 * only to keep one directory per pass; `services/StormyService.ts` is already
 * scanned by name through PROSE_FILES.
 */
const SCANNED_DIRS = [
  `${SRC}/pages`,
  `${SRC}/components`,
  `${SRC}/utils`,
  `${SRC}/hooks`,
  `${SERVER_SRC}/routes`,
  `${SERVER_SRC}/middleware`,
  `${SERVER_SRC}/lib`,
  `${SERVER_SRC}/draft`,
];

const SCOPED = Array.from(
  new Set(
    SCANNED_DIRS.filter((d) => existsSync(d))
      .flatMap((d) => walk(d))
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => !f.includes('__tests__'))
      // shadcn-managed, and CLAUDE.md forbids editing it.
      .filter((f) => !f.startsWith(`${SRC}/components/ui/`))
      .concat(PROSE_FILES.filter((f) => existsSync(f))),
  ),
);

const REL = (f: string) => (f.startsWith(SRC) ? f.slice(SRC.length + 1) : f.slice(REPO.length + 1));

function report(offenders: Offender[]): string {
  return offenders.map((o) => `  ${o.file} [${o.rule}]\n      "${o.text}"`).join('\n');
}

/**
 * QUARANTINE — known offenders in files the widening pass was not scoped to
 * edit. THIS IS NOT THE ALLOWLIST, and the two must not be confused.
 *
 * `ALLOWED` below is for a string that has EARNED an exemption, and it is
 * empty because no string ever has. This list is the opposite: eight strings
 * that are wrong, are named here so nobody has to rediscover them, and are
 * waiting on the pass that owns their file. Scanning `routes/`, `lib/` and
 * `draft/` with these recorded is strictly more coverage than not scanning
 * those directories at all, which was the only other way to keep the suite
 * green on the day the scope widened.
 *
 * The invariant is that it only ever SHRINKS. Two tests enforce that: the
 * sweep may not turn up an offender that is not on this list, and every
 * entry must still match a real offender, so fixing a string forces its
 * removal from here rather than letting the list rot into a permanent
 * exemption.
 *
 * `text` is the offender's quoted form (trimmed, whitespace collapsed,
 * clipped to 120 characters) exactly as `report` prints it, so a failure
 * message can be pasted straight in.
 */
interface Quarantined {
  file: string;
  text: string;
  /** Who reads this string, and what the fix is. */
  why: string;
}

const QUARANTINE: Quarantined[] = [
  // Emptied 2026-09-05: the eight strings recorded here were rewritten in
  // their files (two sentences, a colon, or the dot the sibling title uses).
  // Add to this list only with a `why` a reviewer would accept, and remove
  // the entry in the same PR that fixes the string.
];

const QUARANTINED = new Set(QUARANTINE.map((q) => `${q.file}|${q.text}`));

/** Every offender in the whole scanned surface. */
function sweep(): Offender[] {
  const offenders: Offender[] = [];
  for (const f of SCOPED) {
    // The system prompt quotes the phrase list in order to forbid it; see
    // `offendersIn`. Everything else gets every rule.
    const phrases = f !== PROSE_FILES[0];
    offenders.push(...offendersIn(REL(f), readFileSync(f, 'utf8'), phrases));
  }
  return offenders;
}

describe('AI-voice guard', () => {
  it('scans the surfaces it claims to scan', () => {
    // A wrong path prefix would silently reduce this whole file to a no-op.
    expect(SCOPED.length).toBeGreaterThan(200);
    for (const f of PROSE_FILES) {
      expect(existsSync(f), `${f} moved — the guard is no longer reading Stormy's prompt`).toBe(true);
      expect(SCOPED).toContain(f);
    }
    // Every directory in the list must actually contribute files. A renamed
    // or moved directory would otherwise drop out of the sweep in silence,
    // which is exactly how this guard shipped scanning two directories while
    // reading as though it covered the app.
    for (const dir of SCANNED_DIRS) {
      expect(existsSync(dir), `${dir} is gone — SCANNED_DIRS is stale`).toBe(true);
      expect(
        SCOPED.filter((f) => f.startsWith(`${dir}/`)).length,
        `${dir} contributed no files to the sweep`,
      ).toBeGreaterThan(0);
    }
    // The named prose files are also reached by the directory walk now
    // (systemPrompt.ts lives under server/src/lib). Deduped, so nothing is
    // scanned twice and the phrase-exemption still matches by path.
    expect(new Set(SCOPED).size).toBe(SCOPED.length);
  });

  it('no em dash, banned phrase or accuracy claim in a user-facing string', () => {
    const offenders = sweep();

    // ALLOWLIST: empty, and it should stay that way. If a string genuinely
    // needs one of these, rewrite the string — that is the whole point of
    // the branch this guard shipped on. Known-bad strings awaiting the pass
    // that owns their file go in QUARANTINE instead, which is checked below
    // and may only shrink.
    const ALLOWED: string[] = [];
    const real = offenders.filter(
      (o) => !ALLOWED.includes(`${o.file}|${o.text}`) && !QUARANTINED.has(`${o.file}|${o.text}`),
    );

    expect(real.length, `AI tells in user-facing copy:\n${report(real)}`).toBe(0);
  });

  it('the quarantine only shrinks, and every entry in it is still real', () => {
    const found = new Set(sweep().map((o) => `${o.file}|${o.text}`));

    // A string someone fixed must be DELETED from the list. Without this the
    // quarantine rots into a permanent exemption that nobody can audit,
    // which is the failure mode allowlists always have.
    const stale = QUARANTINE.filter((q) => !found.has(`${q.file}|${q.text}`));
    expect(
      stale.map((q) => `${q.file}: "${q.text}"`),
      'these are no longer offenders — delete them from QUARANTINE',
    ).toEqual([]);

    // The list was eight when server/src entered the sweep and escape
    // decoding landed, both on 2026-09-03. It may go down. It may not go up:
    // a new offender belongs in the diff that introduced it, not in this file.
    expect(QUARANTINE.length).toBeLessThanOrEqual(8);
    expect(new Set(QUARANTINE.map((q) => `${q.file}|${q.text}`)).size).toBe(QUARANTINE.length);
    for (const q of QUARANTINE) {
      expect(q.why.length, `${q.file} has no hand-off note`).toBeGreaterThan(20);
    }
  });

  it('the detector bites: planted offenders are caught', () => {
    const rules = (src: string) => offendersIn('Planted.tsx', src).map((o) => o.rule);

    expect(rules(`const t = "Couldn't load your roster — try again.";`)).toContain('em dash');
    expect(rules('const t = `Ice time — up 2:14 a night.`;')).toContain('em dash');
    expect(rules('<p>Draft complete — set your lineup</p>')).toContain('em dash');
    expect(rules('<span aria-label="Stormy — Assistant GM" />')).toContain('em dash');
    // The apostrophe case that used to hide an offender: a straight quote in
    // JSX prose must not be mistaken for a string opener.
    expect(rules(`<p>Here's everything that ships — no upsells.</p>`)).toContain('em dash');
    expect(rules(`<p>{name}'s roster — set it before puck drop.</p>`)).toContain('em dash');
    // ...and a string after an arrow is still a string, so `>` staying in the
    // opener test does not blind the scanner to `() => 'copy'` callbacks.
    expect(rules(`const f = () => 'Draft complete — set your lineup';`)).toContain('em dash');
    // An escaped em dash is an em dash. This is DraftRoom.tsx's tab title,
    // which sat inside the scanned scope and unseen for the guard's whole life.
    expect(rules(`document.title = "\\uD83D\\uDFE2 Your Turn \\u2014 Citrus Draft";`)).toContain('em dash');
    expect(rules(`const t = 'Ice time \\u2014 up 2:14 a night.';`)).toContain('em dash');
    expect(rules(`const t = 'Ice time \\u{2014} up 2:14 a night.';`)).toContain('em dash');

    expect(rules(`const t = "It's not just a projection, it's an edge.";`)).toContain(
      "banned phrase: it's not just X, it's Y",
    );
    expect(rules(`const t = "Let's dive in and see the numbers.";`)).toContain("banned phrase: let's dive in");
    expect(rules(`const t = "Unlock deeper analysis.";`)).toContain('banned phrase: unlock');
    expect(rules(`const t = "Leverage the shot data.";`)).toContain('banned phrase: leverage (as a verb)');
    expect(rules(`const t = "A real game-changer for your lineup.";`)).toContain('banned phrase: game-changer');
    expect(rules(`const t = "In this fast-paced sport.";`)).toContain("banned phrase: in today's fast-paced world");
    expect(rules(`const t = "The fantasy hockey landscape.";`)).toContain('banned phrase: landscape (as metaphor)');
    expect(rules(`const t = "A testament to the model.";`)).toContain('banned phrase: testament to');
    expect(rules(`const t = "Delve into the splits.";`)).toContain('banned phrase: delve');
    expect(rules(`const t = "A rich tapestry of data.";`)).toContain('banned phrase: tapestry');
    expect(rules(`const t = "Navigate the complexities of waivers.";`)).toContain(
      'banned phrase: navigate the complexities',
    );

    expect(rules(`const t = "The most accurate projections in fantasy hockey.";`)).toContain(
      'accuracy claim: most/wildly accurate',
    );
    expect(rules(`const t = "97.6% accuracy live.";`)).toContain('accuracy claim: a numeric accuracy figure');
    expect(rules(`const t = "We beat ESPN on every projection.";`)).toContain(
      'accuracy claim: beats a named competitor',
    );
    expect(rules(`const t = "Every shot carries our proprietary pass-context features.";`)).toContain(
      'overstates pass-context coverage',
    );
  });

  it('the detector does not bite on comments, data, classes or logs', () => {
    const rules = (src: string) => offendersIn('Clean.tsx', src).map((o) => o.rule);

    // The reason comment stripping is the first thing scan() does.
    expect(rules('// the roster — see below, and unlock the gate')).toEqual([]);
    expect(rules('/* Ice time — up 2:14. A testament to deployment. */')).toEqual([]);
    // Developer-facing.
    expect(rules(`logger.debug('[draft] stale pick — retrying');`)).toEqual([]);
    expect(rules(`logger.warn('queue save failed — falling back', err);`)).toEqual([]);
    // The server's logger has a different name. Eleven LobbyManager log
    // lines were reported as user copy until this receiver was covered.
    expect(rules('structuredLogger.warn(`[lobby] backpressure exceeded — disconnecting`);')).toEqual([]);
    expect(
      rules(`structuredLogger.error('event.self_test_failed', { remediation: 'not pooled — see docs' });`),
    ).toEqual([]);
    // ...but only when the call sits directly on the logger. A factory that
    // merely has "logger" in its name buys no exemption for its arguments.
    expect(rules(`const t = loggerFactory.describe('Draft complete — set your lineup');`)).toContain('em dash');
    // Module paths and Tailwind.
    expect(rules(`import { x } from '@/components/ui/button';`)).toEqual([]);
    expect(rules(`<div className="text-white/55 border-white/10 sm:text-xs" />`)).toEqual([]);
    expect(rules(`<div className={cn('flex gap-2', open && 'unlock-panel')} />`)).toEqual([]);
    // Data.
    expect(rules(`const url = 'https://example.com/a—b';`)).toEqual([]);
    expect(rules(`const key = 'season-outlook-2026';`)).toEqual([]);
    // A regex body is not prose.
    expect(rules('const re = /—/g;')).toEqual([]);
    // The EN dash (U+2013) is the no-data mark in `utils/teamGrades.ts` and
    // is not banned, written either way.
    expect(rules(`const NO_DATA = '\\u2013';`)).toEqual([]);
    expect(rules(`const NO_DATA = '–';`)).toEqual([]);
    // An escaped backslash before a `u` is a backslash, not the start of an
    // escape, so the decoder cannot invent a character nobody typed.
    expect(rules(`const t = 'a path like C:\\\\users2014b, nothing more';`)).toEqual([]);
    // Clean copy stays clean.
    expect(rules(`const t = "Couldn't load your roster. Refresh and we'll pick it back up.";`)).toEqual([]);
    expect(rules('<p>Draft complete. Set your opening lineup.</p>')).toEqual([]);
    // "not just" outside the AI construction is ordinary English.
    expect(rules(`const t = "Every team drafts here, not just yours.";`)).toEqual([]);
    // An apostrophe in prose is prose, not a string opener.
    expect(rules(`<p>Here's everything that ships. No upsells.</p>`)).toEqual([]);
  });

  it("Stormy's prompt still carries the anti-tell contract", () => {
    // The prompt is exempt from the phrase scan because it quotes the phrase
    // list to ban it. This is the test that keeps that exemption honest: it
    // fails when the ban goes MISSING, which is the failure mode that
    // actually matters. A keyword scan can only catch the opposite.
    const prompt = readFileSync(PROSE_FILES[0], 'utf8');
    const body = prompt.slice(prompt.indexOf('export const STORMY_SYSTEM_PROMPT'));

    // Register: an assistant addressing his boss, capped so it is not a tic.
    // The 2026-09-02 prompt licensed "Well boss," on one message in three and
    // every exemplar opened with it, so it became every message. The cap is
    // now once per conversation and never as an opener; these needles pin the
    // rule itself, not the sentence that recounts the old one.
    expect(body).toMatch(/assistant GM/);
    expect(body).toMatch(/once per conversation|once-per-conversation/);
    expect(body).toMatch(/Never in the first sentence of an answer/);
    expect(body).toMatch(/Open with the take/);

    // Every banned construction is named as banned.
    expect(body).toMatch(/NEVER use an em dash/);
    for (const needle of [
      "not just",
      'dive in',
      'fast-paced',
      'game-changer',
      'unlock',
      'leverage',
      'delve',
      'tapestry',
      'landscape',
      'testament to',
      'navigate the complexities',
      'emoji',
      'hedging stacks',
    ]) {
      expect(body, `the prompt stopped banning "${needle}"`).toContain(needle);
    }

    // Sources named, and the model named as the source of its own numbers.
    for (const src of ['NHL.com', 'Citrus xG v3', 'Citrus GSAx', 'Citrus ROS projection']) {
      expect(body, `the prompt stopped naming ${src} as a source`).toContain(src);
    }

    // The two claims that must never be made, and the figures behind them.
    expect(body).toMatch(/Never claim projection accuracy/i);
    expect(body).toContain('118,975');
    expect(body).toContain('1.0010');
    expect(body).toContain('1,026,149');
    expect(body).toContain('10,047');
    // The coverage figure has to appear WITH its denominator context. 10,047
    // of 118,975 is about 8%, and a prompt that states the numerator alone
    // invites the model to imply the moat covers the whole season.
    expect(body).toMatch(/10,047[^]{0,200}8%/);
    expect(body).toMatch(/Never overstate the pass-context coverage/i);

    // RULE 0 is load-bearing and outranks the voice rules.
    expect(body).toMatch(/RULE 0/);
    expect(body).toMatch(/OUTRANKS EVERY OTHER RULE/);
    expect(body).toMatch(/VERIFIED\s*\n?\s*PLAYER DATA/);
  });

  it('template interpolations are cut out, so data never trips the guard', () => {
    // `player.name` could be anything, including a name with a dash in it.
    // Only the literal chunks an author typed are examined.
    const src = 'const t = `${player.name} leads the group`;';
    expect(offendersIn('Clean.tsx', src)).toEqual([]);
    const withDash = 'const t = `${player.name} — leads the group`;';
    expect(offendersIn('Planted.tsx', withDash).map((o) => o.rule)).toEqual(['em dash']);
  });
});

describe('the shared vocabulary stays readable by both languages', () => {
  const everyPattern = [
    ...VOICE.bannedPhrases,
    ...VOICE.accuracyClaims,
    VOICE.moatOverstatement,
  ];

  it('has patterns', () => {
    // A JSON that silently became empty would make every sweep below pass
    // while guarding nothing at all.
    expect(everyPattern.length).toBeGreaterThan(12);
  });

  it.each(everyPattern.map((p) => [p.name, p.pattern]))(
    'uses only JS/Python-portable syntax: %s',
    (name, pattern) => {
      for (const v of CROSS_LANGUAGE_VIOLATIONS) {
        expect(
          v.re.test(pattern as string),
          `${name} uses ${v.name}, which Python's re does not read the same way`,
        ).toBe(false);
      }
    },
  );

  it('every pattern compiles as a regex', () => {
    for (const p of everyPattern) {
      expect(() => new RegExp(p.pattern, 'i')).not.toThrow();
    }
  });

  // The detector is worthless if the portability rule never fires.
  it('the portability rule bites', () => {
    const offenders = ['(?<=foo)bar', '(?<year>\\d{4})', '\\p{Letter}+', '/already-a-literal/i'];
    for (const bad of offenders) {
      expect(CROSS_LANGUAGE_VIOLATIONS.some((v) => v.re.test(bad)), bad).toBe(true);
    }
  });

  it('the em dash the JSON names is the real U+2014', () => {
    expect(VOICE.emDash.char).toBe('\u2014');
    // EM_DASH is the regex the sweep runs; the JSON is what Python reads.
    // They must be the same character or the two languages ban different things.
    expect(EM_DASH.test(VOICE.emDash.char)).toBe(true);
  });
});

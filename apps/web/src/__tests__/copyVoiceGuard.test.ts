import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * COPY-VOICE GUARD (2026-09-03).
 *
 * `docs/COPY_VOICE.md` is the copy spec. It was written against a harvest of
 * shipped strings (55x `title: "Error"`, 4x `title: "Success"`), it bans a
 * short list of constructions outright, and it sets three brevity budgets.
 * The U7 conformance sweep took the `title: "Error"` count to zero and
 * stopped there, because a sweep is a moment and the spec is a law. On the
 * day this file landed:
 *
 *   * nothing prevented the 56th `title: "Error"`;
 *   * the empty-state idiom (kicker, primary line, context, one verb) had
 *     no guard at all, and "No data" / "No X found" was shipping in nine
 *     places, three of them the exact "No players found" the spec quotes
 *     as the thing to stop writing;
 *   * the brevity budgets had never been measured.
 *
 * This is the regression test for the spec. Same idiom as
 * `aiVoiceGuard.test.ts`: walk the source, extract the strings a person can
 * read, ban the defect CLASS, and prove the detector bites with planted
 * offenders so the suite cannot sit green while guarding nothing.
 *
 * ── RELATION TO aiVoiceGuard ─────────────────────────────────────────
 *
 * The extraction below is a port of that file's scanner, not an import.
 * Importing a test module registers its suites a second time under this
 * file's name, and the repo's convention for sharing a voice rule between
 * suites (see `utils/__tests__/playerWriteup.test.ts`) is to restate the
 * mechanism and share the VOCABULARY through
 * `packages/shared/src/constants/aiVoice.json`. That is what this file
 * does: every banned phrase, every banned title and every budget number is
 * read from the JSON's `copyBans` key, which aiVoiceGuard does not read, so
 * adding to it changes nothing about that guard.
 *
 * The port has to stay in step with the original on the cases that matter,
 * and "the detector does not bite" below replays them: an apostrophe in JSX
 * prose is not a string opener, a string after `return`/`case`/`=>` is still
 * a string, an escaped character is the character, and a template's
 * interpolations are cut out so data never trips the guard.
 *
 * ── WHAT IS SCANNED ──────────────────────────────────────────────────
 *
 * All of `apps/web/src`, minus `__tests__/**` (fixtures deliberately hold
 * offenders; this file is full of them) and `components/ui/**` (shadcn,
 * CLAUDE.md says do not modify). This is WIDER than aiVoiceGuard's web-side
 * list on purpose: a toast fired from `services/` or a message thrown in
 * `lib/` reaches the same reader as one typed in a page, and
 * `lib/userMessage.ts` passes every app-authored `Error.message` straight
 * through to the screen.
 *
 * Excluded by RANGE, never by guessing at the text:
 *
 *   * `logger.*(…)` / `*Logger.*(…)` / `console.*(…)` arguments, and calls
 *     on a file-local alias of one (`Matchup.tsx` writes its debug lines
 *     through `const log = DEBUG_MATCHUP ? logger.log.bind(…) : () => {}`);
 *   * comparison operands: `x.includes('Failed to fetch')`,
 *     `err.message === 'Failed to fetch'`, `case 'No data':`. A string you
 *     compare against is a string you are HANDLING, and the only way to
 *     handle Chrome's "Failed to fetch" is to name it;
 *   * Tailwind class strings, import specifiers, URLs, and bare
 *     identifiers, exactly as aiVoiceGuard treats them.
 *
 * ── WHAT IT BANS AND MEASURES ────────────────────────────────────────
 *
 *   1. `title: "Error"` / `title: "Success"`, in any quote style, as a
 *      property or a JSX attribute. The spec's exit criterion was
 *      `grep -c 'title: "Error"' -> 0`; this is that grep made permanent
 *      and quote-agnostic.
 *   2. The banned vocabulary: "No data", "No X found", "Oops", "Uh oh", a
 *      naked "Something went wrong", "Failed to fetch". These run against
 *      EVERY literal, including single-token ones, because `'Oops'` alone is
 *      exactly the string the spec bans.
 *   3. Raw error codes in prose: PGRST codes, ERR_ and E network codes, HTTP
 *      status numbers, `[object Object]`, TypeError-shaped runtime faults.
 *      Sentence-shaped literals only: `code: 'ERR_NETWORK'` is data.
 *   4. Brevity, where it is statically determinable:
 *        toast title        <= 4 words      (`toast({ title })`, and sonner's
 *                                            first argument when a description
 *                                            is supplied)
 *        toast description  <= 2 sentences  (`toast({ description })`, and a
 *                                            sonner call with no description,
 *                                            whose first argument IS the body)
 *        empty-state primary <= 8 words     (the `<p>` in pastel-cream bold
 *                                            that follows a ✦ kicker)
 *      A title built from `${…}` is not measured; a ternary of literals is
 *      measured once per literal.
 *
 * ── BIDIRECTIONAL ────────────────────────────────────────────────────
 *
 * Every rule above is satisfied by an app with no toasts and no empty
 * states, so the guard also pins the positive half: the toast helper is
 * still called at hundreds of sites, the kicker idiom is still on the page,
 * the three exemplar kickers COPY_VOICE names as law are still shipped, the
 * vocabulary lists are non-empty, and the budgets in the JSON are the
 * budgets in the doc.
 */

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = resolve(HERE, '..').replace(/\\/g, '/');
const REPO = resolve(SRC, '../../..').replace(/\\/g, '/');
const COPY_VOICE_DOC = `${REPO}/docs/COPY_VOICE.md`;
const VOICE_JSON = `${REPO}/packages/shared/src/constants/aiVoice.json`;

// ── Vocabulary ───────────────────────────────────────────────────────

interface Pattern {
  name: string;
  pattern: string;
}

const VOICE = JSON.parse(readFileSync(VOICE_JSON, 'utf8')) as {
  copyBans: {
    toastTitles: Pattern[];
    phrases: Pattern[];
    rawErrorCodes: Pattern[];
    budgets: {
      toastTitleWords: number;
      toastDescriptionSentences: number;
      emptyStatePrimaryWords: number;
    };
  };
};

const compile = (list: Pattern[]) => list.map(({ name, pattern }) => ({ name, re: new RegExp(pattern, 'i') }));

export const TOAST_TITLE_BANS = compile(VOICE.copyBans.toastTitles);
export const PHRASE_BANS = compile(VOICE.copyBans.phrases);
export const RAW_ERROR_CODES = compile(VOICE.copyBans.rawErrorCodes);
export const BUDGETS = VOICE.copyBans.budgets;

/** The same portability contract aiVoiceGuard pins on the older keys. */
const CROSS_LANGUAGE_VIOLATIONS: Array<{ name: string; re: RegExp }> = [
  { name: 'lookbehind', re: /\(\?<[=!]/ },
  { name: 'named group', re: /\(\?<[A-Za-z_]/ },
  { name: 'unicode property escape', re: /\\[pP]\{/ },
  { name: 'atomic or possessive group', re: /\(\?>|[*+?}]\+/ },
  { name: 'a slash-wrapped literal rather than a bare pattern', re: /^\/.*\/[a-z]*$/ },
];

// ── Extraction (ported from aiVoiceGuard.test.ts) ────────────────────

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

const KEYWORD_BEFORE_STRING = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'await',
  'yield', 'else', 'do', 'instanceof', 'throw', 'from', 'import', 'export',
  'default', 'as', 'extends', 'satisfies',
]);

/**
 * Is the quote at `pos` opening a string literal, or is it an apostrophe in
 * JSX prose? A quote can only START an expression, so it opens a string
 * unless the previous significant character ends one: an identifier (that
 * is not a keyword), a number, a closing bracket, or `}`. `>` is let through
 * only as the tail of `=>`.
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

function skipString(src: string, i: number): number {
  const q = src[i];
  i++;
  while (i < src.length && src[i] !== q && src[i] !== '\n') {
    if (src[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

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
 * One pass, four states: code, comment, regex, string body. Returns the
 * literal contents plus a per-character "this is code" mask.
 */
export function scan(src: string): ScanResult {
  const strings: Extracted[] = [];
  const isCode = new Array<boolean>(src.length).fill(true);
  const blank = (a: number, b: number) => {
    for (let k = a; k < b && k < src.length; k++) isCode[k] = false;
  };

  let i = 0;
  const n = src.length;
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
          // The interpolation is scanned, not skipped, so a literal nested
          // inside one is still seen, and the child's code mask is merged so
          // JSX inside a ternary stays visible to `jsxText`.
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
    // `<` and `>` are deliberately absent: `</span>` puts a slash straight
    // after a `<`, and nothing real writes `a < /re/.test(b)`.
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

/** Close the bracket opened just before `i`, counting only code characters. */
function closeFrom(src: string, isCode: boolean[], i: number, open: string, close: string): number {
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (isCode[i]) {
      if (src[i] === open) depth++;
      else if (src[i] === close) depth--;
    }
    i++;
  }
  return i;
}

/** Character ranges whose strings are handled or logged, not read. */
function excludedRanges(src: string, isCode: boolean[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;

  // `logger.debug(...)` / `structuredLogger.warn(...)` / `console.warn(...)`.
  const call = /\b(?:\w*[Ll]ogger|console)\s*\.\s*\w+\s*\(/g;
  while ((m = call.exec(src))) {
    if (!isCode[m.index]) continue;
    ranges.push([m.index, closeFrom(src, isCode, m.index + m[0].length, '(', ')')]);
  }

  // A file-local alias OF a logger is a logger. `Matchup.tsx` declares
  //   const log = DEBUG_MATCHUP ? logger.log.bind(logger, '[Matchup]') : () => {};
  // and then writes six debug lines through it. Matching the receiver name
  // alone would exempt any function called `log`; the alias must be declared
  // in THIS file as a binding of a logger expression to earn the exemption.
  const alias = /\b(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*\b\w*[Ll]ogger\b[^;\n]*/g;
  const aliases = new Set<string>();
  while ((m = alias.exec(src))) {
    if (isCode[m.index]) aliases.add(m[1]);
  }
  for (const name of aliases) {
    const use = new RegExp(`\\b${name}\\s*\\(`, 'g');
    while ((m = use.exec(src))) {
      if (!isCode[m.index]) continue;
      ranges.push([m.index, closeFrom(src, isCode, m.index + m[0].length, '(', ')')]);
    }
  }

  // A string passed to a comparison method is being matched, not shown.
  const cmp = /\.\s*(?:includes|startsWith|endsWith|indexOf|lastIndexOf|test|match|matchAll|replace|replaceAll|split|localeCompare|has|equals)\s*\(/g;
  while ((m = cmp.exec(src))) {
    if (!isCode[m.index]) continue;
    ranges.push([m.index, closeFrom(src, isCode, m.index + m[0].length, '(', ')')]);
  }

  // Tailwind: className/class attributes and the class-merging helpers.
  const tw = /\b(?:className|class)\s*=\s*|(?:\b(?:cn|cva|clsx|twMerge)\s*\()/g;
  while ((m = tw.exec(src))) {
    if (!isCode[m.index]) continue;
    let i = m.index + m[0].length;
    if (src[i] === '{') {
      i = closeFrom(src, isCode, i + 1, '{', '}');
    } else if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      i++;
      while (i < src.length && src[i] !== q) i++;
      i++;
    } else {
      i = closeFrom(src, isCode, i, '(', ')');
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

/**
 * `err.message === 'Failed to fetch'`, `'Failed to fetch' !== msg`,
 * `case 'No data':`. The operand of an equality test, or a switch label, is
 * a string the code is looking FOR, which is the one context in which naming
 * a banned string is the fix rather than the fault.
 */
function isComparisonOperand(src: string, s: Extracted): boolean {
  if (s.kind === 'jsx') return false;
  let a = s.start - 2;
  while (a >= 0 && (src[a] === ' ' || src[a] === '\t')) a--;
  const before = src.slice(Math.max(0, a - 4), a + 1);
  if (/[=!]==?$/.test(before) || /\bcase$/.test(before)) return true;
  let b = s.start + s.text.length + 1;
  while (b < src.length && (src[b] === ' ' || src[b] === '\t')) b++;
  return /^[=!]==?/.test(src.slice(b, b + 3));
}

const URL_OR_PATH = /^(?:https?:|mailto:|tel:|data:|blob:|\/|\.{1,2}\/|@\/|#[\w-]*$)/;
/** `player-dashboard`, `TEAM_ABBREV`, `sm:text-xs`: identifiers, not prose. */
const IDENTIFIER = /^[\w$@./:%[\]#-]*$/;

/** `"…"` is an ellipsis, and a scanner that reads source must decode it. */
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

/** Could a person read this on screen? (Sentence-shaped: has a space.) */
export function isUserFacing(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (URL_OR_PATH.test(t)) return false;
  if (IDENTIFIER.test(t)) return false;
  return true;
}

/** Not a path, not empty. Single tokens allowed: `'Oops'` is a whole toast. */
function isReadable(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && !URL_OR_PATH.test(t);
}

// ── Brevity ──────────────────────────────────────────────────────────

const WORD = /[A-Za-z0-9À-ɏ]/;

/** Whitespace-separated tokens that carry a letter or digit. "Pick's In" is 2; "Demo Mode - Read Only" is 4. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => WORD.test(w)).length;
}

const ABBREVIATION_BEFORE_STOP = /\b(?:vs|st|mr|mrs|ms|dr|jr|sr|etc|e\.g|i\.e)$/i;

/**
 * Sentences: a terminal mark, then whitespace, then something that opens a
 * sentence. "vs. Boston" and "St. Louis" do not split. Conservative on
 * purpose: an under-count here is a budget quietly unenforced, an over-count
 * is a guard someone deletes.
 */
export function sentenceCount(text: string): number {
  const t = text.trim();
  if (!/[A-Za-z0-9]/.test(t)) return 0;
  let count = 1;
  const boundary = /[.!?…]+["')”]?\s+(?=[A-Z"'(“])/g;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(t))) {
    if (ABBREVIATION_BEFORE_STOP.test(t.slice(0, m.index))) continue;
    count++;
  }
  return count;
}

// ── Offenders ────────────────────────────────────────────────────────

export interface Offender {
  file: string;
  rule: string;
  text: string;
}

export interface Measured {
  /** Every `toast({…})` call, literal title or not. */
  toastCalls: number;
  /** Every sonner `toast.<kind>(…)` call. */
  sonnerCalls: number;
  /** Every ✦ kicker in JSX text. */
  kickers: number;
  /** Every empty-state primary line measured against the budget. */
  primaries: number;
  /** Every toast title literal measured against the budget. */
  titles: number;
  /** Every toast description literal measured against the budget. */
  descriptions: number;
}

const quote = (t: string) => t.trim().replace(/\s+/g, ' ').slice(0, 120);

/** `${…}` was cut out of this chunk, so its word count is not its own. */
function isInterpolated(src: string, s: Extracted): boolean {
  if (s.kind !== 'template') return false;
  const end = s.start + s.text.length;
  return src[end] !== '`' || src[s.start - 1] !== '`';
}

/**
 * Every literal that is the value of a `title:` property or a `title=`
 * attribute, plus every literal title/description of a toast.
 */
function toastFields(
  src: string,
  scanned: ScanResult,
  byStart: Map<number, Extracted>,
  measured: Measured,
): Array<{ field: 'title' | 'description'; text: string }> {
  const out: Array<{ field: 'title' | 'description'; text: string }> = [];
  const { isCode, strings } = scanned;
  let m: RegExpExecArray | null;

  const literalAt = (pos: number): Extracted | undefined => {
    const s = byStart.get(pos + 1);
    if (!s || isInterpolated(src, s)) return undefined;
    return s;
  };
  /**
   * Literals inside an expression value (`ok ? 'Saved' : 'Not Saved'`), up
   * to the end of its line or the comma that ends the property.
   */
  const literalsInValue = (from: number): Extracted[] => {
    let to = src.length;
    let depth = 0;
    for (let i = from; i < src.length; i++) {
      if (src[i] === '\n') {
        to = i;
        break;
      }
      if (!isCode[i]) continue;
      if ('([{'.includes(src[i])) depth++;
      else if (')]}'.includes(src[i]) || src[i] === ',') {
        if (depth === 0) {
          to = i;
          break;
        }
        if (src[i] !== ',') depth--;
      }
    }
    return strings.filter(
      (s) => s.start >= from && s.start < to && !isInterpolated(src, s) && isUserFacing(s.text),
    );
  };

  // shadcn: toast({ title, description, ... })
  const call = /\btoast\s*\(\s*\{/g;
  while ((m = call.exec(src))) {
    if (!isCode[m.index]) continue;
    measured.toastCalls++;
    const bodyStart = m.index + m[0].length;
    const bodyEnd = closeFrom(src, isCode, bodyStart, '{', '}') - 1;
    const body = src.slice(bodyStart, bodyEnd);
    const key = /(?:^|[{,\s])(title|description)\s*:\s*/g;
    let km: RegExpExecArray | null;
    while ((km = key.exec(body))) {
      const valueStart = bodyStart + km.index + km[0].length;
      if (!isCode[bodyStart + km.index + 1]) continue;
      const field = km[1] as 'title' | 'description';
      const c = src[valueStart];
      if (c === '"' || c === "'" || c === '`') {
        const s = literalAt(valueStart);
        if (s) out.push({ field, text: decodeEscapes(s.text) });
      } else {
        for (const s of literalsInValue(valueStart)) out.push({ field, text: decodeEscapes(s.text) });
      }
    }
  }

  // sonner: toast.error('title', { description }) / toast.success('body')
  const sonner = /\btoast\s*\.\s*(?:error|success|info|warning|message|loading)\s*\(\s*/g;
  while ((m = sonner.exec(src))) {
    if (!isCode[m.index]) continue;
    measured.sonnerCalls++;
    const argStart = m.index + m[0].length;
    const paren = m.index + m[0].lastIndexOf('(');
    const body = src.slice(paren + 1, closeFrom(src, isCode, paren + 1, '(', ')') - 1);
    const hasDescription = /\bdescription\s*:/.test(body);
    const c = src[argStart];
    if (c !== '"' && c !== "'" && c !== '`') continue;
    const s = literalAt(argStart);
    if (s) out.push({ field: hasDescription ? 'title' : 'description', text: decodeEscapes(s.text) });
  }
  return out;
}

/** Every literal that is the value of a `title:` property or `title=` attribute. */
function titleLiterals(src: string, isCode: boolean[], byStart: Map<number, Extracted>): string[] {
  const out: string[] = [];
  const re = /\btitle\s*[:=]\s*(["'`])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (!isCode[m.index]) continue;
    const s = byStart.get(m.index + m[0].length);
    if (s && !isInterpolated(src, s)) out.push(decodeEscapes(s.text));
  }
  return out;
}

const KICKER = '✦';

/**
 * The primary line of every empty-state stack: the first `<p>` after a ✦
 * kicker whose classes carry the primary treatment (pastel-cream, bold).
 * A plain text body is one line; a `{…}` body yields each literal in it.
 */
function emptyStatePrimaries(src: string, scanned: ScanResult, measured: Measured): string[] {
  const out: string[] = [];
  const { isCode, strings } = scanned;
  let at = src.indexOf(KICKER);
  while (at !== -1) {
    if (isCode[at]) {
      measured.kickers++;
      // The next `<p` that is a paragraph, not `<path` or `<PlayerCard`.
      let open = src.indexOf('<p', at);
      while (open !== -1 && open - at < 700 && !/[\s>]/.test(src[open + 2] ?? '')) {
        open = src.indexOf('<p', open + 1);
      }
      if (open !== -1 && open - at < 700) {
        // The tag's `>`: skip over `{…}` in attribute values.
        let i = open + 2;
        while (i < src.length && src[i] !== '>') {
          if (src[i] === '{') i = closeFrom(src, isCode, i + 1, '{', '}');
          else i++;
        }
        const attrs = src.slice(open, i);
        const close = src.indexOf('</p>', i);
        if (close !== -1 && attrs.includes('text-pastel-cream') && attrs.includes('font-bold')) {
          const body = src.slice(i + 1, close);
          if (!body.includes('{')) {
            out.push(body);
          } else {
            for (const s of strings) {
              if (s.start > i && s.start < close && !isInterpolated(src, s) && isUserFacing(s.text)) {
                out.push(decodeEscapes(s.text));
              }
            }
          }
        }
      }
    }
    at = src.indexOf(KICKER, at + 1);
  }
  return out;
}

/**
 * Every offender in one file's source. Exported so the codebase sweep and
 * the planted-offender tests run the SAME detector.
 */
export function offendersIn(rel: string, src: string, measured: Measured = emptyMeasured()): Offender[] {
  const scanned = scan(src);
  const { strings, isCode } = scanned;
  const byStart = new Map<number, Extracted>();
  for (const s of strings) byStart.set(s.start, s);
  const skip = excludedRanges(src, isCode);
  const inSkip = (pos: number) => skip.some(([a, b]) => pos >= a && pos < b);
  const out: Offender[] = [];

  // 1. Banned titles.
  for (const text of titleLiterals(src, isCode, byStart)) {
    for (const p of TOAST_TITLE_BANS) {
      if (p.re.test(text)) out.push({ file: rel, rule: `banned title: ${p.name}`, text: quote(text) });
    }
  }

  // 2 + 3. Banned vocabulary and raw codes, in everything a person reads.
  const readable = [...strings, ...jsxText(src, isCode)].filter(
    (s) => !inSkip(s.start) && !isComparisonOperand(src, s) && isReadable(s.text),
  );
  for (const s of readable) {
    const text = decodeEscapes(s.text);
    for (const p of PHRASE_BANS) {
      if (p.re.test(text)) out.push({ file: rel, rule: `banned copy: ${p.name}`, text: quote(text) });
    }
    if (!isUserFacing(text)) continue;
    for (const p of RAW_ERROR_CODES) {
      if (p.re.test(text)) out.push({ file: rel, rule: `raw error code: ${p.name}`, text: quote(text) });
    }
  }

  // 4. Brevity.
  for (const f of toastFields(src, scanned, byStart, measured)) {
    if (f.field === 'title') {
      measured.titles++;
      const n = wordCount(f.text);
      if (n > BUDGETS.toastTitleWords) {
        out.push({ file: rel, rule: `toast title over budget: ${n} words`, text: quote(f.text) });
      }
    } else {
      measured.descriptions++;
      const n = sentenceCount(f.text);
      if (n > BUDGETS.toastDescriptionSentences) {
        out.push({ file: rel, rule: `toast description over budget: ${n} sentences`, text: quote(f.text) });
      }
    }
  }
  for (const text of emptyStatePrimaries(src, scanned, measured)) {
    measured.primaries++;
    const n = wordCount(text);
    if (n > BUDGETS.emptyStatePrimaryWords) {
      out.push({ file: rel, rule: `empty-state primary over budget: ${n} words`, text: quote(text) });
    }
  }
  return out;
}

export function emptyMeasured(): Measured {
  return { toastCalls: 0, sonnerCalls: 0, kickers: 0, primaries: 0, titles: 0, descriptions: 0 };
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

const SCOPED = walk(SRC)
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => !f.includes('__tests__'))
  .filter((f) => !f.startsWith(`${SRC}/components/ui/`));

const REL = (f: string) => f.slice(SRC.length + 1);

function report(offenders: Offender[]): string {
  return offenders.map((o) => `  ${o.file} [${o.rule}]\n      "${o.text}"`).join('\n');
}

/**
 * KNOWN_REMAINING: offenders in files this pass was not scoped to edit,
 * recorded so the guard could ship at full width. THIS IS A RATCHET. Every
 * entry must still match a real offender (fixing one forces its removal),
 * and the list may only shrink; a new offender belongs in the diff that
 * wrote it.
 *
 * `text` is the offender's quoted form exactly as `report` prints it, so a
 * failure message can be pasted straight in. `proposed` is the rewrite
 * that satisfies COPY_VOICE, so the owning pass has no thinking to do.
 */
interface KnownRemaining {
  file: string;
  text: string;
  /** Who owns the file, and the rewrite. */
  proposed: string;
}

const KNOWN_REMAINING: KnownRemaining[] = [
  // Empty on 2026-09-03. The eleven entries this list started with were all
  // rewritten the same night (draft pool, draft room toasts, free agents,
  // matchup and playoff-bracket errors, Stormy's failure line, the swap hint,
  // the scores detail panel). An entry goes back in only with a `proposed`
  // rewrite attached and a reason the file could not be edited in the same
  // change; the ratchet below refuses a longer list.
];

const KNOWN = new Set(KNOWN_REMAINING.map((k) => `${k.file}|${k.text}`));

function sweep(): { offenders: Offender[]; measured: Measured } {
  const measured = emptyMeasured();
  const offenders: Offender[] = [];
  for (const f of SCOPED) offenders.push(...offendersIn(REL(f), readFileSync(f, 'utf8'), measured));
  return { offenders, measured };
}

const SWEEP = sweep();

describe('copy-voice guard', () => {
  it('scans the surfaces it claims to scan', () => {
    // A wrong path prefix would silently reduce this whole file to a no-op.
    expect(SCOPED.length).toBeGreaterThan(300);
    for (const dir of ['pages', 'components', 'hooks', 'services', 'lib', 'utils']) {
      expect(
        SCOPED.filter((f) => f.startsWith(`${SRC}/${dir}/`)).length,
        `${dir}/ contributed no files to the sweep`,
      ).toBeGreaterThan(0);
    }
    expect(SCOPED.some((f) => f.includes('/components/ui/'))).toBe(false);
    expect(SCOPED.some((f) => f.includes('__tests__'))).toBe(false);
  });

  it('no banned title, banned copy, raw error code or blown budget in user-facing copy', () => {
    const real = SWEEP.offenders.filter((o) => !KNOWN.has(`${o.file}|${o.text}`));
    expect(real.length, `COPY_VOICE violations:\n${report(real)}`).toBe(0);
  });

  it('the known-remaining list only shrinks, and every entry in it is still real', () => {
    const found = new Set(SWEEP.offenders.map((o) => `${o.file}|${o.text}`));
    const stale = KNOWN_REMAINING.filter((k) => !found.has(`${k.file}|${k.text}`));
    expect(
      stale.map((k) => `${k.file}: "${k.text}"`),
      'these are no longer offenders. Delete them from KNOWN_REMAINING',
    ).toEqual([]);
    // 11 on 2026-09-03, the day the guard landed. Down is fine. Up is not.
    // Ratchet. Started at 11 on 2026-09-03 and reached 0 the same night. It
    // only ever goes down; raising it is a proposal to ship banned copy.
    expect(KNOWN_REMAINING.length).toBeLessThanOrEqual(0);
    expect(new Set(KNOWN_REMAINING.map((k) => `${k.file}|${k.text}`)).size).toBe(KNOWN_REMAINING.length);
    for (const k of KNOWN_REMAINING) {
      expect(k.proposed.length, `${k.file} has no proposed rewrite`).toBeGreaterThan(20);
    }
  });

  it('the surfaces it measures are still there (deleting them is not conformance)', () => {
    const m = SWEEP.measured;
    // 292 `toast({…})` calls across the app on 2026-09-03 (use-toast.ts says the same).
    expect(m.toastCalls, 'toast({…}) call sites').toBeGreaterThan(200);
    expect(m.titles, 'literal toast titles measured').toBeGreaterThan(200);
    expect(m.descriptions, 'literal toast descriptions measured').toBeGreaterThan(100);
    // 64 ✦ kickers, 11 of them heading an empty-state stack with a measurable primary line.
    expect(m.kickers, 'kicker sites').toBeGreaterThan(30);
    expect(m.primaries, 'empty-state primary lines measured').toBeGreaterThan(7);
  });

  it('the exemplar empty states COPY_VOICE names as law are still shipped', () => {
    const read = (rel: string) => readFileSync(`${SRC}/${rel}`, 'utf8');
    expect(read('pages/Standings.tsx')).toContain(`${KICKER} Preseason`);
    expect(read('pages/News.tsx')).toContain(`${KICKER} Nothing on the wire`);
    expect(read('pages/PoolSurvivor.tsx')).toContain(`${KICKER} Everyone's still alive`);
  });

  it('the detector bites: planted offenders are caught', () => {
    const rules = (src: string) => offendersIn('Planted.tsx', src).map((o) => o.rule);

    // 1. The 56th `title: "Error"`, in every spelling.
    expect(rules(`toast({ title: "Error", description: "Team not found." });`)).toContain('banned title: title: "Error"');
    expect(rules(`toast({ title: 'Error', variant: 'destructive' });`)).toContain('banned title: title: "Error"');
    expect(rules('toast({ title: `Error` });')).toContain('banned title: title: "Error"');
    expect(rules(`toast({ title: "Error!" });`)).toContain('banned title: title: "Error"');
    expect(rules(`toast({ title: "Success", description: "Lineup saved." });`)).toContain('banned title: title: "Success"');
    expect(rules(`toast({\n  title: 'Success',\n  description: 'Saved.',\n});`)).toContain('banned title: title: "Success"');
    expect(rules(`<Banner title="Error" />`)).toContain('banned title: title: "Error"');
    expect(rules(`const t = { title: "error" };`)).toContain('banned title: title: "Error"');

    // 2. The banned vocabulary.
    expect(rules(`<span>No data</span>`)).toContain('banned copy: no data');
    expect(rules(`const t = 'No data found';`)).toContain('banned copy: no data');
    expect(rules(`const t = 'No data found';`)).toContain('banned copy: no X found');
    expect(rules(`const t = 'This league has no data yet.';`)).toContain('banned copy: no data');
    expect(rules('const t = `${label}: no data available`;')).toContain('banned copy: no data');
    expect(rules(`<div>No players found. Try adjusting your filters.</div>`)).toContain('banned copy: no X found');
    expect(rules(`<p>No rostered players found for your league.</p>`)).toContain('banned copy: no X found');
    expect(rules(`<span>No matchup found for Week {selectedWeek}</span>`)).toContain('banned copy: no X found');
    expect(rules(`throw new Error('No players found');`)).toContain('banned copy: no X found');
    expect(rules(`return "No data";`)).toContain('banned copy: no data');
    expect(rules(`const t = 'Oops! That did not work.';`)).toContain('banned copy: oops');
    expect(rules(`const t = 'Oops';`)).toContain('banned copy: oops');
    expect(rules(`const t = 'Whoops, try again.';`)).toContain('banned copy: oops');
    expect(rules(`const t = 'Uh oh. Something broke.';`)).toContain('banned copy: uh oh');
    expect(rules(`<span>Something went wrong</span>`)).toContain('banned copy: naked something went wrong');
    expect(rules(`const t = 'Something went wrong.';`)).toContain('banned copy: naked something went wrong');
    expect(rules(`toast({ title: "Something went wrong!" });`)).toContain('banned copy: naked something went wrong');
    expect(rules(`const t = "Failed to fetch";`)).toContain('banned copy: failed to fetch');
    expect(rules(`setError('Failed to fetch your roster.');`)).toContain('banned copy: failed to fetch');
    // An escaped character is the character.
    expect(rules(`const t = 'No\\u0020data';`)).toContain('banned copy: no data');
    // The apostrophe case that used to hide offenders in the original scanner:
    // a straight quote in JSX prose must not swallow the next line.
    expect(rules(`<p>Here's your week</p>\n<span>No data</span>`)).toContain('banned copy: no data');
    // A literal nested in a template interpolation is still a literal.
    expect(rules("const t = `${rows.length ? rows.join(', ') : 'No data'}`;")).toContain('banned copy: no data');

    // 3. Raw error codes in prose.
    expect(rules(`const t = 'Request failed with status code 500';`)).toContain('raw error code: an HTTP status number');
    expect(rules(`const t = 'Error 404: that page is gone.';`)).toContain('raw error code: an HTTP status number');
    expect(rules(`<p>502 Bad Gateway</p>`)).toContain('raw error code: an HTTP status number');
    expect(rules(`const t = 'PGRST116: no rows returned';`)).toContain('raw error code: a PostgREST or SQLSTATE code');
    expect(rules(`const t = 'Network error (ECONNREFUSED), try again';`)).toContain('raw error code: a Node or Chromium network code');
    expect(rules(`const t = 'net::ERR_BLOCKED_BY_CLIENT blocked the request';`)).toContain('raw error code: a Node or Chromium network code');
    expect(rules(`const t = 'Could not save: [object Object]';`)).toContain('raw error code: a JavaScript runtime fault');
    expect(rules(`const t = "TypeError: cannot read properties of undefined";`)).toContain('raw error code: a JavaScript runtime fault');

    // 4. Brevity.
    expect(rules(`toast({ title: 'Your lineup could not be saved today', description: 'Try again.' });`)).toContain(
      'toast title over budget: 7 words',
    );
    expect(rules(`toast({\n  title: "Tap a position to swap",\n  description: "The chip opens Line Change.",\n});`)).toContain(
      'toast title over budget: 5 words',
    );
    expect(rules("toast({ title: 'Could not load the scoring rules' });")).toContain('toast title over budget: 6 words');
    // A ternary of literals is measured once per literal.
    expect(rules(`toast({ title: ok ? 'Saved' : 'Could not save your lineup today' });`)).toContain(
      'toast title over budget: 6 words',
    );
    expect(
      rules(`toast({ title: 'Draft Hiccup', description: 'State not loaded. Start the draft first. Then wait a moment and try again.' });`),
    ).toContain('toast description over budget: 3 sentences');
    // sonner: the first argument is the title when a description follows...
    expect(rules(`toast.error('Could not add the AI teams now', { description: 'Try again.' });`)).toContain(
      'toast title over budget: 7 words',
    );
    // ...and the body when nothing follows.
    expect(rules(`toast.error('One thing. Then another. Then a third.');`)).toContain(
      'toast description over budget: 3 sentences',
    );
    expect(rules(`toast.success('Pick is in. Next up is Lime. Then Kiwi.');`)).toContain(
      'toast description over budget: 3 sentences',
    );
    // Empty state: a ten-word primary under a kicker.
    const ten = [
      `<div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">`,
      `  ${KICKER} Preseason`,
      `</div>`,
      `<p className="text-pastel-cream font-bold text-base">`,
      `  The league is still filling up with new teams today.`,
      `</p>`,
    ].join('\n');
    expect(rules(ten)).toContain('empty-state primary over budget: 10 words');
    const ternary = [
      `<div className="font-jbmono uppercase text-pastel-orange-soft font-bold">${KICKER} Preseason</div>`,
      `<p className={cn('text-pastel-cream font-bold', big && 'text-lg')}>`,
      `  {empty ? 'The league is still filling up.' : 'Nobody has played a single game in this league yet.'}`,
      `</p>`,
    ].join('\n');
    expect(rules(ternary)).toContain('empty-state primary over budget: 10 words');
  });

  it('the detector does not bite on comments, data, comparisons, logs or copy at the bar', () => {
    const rules = (src: string) => offendersIn('Clean.tsx', src).map((o) => o.rule);

    // Comments are dropped wholesale.
    expect(rules(`// renders "No data" in PercentileBullet, which is the truth`)).toEqual([]);
    expect(rules(`/* title: "Error" was the old shape. Oops. Something went wrong. */`)).toEqual([]);
    expect(rules(`{/* No players found. Try adjusting your filters. */}`)).toEqual([]);
    // Developer-facing.
    expect(rules(`logger.error('[Matchup] No data returned from getDailyGameStats');`)).toEqual([]);
    expect(rules(`logger.warn('Failed to fetch viewed user display name');`)).toEqual([]);
    expect(rules(`console.warn('No matchup found for week', weekNumber, 'status 500');`)).toEqual([]);
    expect(rules(`structuredLogger.warn('No lineup found for team1:', id);`)).toEqual([]);
    // A file-local alias of a logger is a logger...
    expect(
      rules(
        `const log = DEBUG ? logger.log.bind(logger, '[Matchup]') : () => {};\nlog('No matchups found for week', week);`,
      ),
    ).toEqual([]);
    // ...but only where this file declares it as one. A function that merely
    // happens to be called `log` buys its arguments no exemption.
    expect(rules(`log('No matchups found for week');`)).toContain('banned copy: no X found');
    expect(rules(`const log = makeReporter();\nlog('No matchups found for week');`)).toContain('banned copy: no X found');
    // Handling a string is not showing it.
    expect(rules(`const isChunkError = msg.includes('Failed to fetch dynamically imported module');`)).toEqual([]);
    expect(rules(`if (err.message === 'Failed to fetch') retry();`)).toEqual([]);
    expect(rules(`if ('Failed to fetch' !== err.message) retry();`)).toEqual([]);
    expect(rules(`if (matchupError?.message?.includes('No matchup found')) retry();`)).toEqual([]);
    expect(rules(`switch (reason) { case 'No data': return null; }`)).toEqual([]);
    expect(rules(`if (error.code !== 'PGRST116') throw error;`)).toEqual([]);
    // Codes as data, not prose.
    expect(rules(`const code = 'ERR_NETWORK';`)).toEqual([]);
    expect(rules(`const key = 'no-data';`)).toEqual([]);
    expect(rules(`const NO_DATA = '\\u2013';`)).toEqual([]);
    expect(rules(`const re = /no data|failed to fetch/i;`)).toEqual([]);
    expect(rules(`import { x } from '@/components/ui/toast';`)).toEqual([]);
    expect(rules(`<div className="text-white/55 no-data-track" />`)).toEqual([]);
    // Words that merely contain the banned ones.
    expect(rules(`const t = 'There is no database row for that team.';`)).toEqual([]);
    expect(rules(`const t = 'Nothing on the wire. The news feed is quiet.';`)).toEqual([]);
    expect(rules(`const t = 'Something went wrong on our end. Please try again.';`)).toEqual([]);
    expect(rules(`const t = 'No stories matched that search.';`)).toEqual([]);
    expect(rules(`const t = 'The hoops are set.';`)).toEqual([]);
    // Titles that name a state.
    expect(rules(`toast({ title: "Can't Find That Team", description: "It may have been removed." });`)).toEqual([]);
    expect(rules(`toast({ title: 'Error Saving Lineup' });`)).toEqual([]);
    expect(rules(`toast({ title: 'Waiver Claim Submitted' });`)).toEqual([]);
    expect(rules(`<Banner title="Team Not Found" />`)).toEqual([]);
    // Budgets met exactly.
    expect(rules(`toast({ title: 'Demo Mode - Read Only', description: 'Look around freely. Create your league to play for real.' });`)).toEqual([]);
    expect(rules(`toast({ title: 'Roster Full', description: 'Drop someone first, e.g. a bench forward. Then add.' });`)).toEqual([]);
    expect(rules(`toast.error('Could not share. Use Copy Link');`)).toEqual([]);
    expect(rules("toast({ title: `${name} is yours`, description: `Picked ${n}th overall. Next up: ${next}.` });")).toEqual([]);
    expect(rules(`const t = 'Standings light up after the first slate wraps.';`)).toEqual([]);
    const eight = [
      `<div className="font-jbmono uppercase text-pastel-orange-soft font-bold">${KICKER} Everyone's still alive</div>`,
      `<p className="font-bold text-pastel-cream text-base">Standings light up after the first slate wraps.</p>`,
      `<p className="text-[13px] text-white/55">Lock in your team before puck drops. One wrong pick and you're out.</p>`,
    ].join('\n');
    expect(rules(eight)).toEqual([]);
    // A section kicker followed by body copy is not an empty state.
    const section = [
      `<div className="font-jbmono uppercase text-pastel-orange-soft font-bold">${KICKER} Why Saturday</div>`,
      `<p className="text-white/55 text-sm">Twelve games on a Saturday slate. Maximum chaos. Your matchup comes down to one night.</p>`,
    ].join('\n');
    expect(rules(section)).toEqual([]);
    // A primary line built from data is not measured.
    expect(rules(`<div>${KICKER} Quiet Right Now</div>\n<p className="text-pastel-cream font-bold">{message}</p>`)).toEqual([]);
  });

  it('counts words and sentences the way the spec means them', () => {
    expect(wordCount("Pick's In")).toBe(2);
    expect(wordCount('Demo Mode - Read Only')).toBe(4);
    expect(wordCount('Waiver Claim Submitted')).toBe(3);
    expect(wordCount('  Joined League!  ')).toBe(2);
    // A middot is punctuation, not a word.
    expect(wordCount('Week 1 · Puck Drop')).toBe(4);
    expect(sentenceCount('Rosters for past dates are frozen and cannot be changed.')).toBe(1);
    expect(sentenceCount("Couldn't reach the rink. Retrying, your roster is safe.")).toBe(2);
    expect(sentenceCount('Bedard vs. Boston tonight. Start him.')).toBe(2);
    expect(sentenceCount('St. Louis is on the road. Bench the goalie. Check back at 7.')).toBe(3);
    expect(sentenceCount('Loading your league…')).toBe(1);
    expect(sentenceCount('Saved! Your lineup is set. Good luck.')).toBe(3);
  });
});

describe('the copy-voice vocabulary', () => {
  it('is non-empty, so an emptied JSON cannot pass the sweep by guarding nothing', () => {
    expect(TOAST_TITLE_BANS.length).toBeGreaterThanOrEqual(2);
    expect(PHRASE_BANS.length).toBeGreaterThanOrEqual(5);
    expect(RAW_ERROR_CODES.length).toBeGreaterThanOrEqual(3);
    expect(TOAST_TITLE_BANS.map((p) => p.name)).toContain('title: "Error"');
    expect(TOAST_TITLE_BANS.map((p) => p.name)).toContain('title: "Success"');
    for (const name of ['no data', 'no X found', 'oops', 'naked something went wrong', 'failed to fetch']) {
      expect(PHRASE_BANS.map((p) => p.name), `the JSON stopped banning "${name}"`).toContain(name);
    }
  });

  it('matches the budgets COPY_VOICE states, so the doc is the source of truth', () => {
    expect(existsSync(COPY_VOICE_DOC), 'docs/COPY_VOICE.md moved').toBe(true);
    const doc = readFileSync(COPY_VOICE_DOC, 'utf8');
    const budget = (label: string, unit: string): number => {
      const m = new RegExp(`${label} ≤ (\\d+) ${unit}`).exec(doc);
      expect(m, `COPY_VOICE.md no longer states a budget for "${label}"`).not.toBeNull();
      return Number(m![1]);
    };
    expect(BUDGETS.toastTitleWords).toBe(budget('toast title', 'words'));
    expect(BUDGETS.toastDescriptionSentences).toBe(budget('description', 'sentences'));
    expect(BUDGETS.emptyStatePrimaryWords).toBe(budget('empty-state primary line', 'words'));
    // The doc still names the constructions this file bans.
    for (const needle of ['title: "Error"', 'title: "Success"', '"Oops"', '"Something went wrong"', '"No data"', '"Failed to fetch"']) {
      expect(doc, `COPY_VOICE.md stopped banning ${needle}`).toContain(needle);
    }
  });

  const everyPattern = [...VOICE.copyBans.toastTitles, ...VOICE.copyBans.phrases, ...VOICE.copyBans.rawErrorCodes];

  it('compiles, and uses only JS/Python-portable syntax', () => {
    for (const p of everyPattern) {
      expect(() => new RegExp(p.pattern, 'i')).not.toThrow();
      for (const v of CROSS_LANGUAGE_VIOLATIONS) {
        expect(v.re.test(p.pattern), `${p.name} uses ${v.name}`).toBe(false);
      }
    }
  });

  it('leaves the keys aiVoiceGuard reads exactly where they were', () => {
    // `copyBans` is a sibling, not an addition to `bannedPhrases`: the two
    // guards must not start reporting each other's offenders.
    const raw = JSON.parse(readFileSync(VOICE_JSON, 'utf8')) as Record<string, unknown>;
    for (const key of ['bannedPhrases', 'accuracyClaims', 'moatOverstatement', 'emDash', 'copyBans']) {
      expect(raw, `aiVoice.json lost its "${key}" key`).toHaveProperty(key);
    }
    const older = raw.bannedPhrases as Pattern[];
    expect(older.some((p) => /no data|oops|went wrong|failed to fetch/i.test(p.pattern))).toBe(false);
  });
});

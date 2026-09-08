/**
 * Content moderation for user-supplied names and short text (2026-09-08).
 *
 * Scope: league names, team names, usernames, display names, bios and any
 * user-to-user text. Required for App Store review (Guideline 1.2: apps with
 * user-generated content must filter objectionable material and offer a way to
 * report it). Runs server-side at write time; the client may call it first for
 * an immediate, friendlier message, but the server decision is the one that counts.
 *
 * Design:
 *   - Two tiers. HATE terms are matched inside the text even with spacing, symbols
 *     and leet substitutions removed, because "n1gg3r" and "n.i.g.g.e.r" are the
 *     whole game. PROFANITY terms are matched only as whole tokens after
 *     normalisation, so "Scunthorpe", "Assassins" and "classic" pass.
 *   - Reject, don't mask. A masked slur is still a slur on a leaderboard.
 *   - Deterministic and dependency-free so the same function runs in the browser,
 *     the Hono server and tests.
 *
 * The word lists are intentionally short and targeted. Add to them from real
 * reports (see content_reports), not from a giant generic list that blocks
 * "Cockburn" and lets "n1gg3r" through.
 */

export type ModerationTier = 'hate' | 'profanity';

export interface ModerationResult {
  ok: boolean;
  /** Present when rejected. */
  tier?: ModerationTier;
  /** The canonical term that matched (never echo this to users). */
  term?: string;
  /** User-facing message, safe to show as-is. */
  message?: string;
}

// Slurs and hate terms. Matched as substrings of the squashed text (letters only,
// leet-normalised) so obfuscation does not help. Keep each entry to the
// unambiguous root; add plural/variant roots explicitly rather than widening.
const HATE_TERMS: readonly string[] = [
  'nigger', 'nigga', 'niggah', 'negro',
  'kike', 'kyke',
  'spic', 'spick', 'wetback',
  'chink', 'gook', 'jap', 'zipperhead',
  'raghead', 'towelhead', 'sandnigger',
  'faggot', 'fagot', 'fag', 'dyke', 'tranny', 'shemale',
  'retard', 'retards', 'retarded', 'tard', 'fags', 'spics', 'japs', 'coons', 'pakis',
  'coon', 'darkie', 'darky', 'jigaboo', 'porchmonkey',
  'paki', 'gyppo', 'gypo',
  'squaw', 'redskin', 'prairienigger',
  'heil hitler', 'heilhitler', 'sieg heil', 'siegheil', 'whitepower', 'white power', 'kkk', '1488',
  'rapist', 'raper',
];

// Short hate roots that collide with ordinary words when matched as substrings
// (e.g. "fag" in "fagus", "jap" in "japan", "coon" in "raccoon", "tard" in
// "mustard", "spic" in "conspicuous"). These are matched as whole tokens only.
const HATE_TOKEN_ONLY = new Set(['fag', 'fags', 'jap', 'japs', 'coon', 'coons', 'tard', 'retard', 'retards', 'spic', 'spics', 'paki', 'pakis', 'kkk', '1488', 'negro', 'squaw', 'dyke', 'gook']);

// Ordinary profanity: whole-token match after normalisation.
const PROFANITY_TERMS: readonly string[] = [
  'fuck', 'fucker', 'fucking', 'fucked', 'motherfucker', 'mf', 'stfu',
  'shit', 'shitty', 'bullshit', 'shithead',
  'cunt', 'cunts',
  'cock', 'cocksucker', 'dick', 'dickhead', 'dicks', 'pussy', 'pussies',
  'asshole', 'assholes', 'arsehole',
  'bitch', 'bitches', 'bastard', 'whore', 'slut', 'sluts',
  'twat', 'wanker', 'prick',
  'jizz', 'cum', 'blowjob', 'handjob', 'rimjob',
  'pedo', 'pedophile', 'paedophile',
  'nazi', 'nazis', 'hitler',
];

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '!': 'i', '|': 'l', '€': 'e', '£': 'l', '¢': 'c',
  'ø': 'o', 'ß': 'ss', 'æ': 'ae',
};

/** Lower-case, strip diacritics, map leet, keep letters/digits/spaces. */
export function normalizeForModeration(text: string): string {
  const folded = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  let out = '';
  for (const ch of folded) {
    if (ch in LEET) out += LEET[ch];
    else if (/[a-z]/.test(ch)) out += ch;
    else if (/[0-9]/.test(ch)) out += ch;
    else out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Letters only, repeats collapsed to two, no separators: "n.i.gggg.e.r" -> "nigger". */
function squash(normalized: string): string {
  return normalized.replace(/[^a-z0-9]/g, '').replace(/(.)\1{2,}/g, '$1$1');
}

function tokens(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

const REJECT_MESSAGE: Record<ModerationTier, string> = {
  hate: 'That name includes language we do not allow on Citrus. Please choose another.',
  profanity: 'Keep it clean. That name includes profanity. Please choose another.',
};

/**
 * Check a user-supplied string. Empty/whitespace strings pass (length rules are
 * the caller's job). Returns a safe user-facing message on rejection.
 */
export function moderateText(text: string): ModerationResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: true };
  const normalized = normalizeForModeration(text);
  const squashed = squash(normalized);
  // Letters only without repeat-collapse, so "K K K" -> "kkk" can still be seen.
  const joined = normalized.replace(/[^a-z0-9]/g, '');
  const toks = new Set(tokens(normalized));
  const squashedTokens = new Set(tokens(normalized).map(squash));

  for (const term of HATE_TERMS) {
    const t = squash(normalizeForModeration(term));
    if (!t) continue;
    if (HATE_TOKEN_ONLY.has(term)) {
      if (toks.has(term) || squashedTokens.has(t) || joined === term) return { ok: false, tier: 'hate', term, message: REJECT_MESSAGE.hate };
    } else if (squashed.includes(t)) {
      return { ok: false, tier: 'hate', term, message: REJECT_MESSAGE.hate };
    }
  }
  for (const term of PROFANITY_TERMS) {
    const t = squash(normalizeForModeration(term));
    if (toks.has(term) || squashedTokens.has(t)) return { ok: false, tier: 'profanity', term, message: REJECT_MESSAGE.profanity };
  }
  // Strong roots hidden inside a token ("fuckyou", "cuntface") or split by
  // separators ("f.u.c.k"). Only roots with no innocent English container are
  // checked inside tokens; the one known collision is allow-listed.
  const INNOCENT_CONTAINERS = new Set(['scunthorpe']);
  for (const term of ['fuck', 'cunt', 'motherfucker', 'cocksucker', 'blowjob']) {
    const insideToken = tokens(normalized).some((tok) => tok.includes(term) && !INNOCENT_CONTAINERS.has(tok));
    const splitAcross = squashed.includes(term) && !tokens(normalized).some((tok) => tok.includes(term));
    if (insideToken || splitAcross) return { ok: false, tier: 'profanity', term, message: REJECT_MESSAGE.profanity };
  }
  return { ok: true };
}

/** Convenience for zod: returns the rejection message or null. */
export function moderationError(text: string): string | null {
  const r = moderateText(text);
  return r.ok ? null : (r.message ?? REJECT_MESSAGE.profanity);
}

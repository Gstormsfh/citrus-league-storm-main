/**
 * Name normalisation for matching imported players and managers.
 *
 * The draft kit found four corrupted names in one roster file this week, three
 * of them a first name borrowed from an adjacent player ("Simon Andrae" for
 * Emil Andrae, "Jackson Hinds" for Tyson Hinds). Source platforms carry the
 * same class of error. Normalisation makes honest variants match ("J.T." vs
 * "JT", accents, doubled spaces); it must never make two different people
 * match, which is why it does not touch surnames beyond case and accents and
 * why the crosswalk flags rather than resolves anything ambiguous.
 */

const DIACRITICS = /[\u0300-\u036f]/g;

/** Lowercase, strip accents, collapse punctuation and whitespace. */
export function normalizeName(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[.'\u2019`\-]/g, '')          // J.T. -> jt, O'Reilly -> oreilly, Sandin-Pellikka -> sandinpellikka
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Last whitespace-separated token of the normalised name. */
export function surnameKey(input: string | null | undefined): string {
  const n = normalizeName(input);
  if (!n) return '';
  const parts = n.split(' ');
  return parts[parts.length - 1];
}

/** First token of the normalised name. */
export function firstNameKey(input: string | null | undefined): string {
  const n = normalizeName(input);
  if (!n) return '';
  return n.split(' ')[0];
}

/**
 * Team abbreviation normalisation across sources. ESPN and Yahoo disagree with
 * each other and with the NHL on a handful of clubs; player_directory uses the
 * NHL's three-letter codes.
 */
const TEAM_ALIASES: Record<string, string> = {
  LA: 'LAK', LAK: 'LAK',
  NJ: 'NJD', NJD: 'NJD',
  SJ: 'SJS', SJS: 'SJS',
  TB: 'TBL', TBL: 'TBL',
  WSH: 'WSH', WAS: 'WSH',
  MTL: 'MTL', MON: 'MTL',
  VGK: 'VGK', VEG: 'VGK', LV: 'VGK',
  ARI: 'ARI', PHX: 'ARI',
  UTA: 'UTA', UTAH: 'UTA',
  CBJ: 'CBJ', CLB: 'CBJ',
  NSH: 'NSH', NAS: 'NSH',
  ANA: 'ANA', ANH: 'ANA',
};

export function normalizeTeamAbbr(input: string | null | undefined): string | null {
  if (!input) return null;
  const key = input.trim().toUpperCase();
  return TEAM_ALIASES[key] ?? (key.length === 3 ? key : null);
}

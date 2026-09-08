/**
 * The theme layer.
 *
 * NOTHING IN THE SUITE HARDCODES A PALETTE, A WORDMARK OR A PRIZE RULE. Every
 * surface reads the record loaded here and writes it onto CSS custom
 * properties, so re-skinning the whole suite is a database row, not a deploy.
 *
 * TEAM THEMES CANNOT BE REACHED FROM A PUBLIC BUILD, and the guarantee is at
 * the database rather than in this file. `game_day_themes` grants SELECT only
 * on rows with `requires_feature_flag = false`; a row for a club is invisible
 * to anon and to ordinary authenticated users. So even a client bug that asks
 * for one by key — a query string, a stale link, a mistake in this module —
 * gets nothing back and falls through to neutral Citrus. The flag below is a
 * second lock on the same door, not the only one.
 *
 * THE FALLBACK IS NOT DECORATION. The suite must render on a cold network
 * before any round trip completes: FALLBACK_THEME is the neutral Citrus
 * palette from docs/DESIGN_DIRECTION.md, painted immediately, and the fetched
 * record replaces it when it lands. A phone that never reaches Supabase still
 * gets a correctly branded, readable game.
 */
import { logger } from '@/utils/logger';
import { gameDayDb } from '@/lib/gameDay/db';
import { FEATURE_GAME_DAY_TEAM_THEMES } from '@/lib/featureFlags';

export interface GameDayTheme {
  key: string;
  label: string;
  palette: Record<string, string>;
  brand: { wordmark?: string; logo_url?: string | null; mascot_url?: string | null };
  copy: Record<string, Record<string, string>>;
  prize_rules: { enabled?: boolean; claim_threshold?: number; terms_url?: string | null };
}

/**
 * Neutral Citrus, matching the row the foundation migration seeds. Values are
 * the shipped design tokens: page #0F1F15, card #1A2A20, cream text, sage for
 * success, #FF6B1A as the single accent, and #581E00 as the ONLY legal colour
 * on top of that orange (white on the laser is 2.87:1 and is banned).
 */
export const FALLBACK_THEME: GameDayTheme = {
  key: 'citrus',
  label: 'Citrus',
  palette: {
    surface: '#0F1F15',
    surfaceTile: '#1A2A20',
    text: '#FFF8F0',
    textMuted: 'rgba(255,248,240,0.55)',
    accent: '#FF6B1A',
    accentSoft: '#FF9F66',
    onAccent: '#581E00',
    success: '#84A57D',
    successSoft: '#C8DCC4',
    near: '#FFB591',
    border: 'rgba(255,255,255,0.08)',
  },
  brand: { wordmark: 'Citrus Game Day', logo_url: null, mascot_url: null },
  copy: {
    shared: { suite_title: 'Game Day', suite_tagline: 'A new one every morning.' },
    daily_player: {
      title: 'Daily Player',
      tagline: 'Six guesses. One skater.',
      win: 'Got him.',
      loss: 'Tomorrow, then.',
    },
  },
  prize_rules: { enabled: false, claim_threshold: 0, terms_url: null },
};

/** `palette.surfaceTile` becomes `--gameday-surface-tile`. */
function cssVarName(token: string): string {
  return `--gameday-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export function applyGameDayTheme(theme: GameDayTheme, target?: HTMLElement): void {
  const element = target ?? document.documentElement;
  for (const [token, value] of Object.entries(theme.palette)) {
    element.style.setProperty(cssVarName(token), value);
  }
}

/**
 * Reads the theme record.
 *
 * With no key, returns the default theme. With a key, returns that theme if
 * the build is allowed to ask for one and the database is willing to hand it
 * over — and falls back to the default in every other case rather than
 * failing, because a missing theme must never be a blank screen.
 */
export async function loadGameDayTheme(key?: string): Promise<GameDayTheme> {
  try {
    const wantsSpecificTheme = Boolean(key) && FEATURE_GAME_DAY_TEAM_THEMES;

    const table = gameDayDb()
      .from('game_day_themes')
      .select('key,label,palette,brand,copy,prize_rules');

    const { data, error } = wantsSpecificTheme
      ? await table.eq('key', key as string).maybeSingle()
      : await table.eq('is_default', true).maybeSingle();

    if (error) {
      logger.error('Game Day: theme lookup failed, using the neutral fallback', error);
      return FALLBACK_THEME;
    }
    if (!data) return FALLBACK_THEME;

    const row = data;
    // Merge the palette over the fallback rather than replacing it: a record
    // that omits a token still renders, instead of painting that token
    // `undefined` and producing an invisible control.
    return {
      key: row.key ?? FALLBACK_THEME.key,
      label: row.label ?? FALLBACK_THEME.label,
      palette: { ...FALLBACK_THEME.palette, ...(row.palette ?? {}) },
      brand: { ...FALLBACK_THEME.brand, ...(row.brand ?? {}) },
      copy: { ...FALLBACK_THEME.copy, ...(row.copy ?? {}) },
      prize_rules: { ...FALLBACK_THEME.prize_rules, ...(row.prize_rules ?? {}) },
    };
  } catch (err) {
    logger.error('Game Day: theme lookup threw, using the neutral fallback', err);
    return FALLBACK_THEME;
  }
}

/** Copy lookup with a literal default, so a missing string is never blank. */
export function themeCopy(
  theme: GameDayTheme,
  section: string,
  key: string,
  fallback: string,
): string {
  return theme.copy?.[section]?.[key] ?? FALLBACK_THEME.copy?.[section]?.[key] ?? fallback;
}

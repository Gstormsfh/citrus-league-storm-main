/**
 * How a source league's settings become Citrus settings: what applies as
 * is, what needs a decision, and what Citrus does not have. Pure, so the
 * confirm screen's arithmetic is testable without the DOM.
 */
import type { ImportedSettings } from '@/api/imports';
import { AVAILABLE_CATEGORIES, DEFAULT_ROSTER_SLOTS } from '@/types/leagueTypes';

/** Citrus scoring key -> Citrus category id (they differ for six stats). */
export const CATEGORY_ID_BY_KEY: Record<string, string> = {
  goals: 'goals', assists: 'assists', points: 'points', plus_minus: 'plus_minus',
  power_play_points: 'ppp', short_handed_points: 'shp', shots_on_goal: 'sog', hits: 'hits', blocks: 'blocks', penalty_minutes: 'pim',
  wins: 'wins', saves: 'saves', shutouts: 'shutouts', goals_against_average: 'gaa', save_percentage: 'save_pct',
};

const CITRUS_SLOTS = new Set(DEFAULT_ROSTER_SLOTS.map((s) => s.slot));

export interface SettingsPlan {
  /** Weights that apply as they are, per group. */
  scoring: { skater: Record<string, number>; goalie: Record<string, number> } | null;
  /** Category ids Citrus knows, and the imported keys it does not. */
  categories: { ids: string[]; unsupported: string[] } | null;
  /** Roster slots Citrus knows, and the source slots it does not. */
  roster: { slots: Record<string, number>; unsupported: Array<{ slot: string; count: number }> };
  keeper: { count: number; enabled: boolean };
  notes: string[];
}

export function planFromImportedSettings(s: ImportedSettings): SettingsPlan {
  const isCategories = s.scoringFormat === 'h2h-categories' || s.scoringFormat === 'roto';
  const notes: string[] = [];

  const scoring = !isCategories && (Object.keys(s.scoringSettings.skater).length || Object.keys(s.scoringSettings.goalie).length)
    ? { skater: { ...s.scoringSettings.skater }, goalie: { ...s.scoringSettings.goalie } }
    : null;

  let categories: SettingsPlan['categories'] = null;
  if (isCategories) {
    const known = new Set(AVAILABLE_CATEGORIES.map((c) => c.id));
    const ids: string[] = [];
    const unsupported: string[] = [];
    for (const key of s.categories) {
      const id = CATEGORY_ID_BY_KEY[key];
      if (id && known.has(id)) { if (!ids.includes(id)) ids.push(id); } else unsupported.push(key);
    }
    categories = { ids, unsupported };
    if (ids.length < 2) notes.push('Citrus needs at least two categories it scores; add them by hand in league settings.');
  }

  const slots: Record<string, number> = {};
  const unsupported: Array<{ slot: string; count: number }> = [];
  for (const r of s.rosterSlots) {
    const slot = r.slot === 'F' || r.slot === 'W' ? 'UTIL' : r.slot;
    if (CITRUS_SLOTS.has(slot)) slots[slot] = (slots[slot] ?? 0) + r.count;
    else unsupported.push(r);
  }
  if (s.rosterSlots.some((r) => r.slot === 'F' || r.slot === 'W')) notes.push('Forward and wing slots become utility slots; Citrus fills them with any skater.');

  for (const u of s.unmapped) notes.push(`${u.citrusKey.startsWith('unknown_') ? `Stat ${u.sourceStatId}` : u.citrusKey.replace(/_/g, ' ')}: ${u.reason.toLowerCase()}.`);

  const count = s.keeper.count ?? 0;
  return { scoring, categories, roster: { slots, unsupported }, keeper: { count, enabled: count > 0 }, notes };
}

export const FORMAT_LABEL: Record<string, string> = {
  'h2h-points': 'Head-to-head points', 'h2h-categories': 'Head-to-head categories', roto: 'Rotisserie', 'total-points': 'Total points',
  'best-ball': 'Best ball', 'points-per-game': 'Points per game',
};

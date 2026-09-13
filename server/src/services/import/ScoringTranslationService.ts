/**
 * Translates an imported season's settings into Citrus league settings.
 *
 * Pure. No I/O. ScoringCalculator remains the single source of truth for how
 * points are computed; this only produces the `scoring_settings` weights and
 * a `settings` fragment that the commissioner confirms before a Citrus season
 * starts on them. Anything the translation cannot map is returned in
 * `unmapped` for the confirmation screen and is never silently dropped.
 */
import type { ImportedSettings, ImportedScoringItem, ImportedScoringType } from '../../import/types';
import type { ScoringFormat } from '@citrus/shared';

/** Citrus stat keys ScoringCalculator understands, by group. */
const CITRUS_SKATER_KEYS = new Set([
  'goals', 'assists', 'power_play_points', 'short_handed_points', 'shots_on_goal', 'blocks', 'hits',
  'penalty_minutes', 'plus_minus', 'faceoff_wins', 'faceoff_losses', 'takeaways', 'giveaways',
  'power_play_goals', 'power_play_assists', 'short_handed_goals', 'short_handed_assists',
  'shots_missed', 'shots_blocked_by_opp', 'shot_attempts', 'game_winning_goals', 'overtime_goals',
  'shifts', 'toi_minutes',
]);
const CITRUS_GOALIE_KEYS = new Set([
  'wins', 'shutouts', 'saves', 'goals_against', 'losses', 'ot_losses', 'shots_faced',
  'even_saves', 'pp_saves', 'sh_saves', 'goalie_toi_minutes',
]);

/** Source keys that are ratios or derived totals: valid categories, not point weights. */
const CATEGORY_ONLY_KEYS = new Set(['goals_against_average', 'save_percentage', 'points', 'goalie_win_percentage']);

export interface TranslatedScoring {
  scoringFormat: ScoringFormat | null;
  scoringSettings: { skater: Record<string, number>; goalie: Record<string, number> };
  /** For category leagues: the enabled category keys in source order. */
  categories: string[];
  rosterSlots: Array<{ slot: string; count: number }>;
  /** Items the translation could not place. The commissioner picks an equivalent or drops each. */
  unmapped: Array<{ sourceStatId: string; citrusKey: string; points: number | null; reason: string }>;
  keeper: { count: number | null; orderType: string | null };
  playoffs: { teamCount: number | null; weeks: number | null; regularSeasonWeeks: number | null };
  draftType: string | null;
  usesFaab: boolean | null;
}

export function mapScoringFormat(t: ImportedScoringType): ScoringFormat | null {
  switch (t) {
    case 'h2h_points': return 'h2h-points';
    case 'h2h_categories': return 'h2h-categories';
    case 'h2h_one_win': return 'h2h-categories';
    case 'roto': return 'roto';
    case 'points': return 'total-points';
    default: return null;
  }
}

export class ScoringTranslationService {
  translate(settings: ImportedSettings): TranslatedScoring {
    const format = mapScoringFormat(settings.scoringType);
    const isCategories = settings.scoringType === 'h2h_categories' || settings.scoringType === 'h2h_one_win' || settings.scoringType === 'roto';

    const skater: Record<string, number> = {};
    const goalie: Record<string, number> = {};
    const categories: string[] = [];
    const unmapped: TranslatedScoring['unmapped'] = [];

    for (const item of settings.scoringItems) {
      if (!item.enabled) continue;
      const placed = this.place(item, isCategories, skater, goalie, categories);
      if (placed) continue;
      unmapped.push({
        sourceStatId: item.sourceStatId,
        citrusKey: item.citrusKey,
        points: item.points,
        reason: item.citrusKey.startsWith('unknown_')
          ? 'Not in the translation table'
          : isCategories
            ? 'Not a Citrus category'
            : 'Not a Citrus point-scoring stat',
      });
    }

    return {
      scoringFormat: format,
      scoringSettings: { skater, goalie },
      categories,
      rosterSlots: settings.rosterSlots,
      unmapped,
      keeper: { count: settings.keeperCount, orderType: settings.keeperOrderType },
      playoffs: { teamCount: settings.playoffTeamCount, weeks: settings.playoffWeeks, regularSeasonWeeks: settings.regularSeasonWeeks },
      draftType: settings.draftType,
      usesFaab: settings.usesFaab,
    };
  }

  private place(
    item: ImportedScoringItem,
    isCategories: boolean,
    skater: Record<string, number>,
    goalie: Record<string, number>,
    categories: string[],
  ): boolean {
    const key = item.citrusKey;
    if (key.startsWith('unknown_')) return false;

    if (isCategories) {
      if (CITRUS_SKATER_KEYS.has(key) || CITRUS_GOALIE_KEYS.has(key) || CATEGORY_ONLY_KEYS.has(key)) {
        categories.push(key);
        return true;
      }
      return false;
    }

    if (item.points == null) return false;
    if (CATEGORY_ONLY_KEYS.has(key)) return false; // a ratio has no point weight
    if (CITRUS_SKATER_KEYS.has(key)) { skater[key] = item.points; return true; }
    if (CITRUS_GOALIE_KEYS.has(key)) { goalie[key] = item.points; return true; }
    return false;
  }
}

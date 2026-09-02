/**
 * OPPONENT-DIFFICULTY TINT — pure rules (2026-09-01, Sleeper parity audit M10).
 *
 * Sleeper's League Legend colour-codes the opponent label on a matchup row
 * by "the quality of the expected matchup". Citrus already has the number
 * behind that colour: every daily projection carries `opponent_adjustment`,
 * the multiplier the model applied for who the player faces tonight
 * (1.00 = league-average opponent). This module turns it into a tier so
 * the row and the projection tooltip agree on one vocabulary.
 *
 *   < 0.95  easy     sage          (a softer opponent than average)
 *   ≤ 1.05  neutral  default text  (within 5% of average — say nothing)
 *   > 1.05  tough    orange-soft   (a harder opponent than average)
 *
 * The 5% band is deliberate: a tint on ±2% would paint most of the league
 * every night and mean nothing. Sage and orange-soft are the app's two
 * warm/cool accents; the tint never uses red/green, which the app reserves
 * for LIVE and injury states. A missing or malformed adjustment is neutral
 * — a colour is a claim, and no data is no claim.
 *
 * Kept out of the component file so the thresholds can be pinned without
 * rendering (and so the module exports plain values without upsetting
 * react-refresh, see positionChip.ts).
 */

export const OPPONENT_EASY_BELOW = 0.95;
export const OPPONENT_TOUGH_ABOVE = 1.05;

export type OpponentTier = 'easy' | 'neutral' | 'tough';

export interface OpponentTint {
  tier: OpponentTier;
  /** Text colour for the `vs/@ OPP` label. Neutral keeps the row's default. */
  className: string;
  /** One-word reading for the tooltip legend. */
  label: string;
}

/** Row default: the muted meta-line colour the label wore before the tint. */
export const OPPONENT_NEUTRAL_CLASS = 'text-white/60';
export const OPPONENT_EASY_CLASS = 'text-pastel-sage';
export const OPPONENT_TOUGH_CLASS = 'text-pastel-orange-soft';

export function opponentTier(adjustment: number | null | undefined): OpponentTier {
  if (typeof adjustment !== 'number' || !Number.isFinite(adjustment)) return 'neutral';
  if (adjustment < OPPONENT_EASY_BELOW) return 'easy';
  if (adjustment > OPPONENT_TOUGH_ABOVE) return 'tough';
  return 'neutral';
}

export function opponentTint(adjustment: number | null | undefined): OpponentTint {
  const tier = opponentTier(adjustment);
  if (tier === 'easy') return { tier, className: OPPONENT_EASY_CLASS, label: 'Easier' };
  if (tier === 'tough') return { tier, className: OPPONENT_TOUGH_CLASS, label: 'Tougher' };
  return { tier, className: OPPONENT_NEUTRAL_CLASS, label: 'Average' };
}

/**
 * The same tiers on the projection tooltip's LIGHT surface (#E8EED9), where
 * the row's pastel sage and orange-soft would wash out: deep sage / deep
 * orange text, forest for neutral. The legend beside it shows the row's
 * actual swatches, so the two readings tie together.
 */
export function opponentTierTooltipClass(tier: OpponentTier): string {
  if (tier === 'easy') return 'text-pastel-forest-soft';
  if (tier === 'tough') return 'text-pastel-orange-deep';
  return 'text-pastel-forest';
}

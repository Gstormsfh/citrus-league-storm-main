import type { PressBoxStatTile } from '@/components/pressbox/PlayerCard';

/**
 * THE FOURTH HERO TILE (2026-09-14). The player card's summary strip ends
 * with one model number. For a skater that is GAR/60 when the index has
 * it, else xG/60 — but a goalie has neither, and the tile read "xG / 60 —"
 * on every goalie in the league. xG/60 is a shooter's rate; the goalie
 * number we already print in the outlook paragraph is GSAx, goals saved
 * above expected, and the index carries it (`gsax_regressed`, the
 * Bayesian-regressed value every other Citrus surface prints).
 */
export interface HeroMetricSource {
  gar_per_60?: number | null;
  xg_per_60?: number | null;
  gsax_regressed?: number | null;
}

const signed = (n: number, digits: number) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;

export function heroMetricTile(entry: HeroMetricSource | null | undefined, isGoalie: boolean): PressBoxStatTile {
  if (isGoalie) {
    const gsax = entry?.gsax_regressed;
    return gsax != null
      ? { key: 'xg', label: 'GSAx', value: signed(gsax, 1), tone: 'orange' }
      : { key: 'xg', label: 'GSAx', value: '–', tone: 'plain' };
  }
  const gar = entry?.gar_per_60;
  if (gar != null) return { key: 'xg', label: 'GAR / 60', value: signed(gar, 2), tone: 'orange' };
  const xg = entry?.xg_per_60;
  if (xg != null) return { key: 'xg', label: 'xG / 60', value: xg.toFixed(2), tone: 'orange' };
  return { key: 'xg', label: 'xG / 60', value: '–', tone: 'plain' };
}

/**
 * WHAT THE PHONE ROW SHOWS AS ITS BIG NUMBER (2026-09-04).
 *
 * Found in the first live test draft, on device: sorting the pool by Goals
 * reordered the list correctly and every row still read the same projected
 * point total. `DraftPoolRow` computed its headline as
 *
 *     const headline = projection ? projection.total : seasonFpts;
 *
 * which never consulted the sort. So the feature looked broken while working:
 * the ordering was right, and the number the manager was reading it against
 * was the wrong stat. On the phone that number IS the comparison - the full
 * stats table is the md+ experience, and a phone row has room for exactly one
 * figure.
 *
 * This module is the single answer to "which number, and what do we call it",
 * so the sort picker and the row can never drift again. It is pure and is
 * covered directly by __tests__/draftPoolHeadline.test.ts.
 *
 * `null` means "no stat of its own" - Overall Rank and Name, where the
 * projection is the right headline and the row keeps its prior behaviour.
 */

/** The one figure a phone row shows. */
export interface PoolHeadline {
  /** Rendered with `decimals` fixed places. */
  value: number;
  /** The 8px unit label under it. Lowercase, matching the existing proj/fpts. */
  label: string;
  decimals: number;
}

/** The per-player numbers the pool has on hand, keyed the way the sort reads them. */
export interface HeadlineInputs {
  /** Season fantasy points under league scoring. */
  seasonFpts: number;
  /** Rest-of-season projection, league-scored. Null when absent. */
  projectionTotal: number | null;
  projectionPerGp: number | null;
  gamesPlayed: number | null;
  points: number | null;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  hits: number | null;
  blocks: number | null;
  xGoals: number | null;
  plusMinus: number | null;
  ppp: number | null;
  shp: number | null;
  pim: number | null;
  icetimeSeconds: number | null;
  wins: number | null;
  losses: number | null;
  gaa: number | null;
  savePct: number | null;
  saves: number | null;
  shutouts: number | null;
}

const n = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/**
 * The headline for a given sort key, or null to keep the default projection.
 *
 * Decimals follow how the sport writes each stat, not one house rule: counting
 * stats are whole, rate stats carry the places that distinguish them (a save
 * percentage rounded to one place is useless), and TOI is minutes so it reads
 * like a hockey number rather than a pile of seconds.
 */
export function poolHeadlineFor(sortBy: string, s: HeadlineInputs): PoolHeadline | null {
  switch (sortBy) {
    // No stat of their own: the projection stays the headline.
    case 'projRank':
    case 'name':
      return null;

    // Already the projection, but say so explicitly rather than by omission.
    case 'projFpts':
      return { value: n(s.projectionTotal), label: 'proj', decimals: 1 };
    case 'projFptsPerGp':
      return { value: n(s.projectionPerGp), label: 'proj/gp', decimals: 2 };

    case 'fpts':
      return { value: n(s.seasonFpts), label: 'fpts', decimals: 1 };
    case 'fptsPerGp':
      return {
        value: n(s.gamesPlayed) > 0 ? n(s.seasonFpts) / n(s.gamesPlayed) : 0,
        label: 'fpts/gp',
        decimals: 2,
      };

    // Skater counting stats.
    case 'points':    return { value: n(s.points),    label: 'pts',  decimals: 0 };
    case 'goals':     return { value: n(s.goals),     label: 'g',    decimals: 0 };
    case 'assists':   return { value: n(s.assists),   label: 'a',    decimals: 0 };
    case 'shots':     return { value: n(s.shots),     label: 'sog',  decimals: 0 };
    case 'hits':      return { value: n(s.hits),      label: 'hits', decimals: 0 };
    case 'blocks':    return { value: n(s.blocks),    label: 'blk',  decimals: 0 };
    case 'ppp':       return { value: n(s.ppp),       label: 'ppp',  decimals: 0 };
    case 'shp':       return { value: n(s.shp),       label: 'shp',  decimals: 0 };
    case 'pim':       return { value: n(s.pim),       label: 'pim',  decimals: 0 };

    // Plus/minus is the one skater stat that is meaningfully negative; the row
    // renders the sign, so it is not stripped here.
    case 'plusMinus': return { value: n(s.plusMinus), label: '+/-',  decimals: 0 };

    // xG is a model output and reads to one place everywhere else in Citrus.
    case 'xGoals':    return { value: n(s.xGoals),    label: 'xg',   decimals: 1 };

    // Stored in seconds, read by humans in minutes.
    case 'toi':       return { value: n(s.icetimeSeconds) / 60, label: 'toi', decimals: 1 };

    // Goalie.
    case 'wins':      return { value: n(s.wins),      label: 'w',    decimals: 0 };
    case 'losses':    return { value: n(s.losses),    label: 'l',    decimals: 0 };
    case 'saves':     return { value: n(s.saves),     label: 'sv',   decimals: 0 };
    case 'shutouts':  return { value: n(s.shutouts),  label: 'so',   decimals: 0 };
    case 'gaa':       return { value: n(s.gaa),       label: 'gaa',  decimals: 2 };
    case 'savePct':   return { value: n(s.savePct),   label: 'sv%',  decimals: 3 };

    default:
      return null;
  }
}

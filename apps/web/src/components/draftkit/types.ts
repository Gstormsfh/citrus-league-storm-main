/**
 * Wire shapes for the Draft Kit section.
 *
 * These mirror server/src/services/DraftKitService.ts. They are re-declared
 * rather than imported because @citrus/shared does not carry server read-model
 * types and the web bundle should not pull the server package in to get them.
 * If a field changes on the server it changes here; the board test pins the
 * shape so the two cannot drift silently.
 */

export type Cohort = 'F' | 'D' | 'G';
export type DraftKitTier = 'free' | 'kit' | 'suite';

export const COHORT_LABEL: Record<Cohort, string> = {
  F: 'Forwards',
  D: 'Defence',
  G: 'Goalies',
};

export interface CardMetric {
  key: string;
  label: string;
  /** The database column this number came from. Rendered in the card's audit line. */
  source: string;
  value: number | null;
  /** 0-100, taken inside the player's own position cohort. Never pooled. */
  percentile: number | null;
  format: 'rate2' | 'rate3' | 'count1' | 'pct3';
}

export interface DraftKitCard {
  playerId: number;
  name: string;
  team: string;
  position: string;
  cohort: Cohort;
  jersey: number | null;
  headshotUrl: string | null;
  rosterStatus: string | null;
  sampleGames: number;
  cohortRank: number | null;
  tier: number | null;
  projectedFantasyPoints: number | null;
  projectedFantasyPpg: number | null;
  projectedGames: number | null;
  valuePercentile: number | null;
  previousTeam: string | null;
  metrics: CardMetric[];
}

export interface RosterChange {
  playerId: number;
  name: string;
  position: string;
  cohort: Cohort;
  fromTeam: string;
  toTeam: string;
  projectedFantasyPoints: number | null;
  cohortRank: number | null;
}

export interface DraftKitBlurb {
  id: string;
  playerId: number | null;
  season: number;
  kind: string;
  title: string;
  body: string;
  authorName: string;
  authorRole: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  publishedAt: string;
}

export interface DraftKitBoard {
  tier: DraftKitTier;
  locked: boolean;
  metricsSeason: number;
  projectionSeason: number;
  cards: DraftKitCard[];
  cohortSizes: Record<Cohort, number>;
  totalCards: number;
  rosterChanges: RosterChange[];
  totalRosterChanges: number;
  blurbs: DraftKitBlurb[];
}

/** Render a metric's raw value in the units its format declares. */
export function formatMetricValue(value: number | null, format: CardMetric['format']): string {
  if (value == null || !Number.isFinite(value)) return 'No sample';
  switch (format) {
    case 'rate2':
      return value.toFixed(2);
    case 'rate3':
      return value.toFixed(3);
    case 'count1':
      return value.toFixed(1);
    case 'pct3': {
      // Save percentage arrives either as .921 or as 921 depending on the
      // pipeline run that wrote it. Both render as .921.
      const v = value > 1 ? value / 1000 : value;
      return v.toFixed(3).replace(/^0/, '');
    }
    default:
      return String(value);
  }
}

/** "1st", "2nd", "23rd", "88th". */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

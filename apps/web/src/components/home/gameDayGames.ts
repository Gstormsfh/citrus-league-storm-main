/**
 * CITRUS GAME DAY (Garrett, 2026-09-05): the free-to-play games, on the
 * front door. Three pools the app already runs -- Pick'em, Survivor,
 * Confidence -- each a league type CreateLeague builds, each with its
 * own page. Nothing here is new product: the section is the way in.
 *
 * Data, not JSX, so the guard can walk every entry: each `to` must be a
 * route App.tsx serves and each `type` a LeagueType the create screen
 * accepts through `?type=`.
 */
import type { LeagueType } from '@citrus/shared';

export interface GameDayGame {
  type: LeagueType;
  title: string;
  /** One line, the whole game. */
  line: string;
  /** `/create-league?type=pickem` -- the create screen, that type selected. */
  to: string;
}

export const GAME_DAY_GAMES: GameDayGame[] = [
  { type: 'pickem', title: "Pick'em", line: 'Pick the winners every night', to: '/create-league?type=pickem' },
  { type: 'survivor', title: 'Survivor', line: 'One team a week. Lose and you’re out', to: '/create-league?type=survivor' },
  { type: 'confidence-pool', title: 'Confidence', line: 'Rank your picks; the sure ones pay more', to: '/create-league?type=confidence-pool' },
];

/** Join with a code: the create screen's Join tab. */
export const GAME_DAY_JOIN_TO = '/create-league?tab=join';

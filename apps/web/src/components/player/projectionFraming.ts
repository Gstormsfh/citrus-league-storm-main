/**
 * HOW THE PROJECTION IS FRAMED (2026-09-05). Before the opener the card
 * read "REST OF SEASON · 11.5 G · 67.1 A over 74 GP" — 74 is the model's
 * expected games played for the season ahead (`games_remaining` before a
 * game has been played is the whole season), not a count of games left.
 * With the whole schedule ahead, the line is a season projection and says
 * so; once the season is under way it is the rest of the season.
 */
import { getProjectionsSeason, getSeasonStartDate } from '@citrus/shared';
import { seasonLabel } from './playerDashboardData';

export interface ProjectionFraming {
  /** `2026-27 projection` before the opener; `Rest of season` after. */
  eyebrow: string;
  /** ` in a projected 74 GP` before the opener; ` over 74 GP` after. */
  gpPhrase: (gp: number) => string;
  beforeOpener: boolean;
}

export function projectionFraming(now: Date = new Date()): ProjectionFraming {
  const season = getProjectionsSeason(now);
  const start = getSeasonStartDate(season);
  const beforeOpener = start ? now < new Date(`${start}T00:00:00`) : false;
  if (beforeOpener) {
    return {
      eyebrow: `${seasonLabel(season)} projection`,
      gpPhrase: (gp) => ` in a projected ${Math.round(gp)} GP`,
      beforeOpener,
    };
  }
  return {
    eyebrow: 'Rest of season',
    gpPhrase: (gp) => ` over ${Math.round(gp)} GP`,
    beforeOpener,
  };
}

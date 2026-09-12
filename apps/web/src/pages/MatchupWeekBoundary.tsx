import { Fragment, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

/** All Matchup state, locks and async setters belong to one viewed league/week.
 * A route change starts a fresh page instance; late setters from the old route
 * cannot overwrite the new week's roster, dates or scores. Shared API caches
 * and the surrounding app remain mounted. */
export function MatchupWeekBoundary({ children }: { children: ReactNode }) {
  const { leagueId, weekId } = useParams();
  return <Fragment key={JSON.stringify([leagueId ?? null, weekId ?? null])}>{children}</Fragment>;
}

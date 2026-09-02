/** Projected-vs-actual harness at a phone viewport. Numbers chosen to exercise
 *  the honest cases: a category the model under-projects (hits), one it
 *  over-projects (goals), and a ranking where ratio and delta disagree. */
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { ProjectedVsActual } from '../src/components/analytics/ProjectedVsActual';
import { harnessPlayer } from './players';

const totals = {
  goals:   { projected: 42.0, actual: 40.1 },
  assists: { projected: 61.0, actual: 55.2 },
  ppp:     { projected: 18.0, actual: 21.4 },
  shots:   { projected: 305.0, actual: 291.0 },
  blocks:  { projected: 96.0, actual: 74.5 },
  hits:    { projected: 88.0, actual: 151.2 },
};

/**
 * The rank list carries no face — `ProjectedVsActual` prints a name and two
 * numbers — but the names still have to be the roster's, or this page and the
 * roster pages disagree about who is on the team (2026-09-02). Positions come
 * from the real player, so a G here is genuinely a G. The NUMBERS are the
 * case and are unchanged.
 */
const players = (
  [
    ['Connor McDavid', 128.4, 141.2, 22],
    ['Cale Makar', 96.1, 112.8, 21],
    ['Kirill Kaprizov', 74.5, 82.0, 20],
    ['Jason Robertson', 81.0, 62.3, 22],
    // Was Igor Shesterkin, who is not on the harness roster. Vasilevskiy is
    // the goalie it has; the row's job — a G the model over-projected — holds.
    ['Andrei Vasilevskiy', 88.0, 61.5, 18],
    ['Quinn Hughes', 70.2, 48.9, 19],
  ] as const
).map(([who, projectedPoints, actualPoints, games], i) => {
  const p = harnessPlayer(who);
  return { id: String(i + 1), name: p.name, position: p.position, projectedPoints, actualPoints, games };
});

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-[#0F1F15] p-3">
    <ProjectedVsActual totals={totals} players={players} />
  </div>,
);

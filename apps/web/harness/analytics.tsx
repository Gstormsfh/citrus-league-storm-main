/** Projected-vs-actual harness at a phone viewport. Numbers chosen to exercise
 *  the honest cases: a category the model under-projects (hits), one it
 *  over-projects (goals), and a ranking where ratio and delta disagree. */
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { ProjectedVsActual } from '../src/components/analytics/ProjectedVsActual';

const totals = {
  goals:   { projected: 42.0, actual: 40.1 },
  assists: { projected: 61.0, actual: 55.2 },
  ppp:     { projected: 18.0, actual: 21.4 },
  shots:   { projected: 305.0, actual: 291.0 },
  blocks:  { projected: 96.0, actual: 74.5 },
  hits:    { projected: 88.0, actual: 151.2 },
};

const players = [
  { id: '1', name: 'Connor McDavid',  position: 'C',  projectedPoints: 128.4, actualPoints: 141.2, games: 22 },
  { id: '2', name: 'Cale Makar',      position: 'D',  projectedPoints: 96.1,  actualPoints: 112.8, games: 21 },
  { id: '3', name: 'Kirill Kaprizov', position: 'LW', projectedPoints: 74.5,  actualPoints: 82.0,  games: 20 },
  { id: '4', name: 'Jason Robertson', position: 'LW', projectedPoints: 81.0,  actualPoints: 62.3,  games: 22 },
  { id: '5', name: 'Igor Shesterkin', position: 'G',  projectedPoints: 88.0,  actualPoints: 61.5,  games: 18 },
  { id: '6', name: 'Quinn Hughes',    position: 'D',  projectedPoints: 70.2,  actualPoints: 48.9,  games: 19 },
];

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-[#0F1F15] p-3">
    <ProjectedVsActual totals={totals} players={players} />
  </div>,
);

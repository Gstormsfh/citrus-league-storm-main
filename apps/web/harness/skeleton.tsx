/**
 * THE SKELETONS (PR3, 2026-09-05). `skeleton.html?kind=roster` draws one
 * screen's skeleton under a bare league-header silhouette, the way the
 * route fallback does; `?route=/standings` draws exactly what the Suspense
 * fallback renders for that path. `?kind=roster&chrome=0` drops the
 * silhouette. Kinds: roster standings matchup hq players bracket list.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import LoadingScreen from '../src/components/LoadingScreen';
import { PressBoxSkeletonRoster, PressBoxSkeletonScreen, type PressBoxSkeletonKind } from '../src/components/pressbox/Skeleton';

const q = new URLSearchParams(location.search);
const route = q.get('route');
const kind = (q.get('kind') ?? 'roster') as PressBoxSkeletonKind;

function Body() {
  if (route) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <LoadingScreen />
      </MemoryRouter>
    );
  }
  if (kind === 'roster' && q.get('bare') === '1') {
    return <PressBoxSkeletonRoster />;
  }
  return (
    <div className="min-h-screen bg-pressbox-surface text-pressbox-text">
      <PressBoxSkeletonScreen kind={kind} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Body />);

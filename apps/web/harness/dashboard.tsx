/**
 * The PLAYER DASHBOARD at a phone viewport — Component 6.5.
 *
 * `cd apps/web && npx vite --config harness/vite.config.ts` →
 * `/harness/dashboard.html`. `?case=` picks the state:
 *
 *   skater    (default) a forward with a full season of shots — the
 *             signature Spatial Hero composition
 *   defence   a defenceman, so the zone breakdown is point-heavy
 *   goalie    no shot map of his own attempts; GSAx hero instead
 *   empty     a real player with nothing on record — no shots, no season
 *             rows, no talent row, and NO `as_of`, so the freshness badge
 *             must stay off
 *   noshots   the shot read FAILED (`shots_available: false`) — a different
 *             fact from "no shots", and the page has to say which
 *   skewed    coordinates that disagree with their own stored distances;
 *             the placement guard must refuse to draw the map
 *
 * ── WHAT IS REAL AND WHAT IS NOT ───────────────────────────────────────
 *
 * The PAGE is real: `pages/PlayerDashboard.tsx`, its hooks, every
 * `components/citrus2` primitive and all of Tailwind. Only the transport is
 * stubbed, per the harness contract — `@/api/client` is aliased and serves
 * `harness/dashboardFixtures.ts`.
 *
 * Identity is real (production `players`, 2026-09-02). Shot coordinates,
 * per-shot xG, the nine `player_xg_season` rows and the GSAx line are
 * GENERATED — deterministically, and internally consistent — because the
 * harness has no database. The strip at the bottom of this page says so, and
 * it is in every screenshot on purpose. Read the LAYOUT, never a number.
 *
 * `assets.nhle.com` is unreachable from the review container, so `Mug` falls
 * through headshot → crest → initials. That is the fallback working, not the
 * fixture being empty — same note the harness README carries.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../src/pressboxFonts';
import '../src/index.css';
import PlayerDashboard from '../src/pages/PlayerDashboard';
import { DASHBOARD_CASES, caseIdFor, type DashboardCase } from './dashboardFixtures';

const requested = new URLSearchParams(location.search).get('case') as DashboardCase | null;
const activeCase: DashboardCase =
  requested && (DASHBOARD_CASES as string[]).includes(requested) ? requested : 'skater';
const playerId = caseIdFor(activeCase);

/**
 * The disclaimer strip. Rendered UNDER the page rather than over it so it
 * cannot shift the layout being measured, and rendered at all so that no
 * screenshot of this harness can be mistaken for a measurement.
 */
export function FixtureNote() {
  return (
    <footer
      data-testid="fixture-disclaimer"
      className="border-t border-white/10 bg-pastel-surface-tile px-5 py-4"
    >
      <div className="font-jbmono text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-orange-soft">
        Harness · case={activeCase} · player {playerId}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-pastel-butter">
        Identity is real (production <span className="font-jbmono">players</span>, 2026-09-02).
        Shot coordinates, per-shot xG, the season rows and GSAx are GENERATED — this page has no
        database. Read the layout, never a number.
      </p>
      <p className="mt-2 text-[11px] leading-snug text-white/55">
        Cases:{' '}
        {DASHBOARD_CASES.map((c) => (
          <a
            key={c}
            href={`?case=${c}`}
            className="mr-2 underline decoration-white/30 underline-offset-2 hover:text-pastel-orange-soft"
          >
            {c}
          </a>
        ))}
      </p>
    </footer>
  );
}

/**
 * `Navbar` reads `useProfile`, which is a `useQuery` — no provider, no page.
 * `harness/page.tsx` carries the same one for the same reason. The dashboard
 * itself uses neither React Query nor the query client; this is chrome.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/players/${playerId}`]}>
        <div className="min-h-screen bg-pastel-surface">
          <Routes>
            <Route path="/players/:playerId" element={<PlayerDashboard />} />
          </Routes>
          <FixtureNote />
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

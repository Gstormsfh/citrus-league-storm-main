/**
 * PlayerAdvancedCard at a phone viewport — the PWS-1 condensed card, every
 * variant and every degraded state, side by side.
 *
 * `cd apps/web && npx vite --config harness/vite.config.ts` →
 * `/harness/advanced.html`. `?w=NNN` narrows the column to a specific width
 * (default 353 — see MODAL_INNER below).
 *
 * ── WHAT IS REAL HERE AND WHAT IS NOT ──────────────────────────────────
 *
 * Names, teams, sweater numbers, NHL ids, headshot URLs, goals, assists,
 * shots, wins, GAA and save percentage are REAL, read out of the production
 * `players` table on 2026-09-02 and shared with every other harness entry
 * (`harness/players.ts`).
 *
 * The ADVANCED columns — `x_goals`, `xg_per_60`, `gar_*`, `proj_*` — are
 * DERIVED here, arithmetically, from those real stat lines. They have to be:
 * the harness has no database, and `/api/players/dashboard-index` is the
 * thing being stood in for. They are deterministic and in a plausible range
 * so the layout can be measured, and the page says so on itself in a banner
 * so that no screenshot of this page can be mistaken for a measurement.
 * A reviewer reads the LAYOUT off this page, never a number.
 *
 * ── WHAT YOU WILL SEE ON A SANDBOXED MACHINE ───────────────────────────
 *
 * `assets.nhle.com` is unreachable from the review container, so `Mug` falls
 * through headshot → crest → initials and every face is an initials disc.
 * That is the fallback working, not the fixture being empty — same note the
 * harness README carries. Check the request, not the pixel.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/pressboxFonts';
import '../src/index.css';
import { PlayerAdvancedCard } from '../src/components/player/PlayerAdvancedCard';
import type { DashboardIndexEntry } from '../src/hooks/usePlayerDashboardIndex';
import { HARNESS_PLAYERS, harnessHeadshotUrl, harnessPlayer, type HarnessPlayer } from './players';

/**
 * The width the card actually gets on a phone, measured rather than guessed:
 * `PlayerStatsModal`'s DialogContent is `w-full max-w-lg` inside the shadcn
 * dialog's `p-6`-equivalent inset, and its body is `px-5`. On a 393px
 * viewport that leaves ~353px. PWS-1 specifies 280–320px as the design
 * width, so the card must read correctly across that whole band — hence
 * `?w=`.
 */
const MODAL_INNER = 353;
const WIDTH = Number(new URLSearchParams(location.search).get('w') ?? MODAL_INNER);

/**
 * `HarnessPlayer` → the `/api/players/dashboard-index` row shape.
 *
 * Identity and the counting stats come straight off the shared roster. The
 * modelled columns are derived, deterministically:
 *
 *   x_goals    shots × 0.083 — roughly the league-wide xG per shot attempt
 *              on goal, so a volume shooter carries more expected goals.
 *   xg_per_60  x_goals ÷ (gp × TOI/60), with TOI 18 min for a forward and
 *              21 for a defenceman.
 *   gar_*      split off points-per-game with a fixed position weighting,
 *              so forwards' value sits in EV offence and defencemen's in EV
 *              defence — which is the shape the F/D cohort split exists for.
 *
 * The player's own real goals total is left untouched, so `G − xG` — the
 * card's headline finishing number — comes out different for every player
 * and lands on both sides of zero, which is what the layout has to survive.
 */
function dashboardRow(p: HarnessPlayer, index: number): DashboardIndexEntry {
  const isGoalie = p.position === 'G';
  const isD = p.position === 'D';
  const gp = isGoalie ? (p.wins ?? 0) + (p.losses ?? 0) + (p.otLosses ?? 0) : 24;
  const shots = p.shots ?? 0;
  const xGoals = isGoalie ? 0 : Math.round(shots * 0.083 * 10) / 10;
  const toiPerGame = isD ? 21 : 18;
  const sixties = gp > 0 ? (gp * toiPerGame) / 60 : 0;
  const xgPer60 = isGoalie || sixties === 0 ? null : Math.round((xGoals / sixties) * 100) / 100;
  // Fantasy points per game, derived so a goalie is not left on 0.00: a
  // skater's is scaled off points, a goalie's off the default W/SV weights
  // (W 5, SV 0.6) applied to a plausible 28-save night.
  const ppg = isGoalie
    ? gp > 0
      ? ((p.wins ?? 0) * 5 + gp * 28 * 0.6) / gp / 4.2
      : 0
    : gp > 0
      ? (p.points ?? 0) / gp
      : 0;
  const garTotal = isGoalie ? null : Math.round(ppg * 0.55 * 100) / 100;
  const share = (f: number) => (garTotal == null ? null : Math.round(garTotal * f * 100) / 100);

  return {
    id: 8000000 + index,
    name: p.name,
    team: p.team,
    position: p.position,
    jersey: Number(p.jersey),
    headshot_url: harnessHeadshotUrl(p.team, p.nhlId),
    is_goalie: isGoalie,
    roster_status: null,
    gp,
    goals: p.goals ?? 0,
    assists: p.assists ?? 0,
    points: p.points ?? 0,
    sog: shots,
    hits: 0,
    blocks: 0,
    ppp: 0,
    plus_minus: p.plusMinus ?? 0,
    x_goals: xGoals,
    wins: p.wins ?? 0,
    saves: isGoalie ? 600 : 0,
    save_pct: p.savePct ?? 0,
    gaa: p.gaa ?? 0,
    shutouts: isGoalie ? index % 4 : 0,
    xg_per_60: xgPer60,
    xg_rating: null,
    gar_per_60: garTotal,
    gar_evo: isD ? share(0.25) : share(0.6),
    gar_evd: isD ? share(0.5) : share(0.12),
    gar_ppo: share(0.2),
    gar_ppd: share(0.03),
    gar_pen: share(0.05),
    proj_gp: isGoalie ? 34 : 58,
    proj_fantasy_points: Math.round(ppg * (isGoalie ? 34 : 58) * 4.2 * 10) / 10,
    proj_fantasy_ppg: Math.round(ppg * 4.2 * 100) / 100,
    proj_goals: Math.round((p.goals ?? 0) * 2.4),
    proj_assists: Math.round((p.assists ?? 0) * 2.4),
    proj_sog: Math.round(shots * 2.4),
    proj_ppp: Math.round((p.points ?? 0) * 0.3),
    proj_wins: isGoalie ? Math.round((p.wins ?? 0) * 1.6) : null,
    proj_saves: isGoalie ? 780 : null,
    proj_shutouts: isGoalie ? 2 : null,
    toi_total_minutes: null, avg_toi_per_game: null, vopa_score: null,
    gsax_raw: null, gsax_regressed: null, gsax_shots_faced: null, gsax_xga: null, gsax_ga: null,
    as_of: null,
  };
}

const INDEX: DashboardIndexEntry[] = HARNESS_PLAYERS.map(dashboardRow);
const idOf = (name: string) => INDEX[HARNESS_PLAYERS.indexOf(harnessPlayer(name))].id;

/**
 * A call-up: real player, real face, four games. The state is the case — the
 * card has to place him AND flag him, and must say nothing about him in
 * prose (ten games is the floor the verdict will speak above).
 */
const CALLUP: DashboardIndexEntry = {
  ...INDEX[HARNESS_PLAYERS.indexOf(harnessPlayer('Cutter Gauthier'))],
  id: 8999999,
  gp: 4,
  goals: 3,
  x_goals: 1.1,
  xg_per_60: 1.85,
};

// Exported so this file has exports and the react-refresh lint rule is
// satisfied — the other harness entries predate the rule and carry the
// warning; a new file should not add to it.
export function Case({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2 className="font-jbmono text-[10px] uppercase tracking-[0.22em] text-pastel-orange-soft mb-1">
        {title}
      </h2>
      {note && <p className="text-[11px] text-white/55 mb-2 leading-snug">{note}</p>}
      <div style={{ width: WIDTH }}>{children}</div>
    </section>
  );
}

export function App() {
  return (
    <MemoryRouter>
      <div className="min-h-screen bg-pastel-surface text-pastel-cream">
        <div className="px-5 py-5">
          <h1 className="font-varsity text-base mb-1">PlayerAdvancedCard · PWS-1</h1>
          <p className="text-[11px] text-white/70 leading-snug mb-1">
            Column is {WIDTH}px — the width the card gets inside PlayerStatsModal at 393. Add{' '}
            <span className="font-jbmono">?w=300</span> to check the narrow end of the PWS-1 band.
          </p>
          <p
            data-testid="fixture-disclaimer"
            className="text-[11px] leading-snug text-pastel-butter mb-5"
          >
            Identity and counting stats are real (production <span className="font-jbmono">players</span>,
            2026-09-02). The xG, GAR and projection columns are DERIVED arithmetic — this page has no
            database. Read the layout, never a number.
          </p>

          <Case
            title="Skater · expanded (the modal variant)"
            note="Full GAR decomposition + rest-of-season projection."
          >
            <PlayerAdvancedCard
              playerId={idOf('Connor McDavid')}
              variant="expanded"
              indexOverride={INDEX}
            />
          </Case>

          <Case
            title="Skater · compact (the embedded variant)"
            note="Four metric rows, ~180–240px, for a list row or a drawer."
          >
            <PlayerAdvancedCard playerId={idOf('Nathan MacKinnon')} indexOverride={INDEX} />
          </Case>

          <Case
            title="Defenceman · measured against defencemen"
            note="Cohort noun and the n= count both change; the same xG/60 that reads bottom-decile among forwards reads high among D."
          >
            <PlayerAdvancedCard
              playerId={idOf('Cale Makar')}
              variant="expanded"
              indexOverride={INDEX}
            />
          </Case>

          <Case
            title="Goalie · its own metric set"
            note="No xG/60, no GAR, no finishing row — none of which the endpoint carries for a goalie. Save rate, GAA (lower is better), wins, shutouts."
          >
            <PlayerAdvancedCard
              playerId={idOf('Andrei Vasilevskiy')}
              variant="expanded"
              indexOverride={INDEX}
            />
          </Case>

          <Case
            title="Thin sample · placed, flagged, and not talked about"
            note="4 GP. He gets a percentile but does not define one, wears the GP chip, and gets no verdict line."
          >
            <PlayerAdvancedCard
              playerId={CALLUP.id}
              variant="expanded"
              indexOverride={[...INDEX, CALLUP]}
            />
          </Case>

          <Case
            title="Degraded · 401 / guest / demo"
            note="The endpoint is behind authMiddleware. An empty index must render NOTHING — the dashed box below is the harness marking the empty space, not the card."
          >
            <div
              data-testid="degraded-401"
              className="rounded-2xl border border-dashed border-white/20 p-3 text-[11px] text-white/55"
            >
              <PlayerAdvancedCard playerId={idOf('Connor McDavid')} indexOverride={[]} />
              nothing rendered — host surface unchanged
            </div>
          </Case>

          <Case
            title="Degraded · player not in the index"
            note="A roster row whose id the payload does not carry. Same outcome."
          >
            <div
              data-testid="degraded-missing"
              className="rounded-2xl border border-dashed border-white/20 p-3 text-[11px] text-white/55"
            >
              <PlayerAdvancedCard playerId={1} indexOverride={INDEX} />
              nothing rendered — host surface unchanged
            </div>
          </Case>
        </div>
      </div>
    </MemoryRouter>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

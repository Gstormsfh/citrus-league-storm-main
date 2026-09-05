// Players — league-wide browse + advanced-metrics dashboard section.
//
// The section MLSE saw as a standalone Leafs demo (2026-08-18), built
// into the product for ALL 32 teams: season actuals, xG shot-quality,
// GAR/60 impact split, and rolled-forward fantasy projections, with a
// master table + per-player dashboard panel.
//
// Data: one authenticated call to /api/players/dashboard-index (the
// server merges directory + season stats + GAR components + talent
// metrics + ROS projections, cached 2 min server-side). All filtering,
// sorting, and percentile math happens client-side on that bounded
// payload (~1-2k rows) — no per-interaction network chatter.
//
// 2026-09-02: that call moved OUT of this page and into
// `hooks/usePlayerDashboardIndex`. The same payload now feeds
// `PlayerAdvancedCard`, which renders inside the shared PlayerStatsModal on
// eight other surfaces; two independent `useEffect` fetches of the same 1-2k
// rows was the alternative. The page's behaviour is unchanged — same loading
// state, same error string, same Retry — but the retry now calls the shared
// `reload()` instead of bumping a local nonce.
//
// Deep-link: /players?player=<id> selects that player on load;
// selection writes the param back so any player view is shareable.
//
// 2026-09-03: every row also carries an anchor to /players/<id>, the full
// dashboard page, and the panel repeats it as a labelled button. That page
// had exactly one route in from the UI (a player modal -> its Detailed tab
// -> a link at the bottom that renders only when the payload is complete),
// which made a substantial, ungated, shareable page effectively unreachable.
// Row CLICK is unchanged and still opens the inline panel.

import { Suspense, lazy, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { PressBoxAppHeader } from '@/components/pressbox/AppHeader';
import { PlayersBrowsePhone } from '@/components/players/PlayersBrowsePhone';
import { dashboardEntryToHockeyPlayer, type GoalieSortKey, type SkaterSortKey } from '@/components/players/playersBrowse';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowUpRight, Loader2, Search, ShieldAlert } from 'lucide-react';
import { useCitrusPlayerNotes } from '@/hooks/useCitrusPlayerNotes';
import { Mug } from '@/components/roster/Mug';
import type { MugPlayer } from '@/components/roster/headshot';
import { playerDashboardHref } from '@/components/player/playerAdvancedMetrics';
import {
  usePlayerDashboardIndex,
  type DashboardIndexEntry,
} from '@/hooks/usePlayerDashboardIndex';

/**
 * One row of /api/players/dashboard-index.
 *
 * The shape now lives with the fetch, in `hooks/usePlayerDashboardIndex`, so
 * the advanced player card and this page cannot drift apart on what a row
 * is. Kept as a named export here because that is where it has always been.
 */
export type DashboardPlayer = DashboardIndexEntry;

const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;

// SkaterSortKey / GoalieSortKey live in components/players/playersBrowse.ts
// (2026-09-04), shared with the phone screen.

/**
 * The shared player card, loaded when a phone row is first tapped. Lazy
 * and mounted only while open: the card pulls the auth and league
 * services in behind it, none of which this page needs to draw its list,
 * and the page's own tests import this module without them.
 */
const PlayerStatsModal = lazy(() => import('@/components/PlayerStatsModal'));

const f1 = (v: number | null | undefined) => (v == null ? '-' : (Math.round(v * 10) / 10).toFixed(1));
const f2 = (v: number | null | undefined) => (v == null ? '-' : (Math.round(v * 100) / 100).toFixed(2));
const svp = (v: number | null | undefined) =>
  v == null || v === 0 ? '-' : (v < 1 ? v : v / 1000).toFixed(3).replace(/^0/, '');

/** Percentile of `val` within `arr` (fraction of values <= val), 0–100. */
function percentile(arr: number[], val: number): number {
  if (arr.length === 0) return 0;
  let c = 0;
  for (const x of arr) if (x <= val) c += 1;
  return Math.round((100 * c) / arr.length);
}

/**
 * ONE FACE (2026-09-03 headshot audit).
 *
 * This page carried its OWN headshot component: a bare <img> whose onError
 * swapped in a grey square of initials, with no team crest between the two
 * and its own two box sizes. That is the third private fallback chain the
 * audit found, and it is exactly what `roster/Mug` exists to stop: headshot
 * -> team crest -> initials, a fixed box per size, a failure remembered per
 * URL, and never a broken-image glyph left in the DOM.
 *
 * `DashboardIndexEntry` is not the directory shape `mugFromDirectory` takes
 * (`name`/`headshot_url`/`team`, not `full_name`), so it gets its own
 * one-line adapter rather than a rename upstream. Same object
 * `PlayerAdvancedCard` builds from the same row.
 *
 * SIZES: the table row was h-9 w-9, which is `Mug`'s `sm` exactly. The panel
 * header was 96px and is now `lg` (56px). Mug's sizes are NAMED, not
 * className overrides, precisely so the crest and initials states stay sized
 * for their box; a `h-24 w-24` override would leave both fallbacks drawn for
 * a 56px circle at the moment the CDN is failing and nobody is watching.
 *
 * CREST BADGE: on, even though both surfaces print the team in text beside
 * the face. `PlayerAdvancedCard` reads the same row and wears the badge, and
 * that card renders in the modal that opens over this very table; the same
 * player looking like two different players across one tap is the thing
 * worth avoiding here.
 */
const mugOf = (p: DashboardPlayer): MugPlayer => ({
  name: p.name,
  image: p.headshot_url,
  team: p.team,
});

/** Centered diverging bar for GAR-style values (negative = red left, positive = green right). */
function DivergingBar({ value, scale }: { value: number; scale: number }) {
  const w = Math.min(50, (Math.abs(value) / Math.max(scale, 0.001)) * 50);
  const left = value >= 0 ? 50 : 50 - w;
  const color = value > 0.005 ? 'bg-green-500' : value < -0.005 ? 'bg-red-400' : 'bg-white/30';
  return (
    <div className="relative h-2 w-full overflow-hidden rounded bg-white/10">
      <span className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
      <span className={`absolute inset-y-0 rounded ${color}`} style={{ left: `${left}%`, width: `${w}%` }} />
    </div>
  );
}

function MetricRow({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      {children}
    </div>
  );
}

function PlayerDashboardPanel({ player, skaters, goalies }: { player: DashboardPlayer; skaters: DashboardPlayer[]; goalies: DashboardPlayer[] }) {
  // Citrus notes for this player — the season outlook plus any standing
  // analysis. Fails soft: no notes simply renders nothing.
  const { notes: citrusNotes } = useCitrusPlayerNotes(player.id);
  const garComponents = [
    { label: 'EV Offense', v: player.gar_evo },
    { label: 'EV Defense', v: player.gar_evd },
    { label: 'PP Offense', v: player.gar_ppo },
    { label: 'PP Defense', v: player.gar_ppd },
    { label: 'Penalty', v: player.gar_pen },
  ];
  const garScale = Math.max(0.3, ...garComponents.map((c) => Math.abs(c.v ?? 0)));
  const xgPool = skaters.filter((p) => p.xg_per_60 != null).map((p) => p.xg_per_60 as number);
  const garPool = skaters.filter((p) => p.gar_per_60 != null).map((p) => p.gar_per_60 as number);
  const xgPct = player.xg_per_60 != null ? percentile(xgPool, player.xg_per_60) : null;
  const garPct = player.gar_per_60 != null ? percentile(garPool, player.gar_per_60) : null;
  const winPool = goalies.filter((p) => p.gp > 0).map((p) => p.wins);
  const projNhlPts =
    player.proj_goals != null || player.proj_assists != null
      ? (player.proj_goals ?? 0) + (player.proj_assists ?? 0)
      : null;

  return (
    <Card className="p-5" data-testid="player-dashboard-panel">
      <div className="flex items-center gap-4">
        <Mug p={mugOf(player)} size="lg" crest />
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold">{player.name}</h2>
          <p className="text-sm text-muted-foreground">
            #{player.jersey ?? '-'} · {player.position} · {player.team}
          </p>
          {player.xg_rating && (
            <Badge variant="secondary" className="mt-1.5">
              xG rating: {player.xg_rating}
            </Badge>
          )}
          {player.roster_status && ['IR', 'LTIR'].includes(player.roster_status) && (
            <Badge variant="destructive" className="ml-1.5 mt-1.5">
              <ShieldAlert className="mr-1 h-3 w-3" />
              {player.roster_status}
            </Badge>
          )}
        </div>
      </div>

      {/* THE WAY OUT OF THE PANEL AND INTO THE PAGE (2026-09-03).
          /players/:playerId is a real, ungated route carrying the shot map,
          the career arc and the cohort percentiles, and until now the only
          way a user could reach it was: open a player modal somewhere else,
          switch to its Detailed tab, scroll to the bottom, and find a link
          that renders only when the advanced payload is present. This panel
          opens on a row tap on every breakpoint, so the link belongs here,
          above the fold, unconditional. */}
      <Link
        to={playerDashboardHref(player.id)}
        data-testid="players-panel-dashboard-link"
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-pastel-orange/50 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-pastel-orange transition-colors hover:bg-pastel-orange/10"
      >
        Full dashboard
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        {(player.is_goalie
          ? [
              { n: player.wins, l: 'Wins' },
              { n: svp(player.save_pct), l: 'SV%' },
              { n: player.shutouts, l: 'SO' },
              { n: player.gp, l: 'GP' },
            ]
          : [
              { n: player.goals, l: 'Goals' },
              { n: player.assists, l: 'Assists' },
              { n: player.points, l: 'Points' },
              { n: player.gp, l: 'GP' },
            ]
        ).map((s) => (
          <div key={s.l} className="rounded-xl border border-border bg-white/5 px-2 py-2.5">
            <div className="text-lg font-extrabold">{s.n}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.l}</div>
          </div>
        ))}
      </div>

      {citrusNotes.length > 0 && (
        <div className="mt-5">
          <h3 className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-pastel-orange">
            <span>Outlook</span>
            <span className="font-normal normal-case tracking-normal text-muted-foreground">via Citrus</span>
          </h3>
          <div className="mt-2 space-y-3">
            {citrusNotes.map((note) => (
              <div key={note.id} className="rounded-xl border border-border bg-white/5 px-3 py-2.5">
                <div className="text-sm font-bold text-pastel-cream">{note.headline}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-white/70">{note.body}</p>
                {note.analysis && (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">
                    <span className="font-bold text-pastel-cream">Analysis: </span>
                    {note.analysis}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!player.is_goalie && (
        <>
          <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-pastel-orange">
            Impact: GAR per 60
          </h3>
          <div className="mt-2">
            <MetricRow
              label="Total GAR/60"
              value={player.gar_per_60 != null ? `${f2(player.gar_per_60)}${garPct != null ? ` · ${garPct}th pct` : ''}` : 'No sample yet'}
            >
              <DivergingBar value={player.gar_per_60 ?? 0} scale={garScale} />
            </MetricRow>
            {garComponents.map((c) => (
              <MetricRow key={c.label} label={c.label} value={f2(c.v)}>
                <DivergingBar value={c.v ?? 0} scale={garScale} />
              </MetricRow>
            ))}
          </div>

          <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-pastel-orange">Shot Quality</h3>
          <div className="mt-2">
            <MetricRow
              label="Expected Goals / 60"
              value={player.xg_per_60 != null ? `${f2(player.xg_per_60)}${xgPct != null ? ` · ${xgPct}th pct` : ''}` : 'No sample yet'}
            >
              <div className="h-2 w-full overflow-hidden rounded bg-white/10">
                <span
                  className="block h-full rounded bg-gradient-to-r from-blue-500 to-amber-400"
                  style={{ width: `${xgPct ?? 0}%` }}
                />
              </div>
            </MetricRow>
            <MetricRow label="Season finishing" value={`${f1(player.x_goals)} xG vs ${player.goals} G`} />
          </div>
        </>
      )}

      {player.is_goalie && (
        <>
          <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-pastel-orange">Season Work</h3>
          <div className="mt-2">
            <MetricRow label="Saves" value={String(player.saves)} />
            <MetricRow label="Goals-against average" value={f2(player.gaa)} />
            <MetricRow
              label="Wins vs league"
              value={winPool.length ? `${player.wins} · ${percentile(winPool, player.wins)}th pct` : String(player.wins)}
            >
              <div className="h-2 w-full overflow-hidden rounded bg-white/10">
                <span
                  className="block h-full rounded bg-gradient-to-r from-blue-500 to-green-400"
                  style={{ width: `${winPool.length ? percentile(winPool, player.wins) : 0}%` }}
                />
              </div>
            </MetricRow>
          </div>
        </>
      )}

      <div className="mt-5 rounded-xl border border-dashed border-pastel-orange/50 bg-white/5 p-3.5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Rolled-forward projection{player.proj_gp != null ? ` · ${player.proj_gp} proj GP` : ''}
        </h3>
        {player.proj_fantasy_points == null ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No projection yet. Projections populate from the nightly pipeline once a player has a season sample.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5 text-sm">
            {!player.is_goalie && projNhlPts != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Proj NHL points</span>
                <span className="font-semibold">{f1(projNhlPts)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Proj fantasy points</span>
              <span className="font-semibold">{f1(player.proj_fantasy_points)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fantasy pts / game</span>
              <span className="font-semibold">{f2(player.proj_fantasy_ppg)}</span>
            </div>
            {!player.is_goalie && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Proj goals / assists</span>
                <span className="font-semibold">
                  {f1(player.proj_goals)} G · {f1(player.proj_assists)} A
                </span>
              </div>
            )}
            {!player.is_goalie && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Proj shots · PP pts</span>
                <span className="font-semibold">
                  {f1(player.proj_sog)} · {f1(player.proj_ppp)}
                </span>
              </div>
            )}
            {player.is_goalie && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Proj wins · saves · SO</span>
                <span className="font-semibold">
                  {f1(player.proj_wins)} · {f1(player.proj_saves)} · {f1(player.proj_shutouts)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

const Players = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // The shared, once-per-session payload. Identical loading/error semantics
  // to the effect this replaced; `reload` is what Retry calls.
  const { players, loading, error: loadError, reload } = usePlayerDashboardIndex();

  const [search, setSearch] = useState('');
  const [team, setTeam] = useState<string>('ALL');
  const [position, setPosition] = useState<string>('ALL');
  const [group, setGroup] = useState<'skaters' | 'goalies'>('skaters');
  const [skaterSort, setSkaterSort] = useState<SkaterSortKey>('points');
  const [goalieSort, setGoalieSort] = useState<GoalieSortKey>('wins');
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const p = searchParams.get('player');
    return p ? parseInt(p, 10) || null : null;
  });
  /*
   * PRESS BOX (2026-09-04). Below lg the page is PlayersBrowsePhone and a
   * row tap opens the SHARED player card (`cardPlayer`), whose Detailed
   * tab draws the same GAR / xG breakdown the side panel draws from lg.
   * The old phone overlay of that panel is gone with it. `useIsMobile` is
   * the one viewport answer; the card is a portal, so a class cannot gate
   * it.
   */
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [phoneSearchOpen, setPhoneSearchOpen] = useState(false);
  const [cardPlayer, setCardPlayer] = useState<HockeyPlayer | null>(null);

  const teams = useMemo(
    () => Array.from(new Set(players.map((p) => p.team).filter(Boolean))).sort(),
    [players],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter((p) => {
      if (group === 'skaters' ? p.is_goalie : !p.is_goalie) return false;
      if (team !== 'ALL' && p.team !== team) return false;
      if (position !== 'ALL' && p.position !== position) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [players, group, team, position, search]);

  const sorted = useMemo(() => {
    const key = group === 'skaters' ? skaterSort : goalieSort;
    return [...filtered].sort((a, b) => {
      const av = (a[key as keyof DashboardPlayer] as number | null) ?? -Infinity;
      const bv = (b[key as keyof DashboardPlayer] as number | null) ?? -Infinity;
      return bv - av;
    });
  }, [filtered, group, skaterSort, goalieSort]);

  const skaters = useMemo(() => players.filter((p) => !p.is_goalie && p.gp > 0), [players]);
  const goalies = useMemo(() => players.filter((p) => p.is_goalie && p.gp > 0), [players]);

  const selected = useMemo(() => {
    if (selectedId != null) {
      const hit = players.find((p) => p.id === selectedId);
      if (hit) return hit;
    }
    // Default feature: the top projected fantasy scorer of the current view.
    return sorted[0] ?? null;
  }, [players, selectedId, sorted]);

  const selectPlayer = (p: DashboardPlayer) => {
    setSelectedId(p.id);
    if (isMobile) setCardPlayer(dashboardEntryToHockeyPlayer(p));
    const next = new URLSearchParams(searchParams);
    next.set('player', String(p.id));
    setSearchParams(next, { replace: true });
  };

  const skaterCols: Array<{ key: SkaterSortKey; label: string }> = [
    { key: 'goals', label: 'G' },
    { key: 'assists', label: 'A' },
    { key: 'points', label: 'PTS' },
    { key: 'sog', label: 'SOG' },
    { key: 'xg_per_60', label: 'xG/60' },
    { key: 'gar_per_60', label: 'GAR/60' },
    { key: 'proj_fantasy_points', label: 'Proj FP' },
  ];
  const goalieCols: Array<{ key: GoalieSortKey; label: string }> = [
    { key: 'wins', label: 'W' },
    { key: 'save_pct', label: 'SV%' },
    { key: 'saves', label: 'SV' },
    { key: 'shutouts', label: 'SO' },
    { key: 'proj_wins', label: 'Proj W' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden relative min-h-screen bg-pressbox-surface pt-[env(safe-area-inset-top)] pb-app-chrome">
        <PressBoxAppHeader
          title="Players"
          logoSrc="/favicon.svg"
          onSearch={() => setPhoneSearchOpen((o) => !o)}
          onNotifications={() => navigate('/profile')}
        />
        <PlayersBrowsePhone
          className="mt-1"
          rows={sorted}
          total={sorted.length}
          loading={loading}
          error={loadError}
          onRetry={() => void reload()}
          group={group}
          onGroup={setGroup}
          position={position}
          onPosition={setPosition}
          teams={teams}
          team={team}
          onTeam={setTeam}
          skaterSort={skaterSort}
          onSkaterSort={setSkaterSort}
          goalieSort={goalieSort}
          onGoalieSort={setGoalieSort}
          searchOpen={phoneSearchOpen}
          searchQuery={search}
          onSearchQuery={setSearch}
          onOpen={selectPlayer}
        />
        {cardPlayer && (
          <Suspense fallback={null}>
            <PlayerStatsModal player={cardPlayer} isOpen onClose={() => setCardPlayer(null)} />
          </Suspense>
        )}
      </div>
      <main className="hidden lg:block container mx-auto px-4 pb-16 pt-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold">Players</h1>
          <p className="text-sm text-muted-foreground">
            Season actuals, xG shot quality, GAR/60 impact, and rolled-forward projections. Every team, every player.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search players…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-8"
              data-testid="players-search"
            />
          </div>
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="players-team-filter"
          >
            <option value="ALL">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="players-position-filter"
          >
            <option value="ALL">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <div className="ml-auto flex overflow-hidden rounded-md border border-border">
            {(['skaters', 'goalies'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`px-3 py-2 text-sm font-medium capitalize transition-colors ${
                  group === g ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
                data-testid={`players-group-${g}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading players…
          </div>
        )}

        {!loading && loadError && (
          <Card className="flex items-center justify-between gap-4 p-5">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" onClick={() => void reload()} data-testid="players-retry">
              Retry
            </Button>
          </Card>
        )}

        {!loading && !loadError && (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card className="overflow-hidden p-0 lg:order-1">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-sm" data-testid="players-table">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      {/* Sticky LEFT as well as top: at phone widths the table
                          scrolls horizontally inside its container — the name
                          column must stay in view or swiped stats lose context. */}
                      <th className="sticky left-0 top-0 z-sticky-raised bg-card px-3 py-2.5">Player</th>
                      <th className="sticky top-0 z-sticky-base bg-card px-2 py-2.5 text-right">GP</th>
                      {(group === 'skaters' ? skaterCols : goalieCols).map((col) => (
                        <th key={col.key} className="sticky top-0 z-sticky-base bg-card px-2 py-2.5 text-right">
                          <button
                            className={`hover:text-foreground ${
                              (group === 'skaters' ? skaterSort : goalieSort) === col.key ? 'text-pastel-orange' : ''
                            }`}
                            onClick={() =>
                              group === 'skaters'
                                ? setSkaterSort(col.key as SkaterSortKey)
                                : setGoalieSort(col.key as GoalieSortKey)
                            }
                          >
                            {col.label}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.slice(0, 400).map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => selectPlayer(p)}
                        className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-white/5 ${
                          selected?.id === p.id ? 'bg-white/10' : ''
                        }`}
                      >
                        <td className={`sticky left-0 z-sticky-base px-3 py-2 ${selected?.id === p.id ? 'bg-muted' : 'bg-card'}`}>
                          <div className="flex items-center gap-2.5">
                            <Mug p={mugOf(p)} size="sm" crest />
                            <div className="min-w-0 max-w-[160px]">
                              <div className="truncate font-medium">{p.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {p.team} · #{p.jersey ?? '-'} · {p.position}
                              </div>
                            </div>
                            {/* The row itself still SELECTS (the panel beside
                                it, or the sheet below lg) because that is the
                                scanning gesture this table was built for and
                                people use it. This is the additional, explicit
                                way through to the full page: a real anchor, so
                                it is keyboard reachable and openable in a new
                                tab, and stopPropagation so it never doubles as
                                a selection. */}
                            <Link
                              to={playerDashboardHref(p.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Open the full dashboard for ${p.name}`}
                              data-testid="players-row-dashboard-link"
                              className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-pastel-orange"
                            >
                              <ArrowUpRight className="h-4 w-4" />
                            </Link>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{p.gp}</td>
                        {group === 'skaters' ? (
                          <>
                            <td className="px-2 py-2 text-right tabular-nums">{p.goals}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{p.assists}</td>
                            <td className="px-2 py-2 text-right font-semibold tabular-nums">{p.points}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{p.sog}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{f2(p.xg_per_60)}</td>
                            <td
                              className={`px-2 py-2 text-right tabular-nums ${
                                (p.gar_per_60 ?? 0) > 0.005
                                  ? 'text-green-500'
                                  : (p.gar_per_60 ?? 0) < -0.005
                                    ? 'text-red-400'
                                    : ''
                              }`}
                            >
                              {f2(p.gar_per_60)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">{f1(p.proj_fantasy_points)}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-2 py-2 text-right tabular-nums">{p.wins}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{svp(p.save_pct)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{p.saves}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{p.shutouts}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{f1(p.proj_wins)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                          No players match those filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {sorted.length > 400 && (
                <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  Showing top 400 of {sorted.length}. Narrow with search or filters.
                </p>
              )}
            </Card>

            <div className="hidden lg:block lg:sticky lg:top-4 lg:order-2">
              {selected ? (
                <PlayerDashboardPanel player={selected} skaters={skaters} goalies={goalies} />
              ) : (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  Select a player to open their dashboard.
                </Card>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
};

export default Players;

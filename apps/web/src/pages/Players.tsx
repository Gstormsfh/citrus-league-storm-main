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
// payload (~1–2k rows) — no per-interaction network chatter.
//
// Deep-link: /players?player=<id> selects that player on load;
// selection writes the param back so any player view is shareable.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, ShieldAlert } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useCitrusPlayerNotes } from '@/hooks/useCitrusPlayerNotes';

export interface DashboardPlayer {
  id: number;
  name: string;
  team: string;
  position: string;
  jersey: number | null;
  headshot_url: string | null;
  is_goalie: boolean;
  roster_status: string | null;
  gp: number;
  goals: number;
  assists: number;
  points: number;
  sog: number;
  hits: number;
  blocks: number;
  ppp: number;
  plus_minus: number;
  x_goals: number;
  wins: number;
  saves: number;
  save_pct: number;
  gaa: number;
  shutouts: number;
  xg_per_60: number | null;
  xg_rating: string | null;
  gar_per_60: number | null;
  gar_evo: number | null;
  gar_evd: number | null;
  gar_ppo: number | null;
  gar_ppd: number | null;
  gar_pen: number | null;
  proj_gp: number | null;
  proj_fantasy_points: number | null;
  proj_fantasy_ppg: number | null;
  proj_goals: number | null;
  proj_assists: number | null;
  proj_sog: number | null;
  proj_ppp: number | null;
  proj_wins: number | null;
  proj_saves: number | null;
  proj_shutouts: number | null;
}

const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;

type SkaterSortKey = 'points' | 'goals' | 'assists' | 'sog' | 'xg_per_60' | 'gar_per_60' | 'proj_fantasy_points';
type GoalieSortKey = 'wins' | 'save_pct' | 'saves' | 'shutouts' | 'proj_wins';

const f1 = (v: number | null | undefined) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const f2 = (v: number | null | undefined) => (v == null ? '—' : (Math.round(v * 100) / 100).toFixed(2));
const svp = (v: number | null | undefined) =>
  v == null || v === 0 ? '—' : (v < 1 ? v : v / 1000).toFixed(3).replace(/^0/, '');

/** Percentile of `val` within `arr` (fraction of values <= val), 0–100. */
function percentile(arr: number[], val: number): number {
  if (arr.length === 0) return 0;
  let c = 0;
  for (const x of arr) if (x <= val) c += 1;
  return Math.round((100 * c) / arr.length);
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function Headshot({ player, size }: { player: DashboardPlayer; size: 'sm' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  const cls =
    size === 'lg'
      ? 'h-24 w-24 rounded-2xl border-2 border-white/20'
      : 'h-9 w-9 rounded-lg border border-white/10';
  if (!player.headshot_url || broken) {
    return (
      <div className={`${cls} flex items-center justify-center bg-white/10 text-xs font-bold text-white/70`}>
        {initials(player.name)}
      </div>
    );
  }
  return (
    <img
      src={player.headshot_url}
      alt={player.name}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`${cls} bg-white/10 object-cover`}
    />
  );
}

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
        <Headshot player={player} size="lg" />
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold">{player.name}</h2>
          <p className="text-sm text-muted-foreground">
            #{player.jersey ?? '—'} · {player.position} · {player.team}
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
            Impact — GAR per 60
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
            No projection yet — projections populate from the nightly pipeline once a player has a season sample.
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
  const [players, setPlayers] = useState<DashboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchNonce, setFetchNonce] = useState(0);

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
  // Mobile-only overlay for the dashboard panel (opened by a row tap,
  // never on load — `selected` defaults to the top scorer, which must
  // not auto-open a sheet).
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const response = await apiClient.get<DashboardPlayer[]>('/api/players/dashboard-index');
        if (cancelled) return;
        const list = (response.data ?? (response as unknown as DashboardPlayer[])) as DashboardPlayer[];
        setPlayers(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!cancelled) {
          setLoadError((err as { message?: string })?.message ?? 'Failed to load players.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchNonce]);

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
    // Below lg the dashboard panel sits under the 400-row table where a
    // tap looks like a no-op — surface it as an overlay instead.
    setMobilePanelOpen(true);
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
      <Navbar />
      <main className="container mx-auto px-4 pb-16 pt-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold">Players</h1>
          <p className="text-sm text-muted-foreground">
            Season actuals, xG shot quality, GAR/60 impact, and rolled-forward projections — every team, every player.
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
            <Button variant="outline" onClick={() => setFetchNonce((n) => n + 1)} data-testid="players-retry">
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
                      <th className="sticky left-0 top-0 z-20 bg-card px-3 py-2.5">Player</th>
                      <th className="sticky top-0 z-10 bg-card px-2 py-2.5 text-right">GP</th>
                      {(group === 'skaters' ? skaterCols : goalieCols).map((col) => (
                        <th key={col.key} className="sticky top-0 z-10 bg-card px-2 py-2.5 text-right">
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
                        <td className={`sticky left-0 z-10 px-3 py-2 ${selected?.id === p.id ? 'bg-muted' : 'bg-card'}`}>
                          <div className="flex items-center gap-2.5">
                            <Headshot player={p} size="sm" />
                            <div className="min-w-0 max-w-[160px]">
                              <div className="truncate font-medium">{p.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {p.team} · #{p.jersey ?? '—'} · {p.position}
                              </div>
                            </div>
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
                  Showing top 400 of {sorted.length} — narrow with search or filters.
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

        {/* Below lg: the side panel above is hidden, so a row tap opens the
            same dashboard as a dismissible overlay sheet. */}
        {mobilePanelOpen && selected && (
          <div
            className="lg:hidden fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm p-3"
            role="dialog"
            aria-modal="true"
            onClick={() => setMobilePanelOpen(false)}
          >
            <div className="mx-auto mb-10 mt-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setMobilePanelOpen(false)}>
                  Close
                </Button>
              </div>
              <PlayerDashboardPanel player={selected} skaters={skaters} goalies={goalies} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Players;

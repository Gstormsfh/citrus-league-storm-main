import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import {
  DarkLayout,
  HockeyFooter,
  RinkHeatmap,
  type RinkMode,
  PercentileRingCluster,
  type RingMetric,
  SparklineMicroChart,
  VerdictTile,
  WrappedChapter,
  KDEDistribution,
  PercentileBullet,
  type PercentileCategory,
  StaleDataBadge,
  CitrusButton,
} from '@/components/citrus2';
import { PlayerAdvancedCard } from '@/components/player/PlayerAdvancedCard';
import {
  usePlayerDashboardIndex,
  type DashboardIndexEntry,
} from '@/hooks/usePlayerDashboardIndex';
import {
  usePlayerDashboard,
  type DashboardIdentity,
  type PlayerDashboardPayload,
} from '@/hooks/usePlayerDashboard';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  buildMetricScale,
  placeOnScale,
  playerCohort,
  type MetricDirection,
  type MetricScale,
  type PlayerCohort,
} from '@/utils/playerPercentiles';
import {
  careerSeries,
  deriveGoalieVerdict,
  deriveShotVerdict,
  ordinal,
  seasonLabel,
  seasonRow,
  signed,
  summariseShots,
  toRinkEvents,
  SHOT_ZONE_DEFINITION,
  type ShotSummary,
} from '@/components/player/playerDashboardData';
import { cn } from '@/lib/utils';

/**
 * THE PLAYER DASHBOARD — Component 6.5, and the first time this screen has
 * ever been reachable by a person.
 *
 * `pages/PreviewPlayerProfile.tsx` composed the locked Concept 3 "Spatial
 * Hero" (apps/web/docs/PLAYER_DASHBOARD_DESIGN_SPEC.md §1–§2) against
 * `MOCK_*` constants and a `jitter()` helper, on a route inside `App.tsx`'s
 * `import.meta.env.DEV` gate — statically false in a production build, so
 * Rollup dropped the route and the chunk. The design system rendered for
 * nobody. This file is that composition, zone for zone, wired to
 * `/api/players/:playerId/dashboard` and routed OUTSIDE the gate.
 *
 * IT IS A DATA-WIRING JOB, NOT A REDESIGN. Every zone, every primitive and
 * the visual language are the preview's. What changed is where the numbers
 * come from, and the states a real payload forces the page to have.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT IS MEASURED AND WHAT IS MODELLED
 *
 * Goals, shots, saves, wins: measured, from the NHL play-by-play.
 * xG, GSAx, GAR, VOPA: OUR MODEL'S OUTPUT. Every surface below that shows
 * one says so in words — "our model", "expected", "vs expectation" — and
 * no modelled number is ever printed as if it were a fact of the game.
 *
 * Every percentile on this page names its cohort AND its size (`n=`),
 * because the founder's standing rule is that a claim carries its evidence.
 * The cohort is built by `utils/playerPercentiles`, the same module the
 * condensed card and the Players table use, so the same player cannot read
 * 89th here and 74th there.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ANTI-PATTERN CHECKLIST (spec §4) — what this page does about each
 *
 *  1. No flat stacked percentile bars: the bento is asymmetric and the
 *     Shot Breakdown rows are share-of-attempts meters, not a JFresh stack.
 *  2. No 3-column card grid: `lg:grid-cols-[1.1fr_1fr_1.1fr]`, asymmetric.
 *  3. No decorative axes: `SparklineMicroChart` and `KDEDistribution` carry
 *     no numeric axis labels, by their own construction.
 *  4. Pills only for meaningful state: the only chips are the freshness
 *     badge and the truncation/limited-sample notices, each of which fires
 *     only when the condition is true.
 *  5. Not centered: hero identity bottom-left, verdict top-right, callout
 *     right of the curve.
 *  6. Segmented control, never a tab strip — the rink's own 5V5/PP/xG/G−xG.
 *  7. Every colour encodes: orange = focal/highest, sage = defence/success,
 *     butter = caution and low sample, cream = primary text.
 *  8. No hero-number-with-caps-label-below below monumental scale: the
 *     GSAx hero number and the chapter callout are both 64–96px.
 *  9. No layout-mirroring grey skeletons: `DashboardSkeleton` is a shimmer
 *     of undifferentiated blocks, not a grey tracing of the final page.
 * 10. No hockey clichés: the jersey watermark is the maximum literal
 *     reference the spec allows and it is the only one.
 *
 * ─────────────────────────────────────────────────────────────────────
 * PHONE FIRST — see `HERO ZONE` below for the one structural change made
 * at 393px and the measurement behind it.
 *
 * ATTESTATION (per META-RULE protocol — spec §9):
 * - 21st.dev primitive: hand-built page composition, inherited verbatim
 *   from `PreviewPlayerProfile`, whose own attestation records the three
 *   queries fired and why no primitive matched a full-bleed sport hero +
 *   asymmetric bento + Wrapped chapter. No new primitive was introduced
 *   here; every visual element is an existing `components/citrus2` export.
 * - Design principle referenced: spec §2 zone contract — "The product is a
 *   single page with four declared zones. Every component lives in exactly
 *   one zone, and that zone declares which design movement governs its
 *   treatment." Plus §"PWS-2 Option 1 (recommended)": "render the condensed
 *   `PlayerCard` inline at the top of the full profile, then the deep-dive
 *   below."
 * - Matched mockup section: the whole of concept-3-spatial-hero.jpg —
 *   chrome nav → full-bleed rink hero with jersey watermark, name, floating
 *   Stormy verdict and segmented mode control → asymmetric bento → KDE
 *   chapter with the monumental callout.
 */

// ── Chrome helpers ───────────────────────────────────────────────────

/** Page-level chapter header. Same treatment as `WrappedChapter`'s eyebrow. */
function ChapterEyebrow({
  chapterNumber,
  title,
  className = '',
}: {
  chapterNumber: number;
  title: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="h-px flex-1 bg-white/[0.08]" aria-hidden="true" />
      <span className="font-jbmono uppercase tracking-[0.32em] text-[11px] sm:text-[12px] font-bold text-pastel-orange-soft whitespace-nowrap">
        Chapter {chapterNumber} · {title}
      </span>
      <span className="h-px flex-1 bg-white/[0.08]" aria-hidden="true" />
    </div>
  );
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'font-jbmono uppercase tracking-[0.22em] text-[10px] font-bold text-white/55',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A tabular figure with its label ABOVE it (anti-pattern #8). */
function StatCell({
  label,
  value,
  sub,
  accent = 'cream',
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'cream' | 'orange' | 'sage' | 'butter';
}) {
  const tone =
    accent === 'orange'
      ? 'text-pastel-orange-soft'
      : accent === 'sage'
        ? 'text-pastel-sage'
        : accent === 'butter'
          ? 'text-pastel-butter'
          : 'text-pastel-cream';
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <div className={cn('mt-1.5 font-jbmono font-bold tabular-nums text-[22px] leading-none', tone)}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11px] leading-tight text-white/70">{sub}</div>}
    </div>
  );
}

/** One page-wide shell so every state below wears the same chrome. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <DarkLayout>
      <Navbar />
      <main className="relative pt-20 pb-12">{children}</main>
      <HockeyFooter />
    </DarkLayout>
  );
}

/**
 * A centred message state — signed out, not found, failed.
 *
 * Deliberately the ONE centred composition on the page (anti-pattern #5
 * bans centred CARD LAYOUTS for content; a single message is not a layout),
 * and deliberately not a toast: this is the whole screen's outcome.
 */
function MessageState({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Shell>
      <div className="mx-auto max-w-[560px] px-5 py-16 text-center">
        <Eyebrow className="mb-4">{eyebrow}</Eyebrow>
        <h1 className="font-sans font-black normal-case text-pastel-cream text-[32px] sm:text-[44px] leading-[0.95] tracking-[-0.03em]">
          {title}
        </h1>
        <p className="mt-5 text-[14px] leading-relaxed text-white/70">{body}</p>
        {action && <div className="mt-7 flex justify-center">{action}</div>}
      </div>
    </Shell>
  );
}

/**
 * The loading state.
 *
 * Anti-pattern #9 forbids "skeleton loaders that mirror the final layout in
 * gray" and asks for "shimmer that doesn't reveal layout" — so these are
 * three undifferentiated shimmer blocks in the page's own surface tint, not
 * a grey tracing of a rink, three tiles and a curve. It is also NOT a
 * centred spinner: a full-page composition that pops in from a spinner
 * reads as a crash recovering.
 */
function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading player dashboard" className="mx-auto max-w-[1280px] px-4 sm:px-6">
      <div className="h-[220px] sm:h-[420px] rounded-2xl bg-pastel-surface-tile animate-pulse" />
      <div className="mt-6 h-[160px] rounded-2xl bg-pastel-surface-tile animate-pulse" />
      <div className="mt-6 h-[280px] rounded-2xl bg-pastel-surface-tile animate-pulse" />
    </div>
  );
}

// ── HERO ─────────────────────────────────────────────────────────────

interface HeroIdentity {
  name: string;
  eyebrow: string;
  jersey: number | null;
}

/**
 * The hero for everyone the rink cannot serve: a goalie (who has no map of
 * his OWN shots), a player with no shots on record for this season, and the
 * case where the coordinates could not be verified against their stored
 * distances.
 *
 * It keeps the HERO zone's declared movement — Concrete Poetry: jersey
 * watermark as an architectural element, monumental typography, one figure
 * that dominates — so the page does not change character when the data
 * does. What it never does is draw an empty rink: an outline with no dots
 * reads as "this player never shot the puck", which for a goalie is not
 * even a coherent claim.
 */
function HeroFallback({
  identity,
  headline,
  headlineLabel,
  headlineSub,
  note,
  verdict,
  accent = 'cream',
}: {
  identity: HeroIdentity;
  headline?: string;
  headlineLabel?: string;
  headlineSub?: string;
  note: string;
  verdict?: string | null;
  accent?: 'cream' | 'orange' | 'sage' | 'butter';
}) {
  const tone =
    accent === 'orange'
      ? 'text-pastel-orange-soft'
      : accent === 'sage'
        ? 'text-pastel-sage'
        : accent === 'butter'
          ? 'text-pastel-butter'
          : 'text-pastel-cream';

  return (
    <section
      aria-labelledby="player-hero-name"
      className="relative w-full max-w-[1100px] mx-auto overflow-hidden rounded-2xl bg-pastel-surface ring-1 ring-white/10 px-6 sm:px-10 py-8 sm:py-12"
    >
      {identity.jersey != null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-6 left-2 select-none font-sans font-black leading-none tracking-tighter text-pastel-cream/[0.07] text-[120px] sm:text-[180px]"
        >
          {identity.jersey}
        </span>
      )}

      <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="font-jbmono uppercase tracking-[0.22em] text-[11px] sm:text-[12px] font-bold text-white/55 mb-1.5">
            {identity.eyebrow}
          </div>
          {/* `normal-case` is load-bearing: index.css sets
              `h1, h2, .font-varsity { text-transform: uppercase }` in the base
              layer, so without it this heading shouts "CARTER HART" while the
              rink hero two cases over renders "Connor McDavid". Measured in
              the harness at 393. */}
          <h1
            id="player-hero-name"
            className="font-sans font-black normal-case text-pastel-cream text-[36px] sm:text-[52px] md:text-[64px] leading-[0.92] tracking-[-0.04em]"
          >
            {identity.name}
          </h1>
          <p className="mt-4 max-w-[42ch] text-[12px] leading-snug text-white/70">{note}</p>
        </div>

        {headline && (
          <div className="flex-shrink-0 lg:text-right">
            {headlineLabel && <Eyebrow className="mb-3">{headlineLabel}</Eyebrow>}
            <div
              className={cn(
                'font-sans font-black tabular-nums leading-[0.85] tracking-[-0.04em]',
                'text-[64px] sm:text-[80px] lg:text-[96px]',
                tone,
              )}
            >
              {headline}
            </div>
            {headlineSub && (
              <div className="mt-4 font-jbmono uppercase tracking-[0.22em] text-[10px] sm:text-[11px] font-bold text-white/55">
                {headlineSub}
              </div>
            )}
          </div>
        )}
      </div>

      {verdict && (
        <div className="relative z-10 mt-8 max-w-[560px] rounded-xl bg-pastel-surface-tile/85 p-3.5 ring-1 ring-white/10">
          <div className="font-jbmono uppercase tracking-[0.22em] text-[9px] font-bold text-white/55 mb-1">
            Stormy verdict
          </div>
          <div className="font-sans italic text-[13px] sm:text-[14px] leading-snug text-pastel-orange-soft">
            {verdict}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Shot breakdown ───────────────────────────────────────────────────

/**
 * One zone row: caps eyebrow LEFT, thin meter MIDDLE, tabular value RIGHT,
 * hairline divider — the Concept 3 bullet anatomy the spec asks for in §2.2.
 *
 * IT IS DELIBERATELY NOT `PercentileBullet`. That primitive renders "38th"
 * next to whatever it is handed, and the number here is a SHARE OF THIS
 * PLAYER'S OWN ATTEMPTS, not a rank against the league — we hold one
 * player's shots, not the league's. Feeding a share into a percentile slot
 * would print a rank that does not exist, which is the exact class of claim
 * this page is not allowed to make. Same anatomy, honest encoding.
 */
function ZoneShareRow({
  zone,
  share,
  attempts,
  goals,
  xgPerShot,
  isTop,
}: {
  zone: string;
  share: number;
  attempts: number;
  goals: number;
  xgPerShot: number | null;
  isTop: boolean;
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-jbmono uppercase tracking-[0.18em] text-[10px] font-bold text-pastel-cream truncate">
          {zone}
        </span>
        <span className="flex-shrink-0 font-jbmono font-bold tabular-nums text-[13px] text-pastel-cream">
          {attempts}
          <span className="ml-1 font-medium text-white/55">att</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={cn('h-full rounded-full', isTop ? 'bg-pastel-orange' : 'bg-pastel-sage')}
          style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="font-jbmono uppercase tracking-[0.18em] text-[9px] font-bold text-white/55 tabular-nums">
          {share.toFixed(0)}% of attempts · {goals} G
        </span>
        <span className="font-jbmono uppercase tracking-[0.18em] text-[9px] font-bold text-white/55 tabular-nums">
          {xgPerShot != null ? `${xgPerShot.toFixed(3)} xG/shot` : '—'}
        </span>
      </div>
    </div>
  );
}

function ShotBreakdownTile({ summary, modeLabel }: { summary: ShotSummary; modeLabel: string }) {
  const topAttempts = summary.zones.reduce((m, z) => Math.max(m, z.attempts), 0);
  return (
    <div
      role="group"
      aria-label="Shot breakdown by zone"
      className="flex h-full flex-col rounded-2xl bg-pastel-surface-tile p-5 ring-1 ring-white/10 sm:p-6"
    >
      <div className="mb-1 font-jbmono text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">
        Shot Breakdown · {modeLabel}
      </div>
      <div className="mb-4 text-[11px] leading-snug text-white/70">
        {summary.plotted} of {summary.total} attempts placed on the rink. Zones are the rink&apos;s
        own geometry — the slot is {SHOT_ZONE_DEFINITION.SLOT}.
      </div>
      <div className="flex flex-1 flex-col divide-y divide-white/[0.06]">
        {summary.zones.map((z) => (
          <ZoneShareRow
            key={z.zone}
            zone={z.zone}
            share={z.share}
            attempts={z.attempts}
            goals={z.goals}
            xgPerShot={z.xgPerShot}
            isTop={z.attempts === topAttempts && topAttempts > 0}
          />
        ))}
      </div>
    </div>
  );
}

// ── Percentile plumbing ──────────────────────────────────────────────

interface MetricSpec {
  key: string;
  label: string;
  context: string;
  category: PercentileCategory;
  direction: MetricDirection;
  select: (p: DashboardIndexEntry) => number | null;
  format: (v: number) => string;
}

const SKATER_METRICS: MetricSpec[] = [
  { key: 'xg60', label: 'xG/60', context: 'our model', category: 'offense', direction: 'higher', select: (p) => p.xg_per_60, format: (v) => v.toFixed(2) },
  { key: 'gar', label: 'GAR/60', context: 'total', category: 'offense', direction: 'higher', select: (p) => p.gar_per_60, format: (v) => v.toFixed(3) },
  { key: 'evo', label: 'EV offence', context: 'GAR/60', category: 'offense', direction: 'higher', select: (p) => p.gar_evo, format: (v) => v.toFixed(3) },
  { key: 'evd', label: 'EV defence', context: 'GAR/60', category: 'defense', direction: 'higher', select: (p) => p.gar_evd, format: (v) => v.toFixed(3) },
  { key: 'ppo', label: 'PP offence', context: 'GAR/60', category: 'special', direction: 'higher', select: (p) => p.gar_ppo, format: (v) => v.toFixed(3) },
  { key: 'pen', label: 'Penalties', context: 'GAR/60', category: 'special', direction: 'higher', select: (p) => p.gar_pen, format: (v) => v.toFixed(3) },
  { key: 'pts', label: 'Points', context: 'season', category: 'offense', direction: 'higher', select: (p) => p.points, format: (v) => String(Math.round(v)) },
  { key: 'sog', label: 'Shots', context: 'season', category: 'offense', direction: 'higher', select: (p) => p.sog, format: (v) => String(Math.round(v)) },
];

const GOALIE_METRICS: MetricSpec[] = [
  { key: 'svpct', label: 'Save rate', context: 'season', category: 'defense', direction: 'higher', select: (p) => p.save_pct, format: (v) => (v > 1 ? v.toFixed(1) : v.toFixed(3)) },
  { key: 'gaa', label: 'GAA', context: 'lower is better', category: 'defense', direction: 'lower', select: (p) => p.gaa, format: (v) => v.toFixed(2) },
  { key: 'wins', label: 'Wins', context: 'season', category: 'offense', direction: 'higher', select: (p) => p.wins, format: (v) => String(Math.round(v)) },
  { key: 'saves', label: 'Saves', context: 'season', category: 'defense', direction: 'higher', select: (p) => p.saves, format: (v) => String(Math.round(v)) },
  { key: 'so', label: 'Shutouts', context: 'season', category: 'special', direction: 'higher', select: (p) => p.shutouts, format: (v) => String(Math.round(v)) },
];

const COHORT_NOUN: Record<PlayerCohort, string> = {
  F: 'forwards',
  D: 'defencemen',
  G: 'goalies',
};

interface PlacedMetric {
  spec: MetricSpec;
  percentile: number | null;
  cohortSize: number;
  display: string | null;
}

function placeMetrics(
  specs: MetricSpec[],
  index: readonly DashboardIndexEntry[],
  cohort: PlayerCohort,
  player: DashboardIndexEntry | null,
): { metrics: PlacedMetric[]; cohortSize: number } {
  if (!player || index.length === 0) return { metrics: [], cohortSize: 0 };
  let cohortSize = 0;
  const metrics = specs.map((spec) => {
    const scale: MetricScale = buildMetricScale(index, cohort, spec.select, spec.direction);
    const placed = placeOnScale(scale, spec.select(player), player.gp);
    cohortSize = Math.max(cohortSize, placed.cohortSize);
    const raw = spec.select(player);
    return {
      spec,
      percentile: placed.percentile,
      cohortSize: placed.cohortSize,
      display: typeof raw === 'number' && Number.isFinite(raw) ? spec.format(raw) : null,
    };
  });
  return { metrics, cohortSize };
}

// ── The page ─────────────────────────────────────────────────────────

const RINK_MODE_LABEL: Record<string, string> = {
  '5v5': '5v5',
  pp: 'power play',
  pk: 'shorthanded',
  xg: 'all situations',
  'g-xg': 'goals only',
  shots: 'all situations',
};

export default function PlayerDashboard() {
  const params = useParams<{ playerId: string }>();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [rinkMode, setRinkMode] = useState<RinkMode>('xg');

  const playerId = useMemo(() => {
    const raw = params.playerId ?? '';
    return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  }, [params.playerId]);

  // Season / game type ride on the URL rather than on a control: a deep
  // link can pin a season, and the page gains the endpoint's full range
  // without adding a second segmented control beside the rink's own.
  const seasonParam = searchParams.get('season');
  const season = seasonParam && /^\d{4}$/.test(seasonParam) ? Number(seasonParam) : undefined;
  const gameTypeParam = searchParams.get('gameType');
  const gameType: 'regular' | 'playoff' = gameTypeParam === 'playoff' ? 'playoff' : 'regular';

  const dash = usePlayerDashboard(playerId, { season, gameType });
  // The league payload, already in memory on any surface that opened a
  // player card. It is what every percentile and every distribution on this
  // page is measured against — the per-player endpoint knows one player and
  // a percentile needs a league.
  const index = usePlayerDashboardIndex({ enabled: playerId != null });

  const payload: PlayerDashboardPayload | null = dash.data;

  const indexEntry = useMemo(
    () => (playerId == null ? null : index.players.find((p) => p.id === playerId) ?? null),
    [index.players, playerId],
  );

  const identity: DashboardIdentity | null = useMemo(() => {
    if (payload?.player) return payload.player;
    if (indexEntry) {
      return {
        player_id: indexEntry.id,
        name: indexEntry.name,
        team: indexEntry.team,
        position: indexEntry.position,
        jersey: indexEntry.jersey,
        headshot_url: indexEntry.headshot_url,
        is_goalie: indexEntry.is_goalie,
      };
    }
    return null;
  }, [payload, indexEntry]);

  const summary = useMemo(
    () => summariseShots(payload?.shots ?? []),
    [payload],
  );

  const rinkShots = useMemo(
    () => toRinkEvents(payload?.shots ?? [], rinkMode),
    [payload, rinkMode],
  );

  const activeSeason = payload?.season ?? season ?? null;
  const xgRow = useMemo(
    () => (payload && activeSeason != null ? seasonRow(payload.seasons, activeSeason, gameType) : null),
    [payload, activeSeason, gameType],
  );

  const arc = useMemo(
    () => careerSeries(payload?.seasons ?? [], gameType),
    [payload, gameType],
  );

  const cohort: PlayerCohort = identity
    ? playerCohort({ position: identity.position, is_goalie: identity.is_goalie })
    : 'F';
  const isGoalie = identity?.is_goalie ?? false;

  const placed = useMemo(
    () => placeMetrics(isGoalie ? GOALIE_METRICS : SKATER_METRICS, index.players, cohort, indexEntry),
    [isGoalie, index.players, cohort, indexEntry],
  );

  // The three rings. Skaters decompose GAR into EV offence / EV defence /
  // PP offence, which is the decomposition the payload actually carries;
  // goalies get the three goalie numbers instead of three empty rings.
  const rings: RingMetric[] = useMemo(() => {
    const byKey = new Map(placed.metrics.map((m) => [m.spec.key, m]));
    const pick = (key: string, label: string, category: RingMetric['category']): RingMetric | null => {
      const m = byKey.get(key);
      if (!m || m.percentile == null) return null;
      return { category, label, percentile: m.percentile, sampleSize: m.cohortSize };
    };
    const candidates = isGoalie
      ? [pick('svpct', 'SV%', 'defense'), pick('gaa', 'GAA', 'defense'), pick('wins', 'W', 'offense')]
      : [pick('evo', 'OFF', 'offense'), pick('evd', 'DEF', 'defense'), pick('ppo', 'ST', 'special')];
    return candidates.filter((r): r is RingMetric => r !== null);
  }, [placed, isGoalie]);

  // The Wrapped chapter's distribution. One source for the curve AND the
  // marker — mixing two sources of "the same" metric is how a page ends up
  // marking a player outside his own distribution.
  const chapter = useMemo(() => {
    if (!indexEntry) return null;
    const spec = isGoalie ? GOALIE_METRICS[0] : SKATER_METRICS[0];
    const scale = buildMetricScale(index.players, cohort, spec.select, spec.direction);
    const value = spec.select(indexEntry);
    if (scale.values.length < 30 || typeof value !== 'number' || !Number.isFinite(value)) return null;
    const sorted = scale.values;
    const median = sorted[Math.floor(sorted.length / 2)];
    const placedResult = placeOnScale(scale, value, indexEntry.gp);
    return {
      spec,
      samples: [...sorted],
      value,
      median,
      delta: value - median,
      percentile: placedResult.percentile,
      cohortSize: placedResult.cohortSize,
    };
  }, [indexEntry, index.players, cohort, isGoalie]);

  // ── States that replace the whole page ─────────────────────────────

  if (playerId == null) {
    return (
      <MessageState
        eyebrow="Player dashboard"
        title="That is not a player id"
        body="Player dashboards live at /players/<nhl player id>. Open one from the Players table and the link will be right."
        action={
          <CitrusButton to="/players" variant="primary">
            Browse players
          </CitrusButton>
        }
      />
    );
  }

  if (dash.unauthorized) {
    return (
      <MessageState
        eyebrow="Sign in required"
        title="Player dashboards are for signed-in managers"
        body="The shot data behind this page — every attempt of the season, scored by our own expected-goals model — is served to signed-in accounts only. Sign in and this link will open straight onto the player."
        action={
          <CitrusButton to="/auth" variant="primary">
            Sign in
          </CitrusButton>
        }
      />
    );
  }

  if (dash.loading) {
    return (
      <Shell>
        <DashboardSkeleton />
      </Shell>
    );
  }

  if (dash.status === 'error') {
    return (
      <MessageState
        eyebrow="Could not load"
        title="This dashboard did not come back"
        body={`${dash.error ?? 'The request failed.'} Nothing is broken on your end — try again, and if it keeps failing the API is having a moment.`}
        action={
          <CitrusButton variant="primary" onClick={dash.reload}>
            Try again
          </CitrusButton>
        }
      />
    );
  }

  if (!payload) {
    return (
      <MessageState
        eyebrow="Player dashboard"
        title="No dashboard for this player"
        body="The endpoint answered but carried nothing for this id. That usually means the player is not in the directory for the current season."
        action={
          <CitrusButton to="/players" variant="primary">
            Browse players
          </CitrusButton>
        }
      />
    );
  }

  // ── Composition ────────────────────────────────────────────────────

  // NO SYNTHESISED NAME. When neither the payload nor the index carries a
  // directory row — a retired player, or a season older than the current
  // directory — the hero prints the NHL id as an id, never "Player 8478402".
  // `src/__tests__/harnessFixtureFaces.test.ts` bans exactly that shape in
  // the harness fixtures because it went out in review screenshots for
  // months; a page that does it in production is the same defect with a
  // bigger audience.
  const heroIdentity: HeroIdentity = {
    name: identity?.name ?? `NHL #${playerId}`,
    eyebrow: identity
      ? `${identity.position} · ${identity.team}${activeSeason != null ? ` · ${seasonLabel(activeSeason)}` : ''}`
      : `Not in the ${activeSeason != null ? seasonLabel(activeSeason) : 'current'} directory`,
    jersey: identity?.jersey ?? null,
  };

  const finishing = xgRow?.finishing ?? null;
  const shotVerdict = deriveShotVerdict(summary, finishing);
  const goalieVerdict = deriveGoalieVerdict(payload.gsax);

  const gameTypeLabel = gameType === 'playoff' ? 'playoffs' : 'regular season';
  const modeLabel = RINK_MODE_LABEL[rinkMode] ?? 'all situations';

  // WHY THE RINK MAY NOT RENDER, in the order the checks run. Each branch
  // has its own sentence, because "no shot map" for a goalie and "no shot
  // map" because the read failed are different facts and a reader deserves
  // to know which one they are looking at.
  const rinkUnavailableReason: string | null = isGoalie
    ? `A goalie has no shot map of his own attempts. What he has is every shot he faced, and our model's verdict on it.`
    : !payload.shots_available
      ? `The shot log could not be read for this request, so there is no map to draw. Everything below is unaffected.`
      : summary.total === 0
        ? `No shots on record for ${heroIdentity.name} in the ${seasonLabel(payload.season)} ${gameTypeLabel}.`
        : !summary.reliable
          ? `Only ${summary.plotted} of ${summary.total} attempts could be placed against their own recorded distance, so the map is not drawn rather than drawn wrong.`
          : null;

  const showRink = rinkUnavailableReason === null;

  return (
    <Shell>
      {/* ────────────────────────────────────────────────────────────
          PWS-2 OPTION 1 — the condensed card inline at the top of the
          full profile, deep-dive below. The spec's own recommendation:
          "Gives shareable + scannable in a single URL — strongest of both
          worlds." Capped at 380px and LEFT-anchored rather than centred,
          because the data-zone law is asymmetric composition (§4 #5), and
          `showLink={false}` because the card's "Full dashboard →" link
          points at this page and we are already on it.
          ──────────────────────────────────────────────────────────── */}
      <div className="mx-auto mb-8 max-w-[1280px] px-4 sm:px-6">
        <div className="max-w-[380px]">
          <PlayerAdvancedCard playerId={playerId} variant="compact" showLink={false} />
        </div>
      </div>

      {/* ── HERO ZONE — Concrete Poetry ───────────────────────────── */}
      <div className="mx-auto mb-6 max-w-[1280px] px-4 sm:px-6">
        <ChapterEyebrow chapterNumber={1} title="OVERVIEW" />
      </div>

      <section aria-label="Player overview" className="relative px-4 sm:px-6">
        {showRink ? (
          <>
            <RinkHeatmap
              shots={rinkShots}
              mode={rinkMode}
              onModeChange={setRinkMode}
              playerName={heroIdentity.name}
              eyebrow={heroIdentity.eyebrow}
              jerseyNumber={heroIdentity.jersey ?? undefined}
              /* MOBILE RESTRUCTURE, and the one structural change on this
                 page. The floating verdict tile is `max-w-[320px]` at the
                 rink's top-right; the rink is `aspect-[100/55]`, so at a
                 393px viewport it is 361 × 199px and the tile covers 280 of
                 those 361px and roughly half the height — it sits ON the
                 slot cluster, which is the one part of the map that matters.
                 Below `lg` the verdict therefore moves OUT of the rink and
                 renders as its own tile underneath, where it has the full
                 column width and reads better anyway. The identity block
                 and the segmented control stay composed AT the rink at every
                 width, because that composition IS the signature (spec §1)
                 and it survives 361px. `useIsMobile` is the app's single
                 viewport question (Tailwind's `lg`, 1024px) — see the note
                 in `hooks/useIsMobile.ts` about not inventing a fifth one. */
              verdict={!isMobile && shotVerdict ? shotVerdict : undefined}
              /* MEASURED at 393 in the harness: the caption sits in an
                 absolutely-positioned strip `left-6 … right-44` (the mode
                 control owns the right 176px), so it gets ~161px on a phone,
                 and `truncate` on an inline <span> does not clip. The season
                 is already in the eyebrow two lines below, so it comes out of
                 the caption rather than overflowing it. */
              caption={`${rinkShots.length} attempts · ${modeLabel}${gameType === 'playoff' ? ' · playoffs' : ''}`}
            />
            {isMobile && shotVerdict && (
              <div className="mx-auto mt-4 max-w-[1100px]">
                <VerdictTile
                  variant="floating"
                  size="sm"
                  accent="orange"
                  eyebrow="Stormy verdict"
                  body={shotVerdict}
                />
              </div>
            )}
          </>
        ) : (
          <HeroFallback
            identity={heroIdentity}
            headline={
              isGoalie && payload.gsax ? signed(payload.gsax.raw_gsax, 1) : undefined
            }
            headlineLabel={isGoalie && payload.gsax ? 'GSAx · primary shots' : undefined}
            headlineSub={
              isGoalie && payload.gsax
                ? `${payload.gsax.shots_faced.toLocaleString()} shots faced · ${payload.gsax.xga.toFixed(1)} expected against`
                : undefined
            }
            accent={
              isGoalie && payload.gsax
                ? payload.gsax.raw_gsax >= 0
                  ? 'sage'
                  : 'butter'
                : 'cream'
            }
            note={rinkUnavailableReason ?? ''}
            verdict={isGoalie ? goalieVerdict : null}
          />
        )}

        {payload.shots_truncated && (
          <div className="mx-auto mt-3 max-w-[1100px]">
            <span className="font-jbmono text-[9px] font-bold uppercase tracking-[0.22em] text-pastel-butter">
              Shot list capped at {payload.shots_cap} — the map shows the first {payload.shots_cap} attempts of the season
            </span>
          </div>
        )}
      </section>

      {/* ── DATA ZONE — the career arc ────────────────────────────── */}
      <section
        aria-label="Career arc"
        className="relative mx-auto mt-12 max-w-[1280px] px-4 sm:px-6 sm:mt-16"
      >
        <ChapterEyebrow chapterNumber={2} title="CAREER ARC" className="mb-6" />
        {arc.points.length >= 2 ? (
          <>
            {/* THE EYEBROW MOVES OUT OF THE TILE ON A PHONE. Measured at 393:
                `SparklineMicroChart` floats its endpoint value label at the
                last point's height, and a series whose newest season is its
                maximum puts that label at the top of the chart area — on top
                of the tile's own eyebrow, which then reads "EXPECTED GOALS BY
                SEASO▮ OUR MODEL". At 1440 the label is far right of the
                eyebrow's end and there is no collision, so the tile keeps its
                own caption there. The label position is the primitive's
                behaviour (its iter #2 fix #5) and is not changed here. */}
            {isMobile && (
              <Eyebrow className="mb-2">Expected goals by season · our model</Eyebrow>
            )}
            <SparklineMicroChart
              data={arc.points}
              eyebrow={isMobile ? undefined : 'Expected goals by season · our model'}
              endpointValue={arc.endpoint ?? undefined}
              tooltipUnit=" xG"
              height={isMobile ? 120 : 150}
            />
          </>
        ) : (
          <div className="rounded-2xl bg-pastel-surface-tile p-5 ring-1 ring-white/10 sm:p-7">
            <Eyebrow>Expected goals by season · our model</Eyebrow>
            <p className="mt-3 text-[13px] leading-snug text-white/70">
              {arc.points.length === 1
                ? `One season on record (${seasonLabel(arc.firstSeason!)}). A line needs two points; this one gets drawn as soon as there is a second.`
                : 'No season rows on record for this player and game type.'}
            </p>
          </div>
        )}

        {xgRow && (
          <div className="mt-5 grid grid-cols-2 gap-5 rounded-2xl bg-pastel-surface-tile p-5 ring-1 ring-white/10 sm:mt-6 sm:grid-cols-4 sm:gap-6 sm:p-7">
            <StatCell label="Attempts" value={String(xgRow.shots)} sub={`${xgRow.sog} on goal`} />
            <StatCell label="Goals" value={String(xgRow.goals)} sub="measured" />
            <StatCell
              label="Expected"
              value={xgRow.xg.toFixed(2)}
              sub="our model"
              accent="butter"
            />
            <StatCell
              label="Finishing"
              value={signed(xgRow.finishing)}
              sub="goals − expected"
              accent={xgRow.finishing >= 0.5 ? 'sage' : xgRow.finishing <= -0.5 ? 'butter' : 'cream'}
            />
          </div>
        )}

        {/* TWO PIPELINES CARRY EXPECTED GOALS, AND THIS PAGE SHOWS BOTH.
            The condensed card at the top reads `x_goals` off the season-stats
            rollup that feeds `/api/players/dashboard-index`; the tile above
            reads `player_xg_season`, which is our model summed over the
            scored shot events. They are close but not identical, so a reader
            can see "10 goals on 6.1 expected" at the top of the page and
            "+3.25" here and reasonably conclude one of them is wrong.
            Neither is. Say so, and only when the gap is actually visible —
            a permanent caveat is noise, and noise is how a real caveat gets
            ignored. */}
        {xgRow && indexEntry && Math.abs((indexEntry.x_goals ?? 0) - xgRow.xg) >= 0.5 && (
          <p className="mt-3 max-w-[70ch] text-[11px] leading-snug text-white/70">
            Expected goals here are summed over this season&apos;s scored shot events (
            {xgRow.xg.toFixed(2)}). The card at the top of the page reads the season-stats rollup (
            {(indexEntry.x_goals ?? 0).toFixed(2)}) — a separate pipeline over the same shots — so
            the two finishing figures do not match. Both are our model; neither is a measurement,
            and the shot-summed figure is the one the map above is drawn from.
          </p>
        )}

        {arc.firstSeason != null && arc.lastSeason != null && (
          <div className="mt-3 font-jbmono text-[9px] font-bold uppercase tracking-[0.22em] text-white/55">
            {seasonLabel(arc.firstSeason)} – {seasonLabel(arc.lastSeason)} · {arc.points.length}{' '}
            {arc.points.length === 1 ? 'season' : 'seasons'} on record · {gameTypeLabel}
          </div>
        )}
      </section>

      {/* ── DATA ZONE — asymmetric bento ──────────────────────────── */}
      <section
        aria-label="Player breakdown"
        className="relative mx-auto mt-12 max-w-[1280px] px-4 sm:px-6 sm:mt-16"
      >
        <ChapterEyebrow chapterNumber={3} title="BREAKDOWN" className="mb-6" />

        <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[1.1fr_1fr_1.1fr] sm:gap-6">
          {showRink && summary.plotted > 0 ? (
            <ShotBreakdownTile summary={summary} modeLabel={`${seasonLabel(payload.season)} · all situations`} />
          ) : (
            <div className="flex h-full flex-col rounded-2xl bg-pastel-surface-tile p-5 ring-1 ring-white/10 sm:p-6">
              {/* Deliberately NOT the hero's sentence again. The hero says
                  WHY there is no map; this tile says what stands in for the
                  zone rows. Printing one explanation twice on one screen
                  reads as a bug even when both copies are true. */}
              <Eyebrow className="mb-3">
                {isGoalie && payload.gsax ? 'Shots faced · our model' : 'Shot breakdown'}
              </Eyebrow>
              {!(isGoalie && payload.gsax) && (
                <p className="text-[12px] leading-snug text-white/70">
                  Zone rows are read off the shot map, and there is no map for this view.
                </p>
              )}
              {isGoalie && payload.gsax && (
                <div className="grid grid-cols-2 gap-5">
                  <StatCell
                    label="Shots faced"
                    value={payload.gsax.shots_faced.toLocaleString()}
                    sub="primary only"
                  />
                  <StatCell label="Goals allowed" value={String(payload.gsax.ga)} sub="measured" />
                  <StatCell
                    label="Expected against"
                    value={payload.gsax.xga.toFixed(1)}
                    sub="our model"
                    accent="butter"
                  />
                  <StatCell
                    label="Regressed GSAx"
                    value={signed(payload.gsax.regressed_gsax, 1)}
                    sub="workload-adjusted"
                    accent={payload.gsax.regressed_gsax >= 0 ? 'sage' : 'butter'}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col items-center justify-center rounded-2xl bg-pastel-surface-tile p-5 ring-1 ring-white/10 sm:p-6">
            {rings.length > 0 ? (
              <PercentileRingCluster
                metrics={rings}
                ringSize={isMobile ? 84 : 92}
                caption={
                  isGoalie
                    ? `SV% · GAA · W vs ${placed.cohortSize} ${COHORT_NOUN[cohort]}`
                    : `OFF · DEF · ST GAR/60 vs ${placed.cohortSize} ${COHORT_NOUN[cohort]}`
                }
              />
            ) : (
              <div className="py-6 text-center">
                <Eyebrow className="mb-2">Percentile rings</Eyebrow>
                <p className="max-w-[24ch] text-[12px] leading-snug text-white/70">
                  {index.status === 'error'
                    ? 'The league payload is unavailable, so there is no cohort to rank against.'
                    : 'No GAR components on record for this player this season.'}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col">
            {shotVerdict || goalieVerdict ? (
              <VerdictTile
                size="lg"
                /* The dropcap pulls the FIRST CHARACTER out at 48px. A
                   sentence opening with a digit therefore renders "3" beside
                   "0% of his attempts…" — a number the payload does not
                   contain, in the largest type on the tile. Both derivers now
                   open with a word; this is the belt to that suspender. */
                dropcap={/^[A-Za-z]/.test((isGoalie ? goalieVerdict : shotVerdict) ?? '')}
                accent="orange"
                eyebrow={
                  isGoalie
                    ? `Read from ${payload.gsax?.shots_faced.toLocaleString() ?? 0} primary shots`
                    : `Read from ${summary.plotted} placed attempts`
                }
                body={(isGoalie ? goalieVerdict : shotVerdict) ?? ''}
                signature="Stormy · Assistant GM"
                className="h-full"
              />
            ) : (
              <div className="flex h-full flex-col justify-center rounded-2xl bg-pastel-surface-tile p-5 ring-1 ring-white/10 sm:p-6">
                <Eyebrow className="mb-2">Stormy verdict</Eyebrow>
                <p className="text-[12px] leading-snug text-white/70">
                  Not enough on record to say anything worth reading. A shot-location claim off a
                  handful of attempts is noise, so this stays empty until the sample earns a
                  sentence.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Standard percentiles — every one against a named, counted cohort. */}
        <div className="mt-5 rounded-2xl bg-pastel-surface-tile p-5 ring-1 ring-white/10 sm:mt-6 sm:p-7">
          <div className="mb-5 flex items-baseline justify-between gap-3">
            <div className="font-jbmono text-[10px] font-bold uppercase tracking-[0.22em] text-white/55 sm:text-[11px]">
              Percentiles · vs {COHORT_NOUN[cohort]}
            </div>
            <div className="font-jbmono text-[9px] font-bold uppercase tabular-nums tracking-[0.22em] text-white/55">
              {indexEntry ? `${indexEntry.gp} GP · n=${placed.cohortSize}` : 'cohort unavailable'}
            </div>
          </div>
          {placed.metrics.length > 0 ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              {placed.metrics.map((m) => (
                <PercentileBullet
                  key={m.spec.key}
                  size="sm"
                  label={m.spec.label}
                  context={m.spec.context}
                  category={m.spec.category}
                  percentile={m.percentile}
                  rawValue={m.display}
                  sampleSize={indexEntry?.gp}
                />
              ))}
            </div>
          ) : (
            <p className="text-[12px] leading-snug text-white/70">
              {index.status === 'error'
                ? 'The league payload could not be loaded, so nothing here can be ranked. Percentiles need a cohort and a cohort needs the league.'
                : 'This player is not in the current-season directory, so there is no cohort to place him in.'}
            </p>
          )}
        </div>

        {/* Provenance line. The badge renders ONLY when the payload carried a
            real timestamp — a "freshness unknown" chip is itself a claim. */}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 sm:mt-6">
          {payload.as_of ? (
            <StaleDataBadge asOf={payload.as_of} label="xG model" />
          ) : (
            <span className="font-jbmono text-[9px] font-bold uppercase tracking-[0.22em] text-white/55">
              No update timestamp on this payload
            </span>
          )}
          <span className="font-jbmono text-[9px] font-bold uppercase tracking-[0.22em] text-white/55">
            · {placed.cohortSize} {COHORT_NOUN[cohort]} benchmarked
          </span>
        </div>
      </section>

      {/* ── SHARE ZONE — the Wrapped chapter ──────────────────────── */}
      <section
        aria-label="Position vs league"
        className="relative mx-auto mt-12 max-w-[1280px] px-4 sm:px-6 sm:mt-16"
      >
        {chapter ? (
          <WrappedChapter
            chapterNumber={4}
            title="POSITION VS LEAGUE"
            subtitle={`${chapter.spec.label.toUpperCase()} · ALL ${COHORT_NOUN[cohort].toUpperCase()} · ${chapter.cohortSize} PLAYERS`}
            callout={{
              value: signed(chapter.delta, chapter.spec.key === 'svpct' ? 3 : 2),
              label: 'vs cohort median',
              support:
                chapter.percentile != null
                  ? `${ordinal(chapter.percentile)} percentile · ${chapter.cohortSize} ${COHORT_NOUN[cohort]}`
                  : undefined,
              accent: 'cream',
            }}
          >
            <KDEDistribution
              samples={chapter.samples}
              playerValue={chapter.value}
              accent="orange"
              markerValueLabel={`${(identity?.name ?? '').toUpperCase()} · ${chapter.spec.format(chapter.value)}`}
              height={isMobile ? 180 : 220}
            />
          </WrappedChapter>
        ) : (
          <WrappedChapter
            chapterNumber={4}
            title="POSITION VS LEAGUE"
            emptyText={
              index.status === 'error'
                ? 'League cohort unavailable'
                : 'Not enough of the cohort measured to draw a distribution'
            }
          />
        )}
      </section>

      <div className="mx-auto mt-12 max-w-[1280px] px-4 sm:px-6">
        <Link
          to="/players"
          className="font-jbmono text-[10px] font-bold uppercase tracking-[0.22em] text-white/70 transition-colors hover:text-pastel-orange-soft"
        >
          ← All players
        </Link>
      </div>
    </Shell>
  );
}

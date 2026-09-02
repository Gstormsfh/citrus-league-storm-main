/**
 * Preview page for the player dashboard component primitives.
 * Day 1 review surface — Web Summit launch (May 11).
 *
 * Shows every state variant of:
 * - PlayerMonogram (license-clean player avatar)
 * - PercentileBullet (the JFresh-killer; bullet chart with median tick)
 * - StaleDataBadge (first-class freshness signal)
 * - RinkHeatmap (Spatial Hero — locked Concept 3 visualization)
 *
 * Route: /preview-dashboard-primitives
 */

import { useState } from 'react';
import Navbar from '@/components/Navbar';
import {
  DarkLayout,
  HockeyFooter,
  PlayerMonogram,
  PercentileBullet,
  StaleDataBadge,
  RinkHeatmap,
  type RinkMode,
  type ShotEvent,
  PercentileRingCluster,
  type RingMetric,
  SparklineMicroChart,
  type SparklinePoint,
  VerdictTile,
  WrappedChapter,
  KDEDistribution,
} from '@/components/citrus2';

// Mock helpers — generate game dates + opponent abbreviations
const OPPONENTS = ['NYR', 'BOS', 'PIT', 'TOR', 'MTL', 'OTT', 'TBL', 'FLA', 'CAR', 'WSH', 'PHI', 'NJD', 'DET', 'BUF', 'NYI', 'CBJ', 'CHI', 'COL', 'DAL', 'EDM', 'VAN', 'CGY', 'ANA', 'LAK', 'SJS', 'STL', 'NSH', 'WPG', 'MIN', 'VGK'];

function gameDateFor(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()}`;
}

// Mock 30-day xG/60 trend data — clean (no events, just ticks demonstrating density)
const MOCK_XG_TREND: SparklinePoint[] = Array.from({ length: 30 }, (_, i) => {
  const base = 2.4 + Math.sin(i / 4.5) * 0.7 + (i / 30) * 0.5;
  return {
    x: i,
    y: Math.max(0.5, Number((base + (Math.random() - 0.5) * 0.4).toFixed(2))),
    gameDate: gameDateFor(29 - i),
    opponent: OPPONENTS[i % OPPONENTS.length],
  };
});

// Mock 30-day Goals/60 — with hat trick on day 12 (event annotation demo)
const MOCK_GOALS_TREND: SparklinePoint[] = Array.from({ length: 30 }, (_, i) => {
  const base = 1.2 + Math.sin(i / 5) * 0.5 + (i / 30) * 0.3;
  const isHatTrick = i === 12;
  return {
    x: i,
    y: isHatTrick
      ? 3.45
      : Math.max(0.2, Number((base + (Math.random() - 0.5) * 0.3).toFixed(2))),
    gameDate: gameDateFor(29 - i),
    opponent: OPPONENTS[i % OPPONENTS.length],
    event: isHatTrick ? ('hat_trick' as const) : undefined,
    eventLabel: isHatTrick ? 'Hat trick · vs PIT' : undefined,
  };
});

// Mock 30-day TOI — return-from-injury day 5
const MOCK_TOI_TREND: SparklinePoint[] = Array.from({ length: 30 }, (_, i) => {
  const isReturn = i === 5;
  const isInjured = i < 5;
  const base = 21.4 + Math.sin(i / 7) * 1.2;
  return {
    x: i,
    y: isInjured ? 0 : isReturn ? 12.4 : Number((base + (Math.random() - 0.5) * 1.6).toFixed(1)),
    gameDate: gameDateFor(29 - i),
    opponent: OPPONENTS[i % OPPONENTS.length],
    event: isReturn ? ('return_from_injury' as const) : undefined,
    eventLabel: isReturn ? 'Return from IR' : undefined,
  };
});

// Mock projection — confidence band, no events (projections shouldn't carry past events)
const MOCK_PROJECTION: SparklinePoint[] = Array.from({ length: 20 }, (_, i) => {
  const y = 1.4 + Math.sin(i / 3) * 0.4 + i * 0.04;
  return {
    x: i,
    y: Number(y.toFixed(2)),
    high: Number((y + 0.5 + (i / 20) * 0.4).toFixed(2)),
    low: Number((y - 0.4 - (i / 20) * 0.3).toFixed(2)),
    gameDate: gameDateFor(19 - i),
    opponent: OPPONENTS[i % OPPONENTS.length],
  };
});

// Mock GAR percentiles for the ring cluster
const MOCK_RINGS: RingMetric[] = [
  { category: 'defense', label: 'OFF', percentile: 84, sampleSize: 71 },
  { category: 'special', label: 'DEF', percentile: 62, sampleSize: 71 },
  { category: 'offense', label: 'ST', percentile: 91, sampleSize: 71 },
];

// Mock GAR sample distribution for KDEDistribution — gaussian-ish around 0
// with a long right tail to simulate the league of all centers.
const MOCK_CENTER_GAR_SAMPLES: number[] = (() => {
  const out: number[] = [];
  const seedRand = (i: number) => {
    const x = Math.sin(i * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 906; i++) {
    // Box-Muller for a gaussian sample
    const u1 = Math.max(seedRand(i * 2 + 1), 1e-6);
    const u2 = seedRand(i * 2 + 2);
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    // mean ~0, sd ~1, skew slightly right
    const v = z * 1 + (z > 0.8 ? 0.7 : 0);
    out.push(Number(v.toFixed(3)));
  }
  return out;
})();

const MOCK_RINGS_LOW_SAMPLE: RingMetric[] = [
  { category: 'defense', label: 'OFF', percentile: 78, sampleSize: 8 },
  { category: 'special', label: 'DEF', percentile: 54, sampleSize: 8 },
  { category: 'offense', label: 'ST', percentile: 88, sampleSize: 8 },
];

// ── Mock shot data — slot-concentrated NHL distribution ──
// Visual diff iteration #3: distribution rebalanced. Mockup shows nearly
// all dots concentrated in upper-half (slot + faceoff). Lower-half stays
// near-empty because the identity composition (jersey watermark + name)
// takes ownership of that space. Drastically cut points/boards from
// 16+24=40 down to 6+4=10 — sparse hint, not cluttered scatter.
function jitter(center: number, spread: number): number {
  const u = Math.random() + 0.0001;
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, Math.min(1, center + z * spread));
}

const MOCK_SHOTS: ShotEvent[] = [
  // SLOT cluster — dense orange heatmap (60 dots, tight gaussian)
  ...Array.from({ length: 60 }, (_, i) => ({
    id: `slot-${i}`,
    x: jitter(0.50, 0.05),
    y: jitter(0.84, 0.04),
    xg_value: 0.18 + Math.random() * 0.14,
    is_goal: i % 5 === 0,
  })),
  // HIGH SLOT — orange/butter mix above the slot (35 dots)
  ...Array.from({ length: 35 }, (_, i) => ({
    id: `highslot-${i}`,
    x: jitter(0.50, 0.08),
    y: jitter(0.74, 0.04),
    xg_value: 0.10 + Math.random() * 0.10,
    is_goal: i % 9 === 0,
  })),
  // LOW SLOT — close to crease, very high xG (22 dots)
  ...Array.from({ length: 22 }, (_, i) => ({
    id: `lowslot-${i}`,
    x: jitter(0.50, 0.04),
    y: jitter(0.93, 0.03),
    xg_value: 0.22 + Math.random() * 0.20,
    is_goal: i % 3 === 0,
  })),
  // LEFT FACEOFF area — moderate density (24 dots, tight to circle)
  ...Array.from({ length: 24 }, (_, i) => ({
    id: `lcircle-${i}`,
    x: jitter(0.30, 0.06),
    y: jitter(0.64, 0.07),
    xg_value: 0.04 + Math.random() * 0.08,
    is_goal: i % 12 === 0,
  })),
  // RIGHT FACEOFF area — moderate density (24 dots, tight to circle)
  ...Array.from({ length: 24 }, (_, i) => ({
    id: `rcircle-${i}`,
    x: jitter(0.70, 0.06),
    y: jitter(0.64, 0.07),
    xg_value: 0.04 + Math.random() * 0.08,
    is_goal: i % 12 === 0,
  })),
  // POINTS — sparse hint (6 dots only, NOT a cluttered scatter)
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `point-${i}`,
    x: 0.20 + Math.random() * 0.60,
    y: 0.08 + Math.random() * 0.10,
    xg_value: 0.02 + Math.random() * 0.04,
    is_goal: false,
  })),
  // BOARDS — sparse hint along the upper edges (4 dots only)
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `boards-${i}`,
    x: i % 2 === 0 ? 0.06 : 0.92,
    y: 0.45 + Math.random() * 0.30,
    xg_value: 0.02 + Math.random() * 0.04,
    is_goal: false,
  })),
];

// Smaller mock for low-sample state demo
const MOCK_LOW_SAMPLE: ShotEvent[] = [
  { id: 1, x: 0.50, y: 0.85, xg_value: 0.18, is_goal: true },
  { id: 2, x: 0.46, y: 0.82, xg_value: 0.12, is_goal: false },
  { id: 3, x: 0.54, y: 0.88, xg_value: 0.22, is_goal: true },
  { id: 4, x: 0.30, y: 0.65, xg_value: 0.05, is_goal: false },
  { id: 5, x: 0.70, y: 0.62, xg_value: 0.07, is_goal: false },
  { id: 6, x: 0.50, y: 0.10, xg_value: 0.02, is_goal: false },
];

// Helper for variant captions
function VariantCard({
  caption,
  children,
  className = '',
}: {
  caption: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-start gap-3 p-4 rounded-xl bg-pastel-surface-tile ring-1 ring-white/10 ${className}`}
    >
      <div className="flex items-center min-h-[80px] w-full">{children}</div>
      <div className="font-jbmono text-[10px] uppercase tracking-[0.22em] text-white/55 font-bold">
        {caption}
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  blurb,
}: {
  eyebrow: string;
  title: string;
  blurb?: string;
}) {
  return (
    <div className="mb-6 mt-12 first:mt-0">
      <div className="font-jbmono text-[11px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold">
        ✦ {eyebrow}
      </div>
      <h2 className="font-sans font-black text-[1.5rem] sm:text-[1.75rem] tracking-[-0.02em] text-pastel-cream leading-tight">
        {title}
      </h2>
      {blurb && <p className="text-[13px] text-white/65 mt-2 max-w-2xl">{blurb}</p>}
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h3 className="font-sans font-bold text-[14px] text-pastel-cream uppercase tracking-wider mb-4">
        {title}
      </h3>
      {children}
    </section>
  );
}

// ── Mock data ────────────────────────────────────────────────────────
const TODAY = new Date();
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const MCDAVID = { fullName: 'Connor McDavid', team: 'EDM', jersey: 97 };
const PASTRNAK = { fullName: 'David Pastrnak', team: 'BOS', jersey: 88 };
const RINNE = { fullName: 'Pekka Rinne', team: 'NSH', jersey: 35 };
const NO_TEAM = { fullName: 'Free Agent Player', team: undefined, jersey: undefined };
const HUGHES = { fullName: 'Quinn Hughes', team: 'VAN', jersey: 43 };
const SHESTERKIN = { fullName: 'Igor Shesterkin', team: 'NYR', jersey: 31 };

export default function PreviewDashboardPrimitives() {
  const [rinkMode, setRinkMode] = useState<RinkMode>('5v5');

  return (
    <DarkLayout>
      <Navbar />

      <main className="relative max-w-[1280px] mx-auto px-6 pt-24 pb-16">
        {/* Page header */}
        <div className="mb-10">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold">
            ✦ Day 2 Review · 2026-05-04
          </div>
          <h1 className="font-sans font-black text-[2rem] sm:text-[2.5rem] tracking-[-0.025em] text-pastel-cream leading-tight">
            Player Dashboard Component Primitives
          </h1>
          <p className="text-[14px] text-white/65 mt-3 max-w-3xl">
            Every state variant of the primitives that ship the Web Summit player profile page
            (May 11). Built citrus2-native. Dark forest surfaces, JBMono tabular numerics, no
            third-party UI libraries, full keyboard + screen-reader support. Locked design
            direction: <strong className="text-pastel-orange-soft">Spatial Hero (Concept 3)</strong>.
          </p>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* RinkHeatmap — THE locked Spatial Hero composition          */}
        {/* ────────────────────────────────────────────────────────── */}
        <SectionHeader
          eyebrow="Locked hero · Concept 3"
          title="RinkHeatmap"
          blurb="The Spatial Hero: full-bleed offensive-zone rink as the visual anchor, with shot density encoded by xG (color) and attempts (size). Player identity composed AT the rink (jersey watermark + name + eyebrow). Floating Stormy verdict tile top-right. Segmented mode control bottom-right carries the SINGLE page-wide ambient orange glow on the active option."
        />

        <SubSection title="Composed hero: full Concept 3 treatment">
          <RinkHeatmap
            shots={MOCK_SHOTS}
            mode={rinkMode}
            onModeChange={setRinkMode}
            playerName="A. PRIMA"
            eyebrow="C · ROYAL BLUES · 28YR"
            jerseyNumber={97}
            verdict="Generates 73% of his offense from the high slot. Top-3 in NHL for danger-zone xG."
            verdictEyebrow="Stormy verdict"
            caption={`5v5 shots · ${MOCK_SHOTS.length} attempts · ${MOCK_SHOTS.filter((s) => s.is_goal).length} goals`}
          />
        </SubSection>

        <SubSection title="States: clean rink only (identity composition demoed in the hero above)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VariantCard caption="Loading state">
              <div className="w-full">
                <RinkHeatmap shots={[]} isLoading caption="Loading…" />
              </div>
            </VariantCard>
            <VariantCard caption="Empty state: no shots in this mode">
              <div className="w-full">
                <RinkHeatmap shots={[]} mode="pp" caption="No PP shots yet this season" />
              </div>
            </VariantCard>
            <VariantCard caption="Low-sample state: overlay caption + muted dots">
              <div className="w-full">
                <RinkHeatmap
                  shots={MOCK_LOW_SAMPLE}
                  caption="Limited sample"
                />
              </div>
            </VariantCard>
            <VariantCard caption="Mode switching: change segmented control">
              <div className="w-full">
                <RinkHeatmap shots={MOCK_SHOTS.slice(0, 80)} mode="pp" onModeChange={() => {}} caption="80 attempts · PP only" />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        {/* ────────────────────────────────────────────────────────── */}
        {/* PercentileRingCluster — component-scale rings (data zone)  */}
        {/* ────────────────────────────────────────────────────────── */}
        <SectionHeader
          eyebrow="Data zone · Component 2 of 7"
          title="PercentileRingCluster"
          blurb="Three independent ring gauges stacked vertically. One per metric category (OFF / DEF / ST). Component-scale only, never the hero. Adapts the Vercel Gauge math (gap-percent, primary/secondary stroke pair, animated stroke-dashoffset) into a single SVG-per-ring composition with category-tinted fills."
        />

        <SubSection title="Default vertical stack: the data-zone treatment">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <VariantCard caption="Vertical 80px (data-zone default)">
              <div className="w-full flex justify-center">
                <PercentileRingCluster
                  metrics={MOCK_RINGS}
                  caption="OFF · DEF · ST GAR"
                />
              </div>
            </VariantCard>
            <VariantCard caption="Vertical larger 120px">
              <div className="w-full flex justify-center">
                <PercentileRingCluster
                  metrics={MOCK_RINGS}
                  ringSize={120}
                  caption="OFF · DEF · ST GAR"
                />
              </div>
            </VariantCard>
            <VariantCard caption="Vertical compact 60px">
              <div className="w-full flex justify-center">
                <PercentileRingCluster
                  metrics={MOCK_RINGS}
                  ringSize={60}
                  caption="OFF · DEF · ST"
                />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="States">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <VariantCard caption="Loading skeleton">
              <div className="w-full flex justify-center">
                <PercentileRingCluster
                  metrics={MOCK_RINGS}
                  isLoading
                  caption="Loading…"
                />
              </div>
            </VariantCard>
            <VariantCard caption="Low sample: muted treatment + value opacity">
              <div className="w-full flex justify-center">
                <PercentileRingCluster
                  metrics={MOCK_RINGS_LOW_SAMPLE}
                  caption="Limited · 8 GP"
                />
              </div>
            </VariantCard>
            <VariantCard caption="Horizontal layout (alternative)">
              <div className="w-full flex justify-center">
                <PercentileRingCluster
                  metrics={MOCK_RINGS}
                  layout="horizontal"
                  ringSize={70}
                  caption="OFF · DEF · ST"
                />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        {/* ────────────────────────────────────────────────────────── */}
        {/* SparklineMicroChart — minimal trend (data zone wide tile)  */}
        {/* ────────────────────────────────────────────────────────── */}
        <SectionHeader
          eyebrow="Data zone · Component 3 of 7"
          title="SparklineMicroChart"
          blurb="The wide trend tile beneath the rink hero. Subtraction-as-design. What survives the canvas-design-system Second Pass discipline: line, endpoint accent dot, value, eyebrow caption. No axes, no grid, no decoration. Endpoint value at the right edge in JBMono is the data's punctuation."
        />

        <SubSection title="Default: full data-zone width treatment">
          <div className="w-full">
            <SparklineMicroChart
              data={MOCK_XG_TREND}
              eyebrow="Last 30 days · xG/60"
              endpointUnit="/60"
            />
          </div>
        </SubSection>

        <SubSection title="Variants: game ticks + event markers + inline annotation (iter #3)">
          <div className="space-y-7">
            <SparklineMicroChart
              data={MOCK_GOALS_TREND}
              eyebrow="Last 30 days · Goals/60 (with hat trick event)"
              endpointUnit="/60"
              accent="orange"
              lineColor="orange"
              tooltipUnit="/60"
            />
            <SparklineMicroChart
              data={MOCK_TOI_TREND}
              eyebrow="Last 30 days · TOI/G (with IR return event)"
              endpointUnit="m"
              accent="butter"
              lineColor="butter"
              tooltipUnit="m"
            />
            <SparklineMicroChart
              data={MOCK_PROJECTION}
              eyebrow="ROS Projection · xG/60 with 90% CI"
              endpointUnit="/60"
              accent="orange"
              lineColor="sage"
              showConfidenceBand
              tooltipUnit="/60"
            />
          </div>
        </SubSection>

        <SubSection title="States">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VariantCard caption="Loading state: shimmer line">
              <div className="w-full">
                <SparklineMicroChart
                  data={MOCK_XG_TREND}
                  eyebrow="Last 30 days · xG/60"
                  isLoading
                />
              </div>
            </VariantCard>
            <VariantCard caption="Empty state: no data yet">
              <div className="w-full">
                <SparklineMicroChart
                  data={[]}
                  eyebrow="Last 30 days · xG/60"
                  emptyText="Player hasn't logged any games this season"
                />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        {/* ────────────────────────────────────────────────────────── */}
        {/* VerdictTile — editorial Stormy verdict primitive            */}
        {/* ────────────────────────────────────────────────────────── */}
        <SectionHeader
          eyebrow="Editorial · Component 4 of 7"
          title="VerdictTile"
          blurb="The Stormy verdict primitive. Italic editorial body in pastel accent, JBMono caps eyebrow, optional dropcap and signature. Two surfaces: floating (backdrop-blur overlay for the rink hero) and embedded (solid tile for the data-zone right column). The rare exception where prose is allowed on a data surface; treated as visual element via italic + accent + framed architecture."
        />

        <SubSection title="Default: embedded variant, no signature">
          <div className="max-w-md">
            <VerdictTile
              body="Elite finisher when shooting from the slot; xG conversion sits 31% above league baseline over the last 200 attempts."
            />
          </div>
        </SubSection>

        <SubSection title="Variants: floating (rink hero) vs embedded (data zone)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VariantCard caption="floating · backdrop-blur overlay (matches rink hero)">
              <div className="relative w-full min-h-[200px] rounded-xl bg-gradient-to-br from-pastel-orange/15 via-pastel-surface-tile to-pastel-sage/10 p-6 flex items-start justify-end ring-1 ring-white/5">
                <div className="w-[320px]">
                  <VerdictTile
                    variant="floating"
                    body="Elite slot generator: 73% of his xG comes from inside the home plate, top decile in the league."
                    accent="orange"
                  />
                </div>
              </div>
            </VariantCard>
            <VariantCard caption="embedded · solid tile (data-zone right column)">
              <div className="w-full">
                <VerdictTile
                  variant="embedded"
                  body="Elite slot generator: 73% of his xG comes from inside the home plate, top decile in the league."
                  signature="Stormy · Assistant GM"
                />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Sizes: sm / md / lg">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            <VariantCard caption="sm · 13px body · table inserts, sub-tile">
              <div className="w-full">
                <VerdictTile
                  size="sm"
                  body="Sample too small to bet the farm: 11 GP this season."
                  signature="Stormy"
                />
              </div>
            </VariantCard>
            <VariantCard caption="md · 14-15px body · default surface">
              <div className="w-full">
                <VerdictTile
                  size="md"
                  body="Pace stays elite even in defensive minutes; finishing variance the only knock."
                  signature="Stormy · Assistant GM"
                />
              </div>
            </VariantCard>
            <VariantCard caption="lg · 15-16px body · standalone editorial card">
              <div className="w-full">
                <VerdictTile
                  size="lg"
                  body="Elite finisher whose underlying xG model overrates volume but underrates his shot selection."
                  signature="Stormy · Assistant GM"
                />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Accents: orange / sage / butter / cream">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VariantCard caption="orange · finishing / offense">
              <div className="w-full">
                <VerdictTile
                  body="Elite slot finisher: top decile in inside xG/60 over the last 30 games."
                  accent="orange"
                />
              </div>
            </VariantCard>
            <VariantCard caption="sage · defense / steady">
              <div className="w-full">
                <VerdictTile
                  body="Steady possession driver; nothing flashy, but the underlying numbers are elite."
                  accent="sage"
                />
              </div>
            </VariantCard>
            <VariantCard caption="butter · special teams / context">
              <div className="w-full">
                <VerdictTile
                  body="The PP1 trigger: 9.8 xGF/60 with him on the ice, league-leading among RW units."
                  accent="butter"
                />
              </div>
            </VariantCard>
            <VariantCard caption="cream · neutral / informational">
              <div className="w-full">
                <VerdictTile
                  body="Workhorse minutes; usage trending up since the trade deadline."
                  accent="cream"
                />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Editorial: dropcap on first letter (lg, embedded right column)">
          <div className="max-w-md">
            <VerdictTile
              size="lg"
              dropcap
              body="Elite finisher whose model overrates raw volume but underrates his shot selection. Bet the underlying skill, fade the variance."
              signature="Stormy · Assistant GM"
            />
          </div>
        </SubSection>

        <SubSection title="States: loading + long-text overflow">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <VariantCard caption="Loading skeleton: eyebrow + body + signature shimmer">
              <div className="w-full">
                <VerdictTile
                  body=""
                  signature="Stormy · Assistant GM"
                  isLoading
                />
              </div>
            </VariantCard>
            <VariantCard caption="Long-text overflow: wraps without truncation">
              <div className="w-full">
                <VerdictTile
                  body="Elite slot generator who consistently posts top-decile inside xG/60 numbers, even after adjusting for usage and teammate quality; the only meaningful concern is finishing variance over short samples. Over a full season he projects as a 35-goal floor with a 50-goal ceiling, and the underlying shot quality data says the ceiling is the more honest read."
                  signature="Stormy · Assistant GM"
                />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        {/* ────────────────────────────────────────────────────────── */}
        {/* WrappedChapter — full-bleed editorial chapter container     */}
        {/* ────────────────────────────────────────────────────────── */}
        <SectionHeader
          eyebrow="Share zone · Component 5 of 7"
          title="WrappedChapter"
          blurb="The screenshot-shareable chapter container. Spotify Wrapped's 'one massive number per slide' applied to a player profile section. Each chapter is OG-image-ready (1200×630) and reads as a standalone hockey story. Children-based composition: the chrome (eyebrow divider, callout column, subtitle caption) is universal; the visualization slot is variable per chapter type. KDEDistribution included as the Web Summit launch chapter visualization."
        />

        <SubSection title="Default: POSITION VS LEAGUE chapter (the canonical Web Summit launch chapter)">
          <div className="rounded-2xl bg-pastel-surface-tile/40 ring-1 ring-white/5 px-6 sm:px-10">
            <WrappedChapter
              chapterNumber={1}
              title="POSITION VS LEAGUE"
              subtitle="OFFENSIVE GAR · ALL CENTERS · 906 PLAYERS"
              callout={{
                value: '+4.21',
                label: 'vs league avg',
                support: 'Top 1% · 9 of 906',
                accent: 'cream',
              }}
            >
              <KDEDistribution
                samples={MOCK_CENTER_GAR_SAMPLES}
                playerValue={4.21}
                accent="orange"
                markerValueLabel="MCDAVID · +4.21"
              />
            </WrappedChapter>
          </div>
        </SubSection>

        <SubSection title="Variant: share (extra padding, optimized for clean OG screenshot crop)">
          <div className="rounded-2xl bg-pastel-surface-tile/40 ring-1 ring-white/5 px-6 sm:px-10">
            <WrappedChapter
              chapterNumber={1}
              title="POSITION VS LEAGUE"
              subtitle="OFFENSIVE GAR · ALL CENTERS · 906 PLAYERS"
              variant="share"
              callout={{
                value: '+4.21',
                label: 'vs league avg',
                support: 'Top 1% · 9 of 906',
                accent: 'cream',
              }}
            >
              <KDEDistribution
                samples={MOCK_CENTER_GAR_SAMPLES}
                playerValue={4.21}
                accent="orange"
                markerValueLabel="MCDAVID · +4.21"
              />
            </WrappedChapter>
          </div>
        </SubSection>

        <SubSection title="Accent variants: orange / sage / butter / cream callout">
          <div className="space-y-6">
            <div className="rounded-2xl bg-pastel-surface-tile/40 ring-1 ring-white/5 px-6 sm:px-10">
              <WrappedChapter
                chapterNumber={2}
                title="WHERE HE SHOOTS LIVE"
                subtitle="SHOT QUALITY · 5v5 · 188 ATTEMPTS"
                callout={{
                  value: '0.342',
                  label: 'avg xG per shot',
                  support: 'Top 3% in slot xG share',
                  accent: 'orange',
                }}
              >
                <KDEDistribution
                  samples={MOCK_CENTER_GAR_SAMPLES}
                  playerValue={2.8}
                  accent="orange"
                  markerValueLabel="0.342 xG/shot"
                />
              </WrappedChapter>
            </div>
            <div className="rounded-2xl bg-pastel-surface-tile/40 ring-1 ring-white/5 px-6 sm:px-10">
              <WrappedChapter
                chapterNumber={3}
                title="DEFENSIVE WORKLOAD"
                subtitle="DEFENSIVE GAR · ALL CENTERS · 906 PLAYERS"
                callout={{
                  value: '+1.84',
                  label: 'vs league avg',
                  support: 'Top 14% · 127 of 906',
                  accent: 'sage',
                }}
              >
                <KDEDistribution
                  samples={MOCK_CENTER_GAR_SAMPLES}
                  playerValue={1.84}
                  accent="sage"
                  markerValueLabel="+1.84"
                />
              </WrappedChapter>
            </div>
            <div className="rounded-2xl bg-pastel-surface-tile/40 ring-1 ring-white/5 px-6 sm:px-10">
              <WrappedChapter
                chapterNumber={4}
                title="POWERPLAY IMPACT"
                subtitle="PP1 xGF/60 · ALL CENTERS · 906 PLAYERS"
                callout={{
                  value: '9.82',
                  label: 'PP1 xGF/60',
                  support: 'League leader',
                  accent: 'butter',
                }}
              >
                <KDEDistribution
                  samples={MOCK_CENTER_GAR_SAMPLES}
                  playerValue={3.6}
                  accent="butter"
                  markerValueLabel="9.82"
                />
              </WrappedChapter>
            </div>
          </div>
        </SubSection>

        <SubSection title="States: loading + empty">
          <div className="space-y-6">
            <div className="rounded-2xl bg-pastel-surface-tile/40 ring-1 ring-white/5 px-6 sm:px-10">
              <WrappedChapter
                chapterNumber={1}
                title="POSITION VS LEAGUE"
                subtitle="Loading…"
                isLoading
              />
            </div>
            <div className="rounded-2xl bg-pastel-surface-tile/40 ring-1 ring-white/5 px-6 sm:px-10">
              <WrappedChapter
                chapterNumber={1}
                title="POSITION VS LEAGUE"
                subtitle="OFFENSIVE GAR · ALL CENTERS · 906 PLAYERS"
                emptyText="Not enough games played to chart this season"
              />
            </div>
          </div>
        </SubSection>

        <SubSection title="KDEDistribution standalone: accent + marker label combinations">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VariantCard caption="orange · player deep in right tail (+4.21)">
              <div className="w-full">
                <KDEDistribution
                  samples={MOCK_CENTER_GAR_SAMPLES}
                  playerValue={4.21}
                  accent="orange"
                  height={180}
                  markerValueLabel="+4.21"
                />
              </div>
            </VariantCard>
            <VariantCard caption="sage · player at median">
              <div className="w-full">
                <KDEDistribution
                  samples={MOCK_CENTER_GAR_SAMPLES}
                  playerValue={0}
                  accent="sage"
                  height={180}
                  markerValueLabel="MEDIAN"
                />
              </div>
            </VariantCard>
            <VariantCard caption="butter · player in left tail (-2.5)">
              <div className="w-full">
                <KDEDistribution
                  samples={MOCK_CENTER_GAR_SAMPLES}
                  playerValue={-2.5}
                  accent="butter"
                  height={180}
                  markerValueLabel="-2.50"
                />
              </div>
            </VariantCard>
            <VariantCard caption="cream · no gridlines, minimal chart chrome">
              <div className="w-full">
                <KDEDistribution
                  samples={MOCK_CENTER_GAR_SAMPLES}
                  playerValue={1.5}
                  accent="cream"
                  height={180}
                  showGridlines={false}
                  markerValueLabel="+1.50"
                />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        {/* ────────────────────────────────────────────────────────── */}
        {/* PlayerMonogram                                              */}
        {/* ────────────────────────────────────────────────────────── */}
        <SectionHeader
          eyebrow="Primitive 1 of 3"
          title="PlayerMonogram"
          blurb="License-clean stand-in for an NHL headshot. Initials in cream over team primary color, jersey number badge bottom-right. Squared (not round) so it differentiates from TeamChip. Chip = team, monogram = player. Drop-in replacement everywhere we'd want a photo but legally can't."
        />

        <SubSection title="Sizes: xs / sm / md / lg / xl">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <VariantCard caption="xs · 28px · table cells">
              <PlayerMonogram size="xs" {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
            <VariantCard caption="sm · 40px · list rows">
              <PlayerMonogram size="sm" {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
            <VariantCard caption="md · 56px · cards">
              <PlayerMonogram size="md" {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
            <VariantCard caption="lg · 80px · sub-hero">
              <PlayerMonogram size="lg" {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
            <VariantCard caption="xl · 112px · player hero">
              <PlayerMonogram size="xl" {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="States">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <VariantCard caption="Default">
              <PlayerMonogram size="md" {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
            <VariantCard caption="Highlighted (selected in compare)">
              <PlayerMonogram size="md" isHighlighted {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
            <VariantCard caption="Low sample (<20 GP)">
              <PlayerMonogram size="md" isLowSample {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
            <VariantCard caption="Loading skeleton">
              <PlayerMonogram size="md" isLoading {...MCDAVID} />
            </VariantCard>
            <VariantCard caption="Interactive (hover lift)">
              <PlayerMonogram size="md" interactive {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Edge cases">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <VariantCard caption="One-name player → first 2 chars">
              <PlayerMonogram size="md" {...RINNE} teamAbbrev={RINNE.team} jerseyNumber={RINNE.jersey} />
            </VariantCard>
            <VariantCard caption="No team → forest-soft fallback">
              <PlayerMonogram size="md" {...NO_TEAM} teamAbbrev={NO_TEAM.team} jerseyNumber={NO_TEAM.jersey} />
            </VariantCard>
            <VariantCard caption="No jersey number → no badge">
              <PlayerMonogram size="md" fullName="Connor McDavid" teamAbbrev="EDM" />
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Team color contrast palette, md size">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <VariantCard caption="EDM · royal navy (light text)">
              <PlayerMonogram size="md" {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
            </VariantCard>
            <VariantCard caption="BOS · gold (dark contrast test)">
              <PlayerMonogram size="md" {...PASTRNAK} teamAbbrev={PASTRNAK.team} jerseyNumber={PASTRNAK.jersey} />
            </VariantCard>
            <VariantCard caption="VAN · royal blue">
              <PlayerMonogram size="md" {...HUGHES} teamAbbrev={HUGHES.team} jerseyNumber={HUGHES.jersey} />
            </VariantCard>
            <VariantCard caption="NYR · navy + red mix">
              <PlayerMonogram size="md" {...SHESTERKIN} teamAbbrev={SHESTERKIN.team} jerseyNumber={SHESTERKIN.jersey} />
            </VariantCard>
          </div>
        </SubSection>

        {/* ────────────────────────────────────────────────────────── */}
        {/* PercentileBullet                                            */}
        {/* ────────────────────────────────────────────────────────── */}
        <SectionHeader
          eyebrow="Primitive 2 of 3"
          title="PercentileBullet"
          blurb="The JFresh-killer. Bullet chart with median reference, category-tinted fill, pattern overlay at low percentiles for color-not-only accessibility, tabular-numerics readout. Replaces JFresh's flat horizontal bars with something that doesn't look academic."
        />

        <SubSection title="4 categories at the same percentile (87th), compare tints">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VariantCard caption="offense · pastel-orange">
              <div className="w-full">
                <PercentileBullet label="xG/60" context="5v5" percentile={87} rawValue={3.42} rawUnit="/60" sampleSize={68} category="offense" />
              </div>
            </VariantCard>
            <VariantCard caption="defense · pastel-sage">
              <div className="w-full">
                <PercentileBullet label="EVD GAR" context="5v5" percentile={87} rawValue={2.18} rawUnit="/60" sampleSize={68} category="defense" />
              </div>
            </VariantCard>
            <VariantCard caption="special · pastel-butter">
              <div className="w-full">
                <PercentileBullet label="PP1 xGF/60" context="PP" percentile={87} rawValue={9.82} rawUnit="/60" sampleSize={68} category="special" />
              </div>
            </VariantCard>
            <VariantCard caption="neutral · pastel-cream">
              <div className="w-full">
                <PercentileBullet label="Games Played" percentile={87} rawValue={68} sampleSize={68} category="neutral" />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Percentile spectrum: fill behavior across the range">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VariantCard caption="98th: top decile · ambient glow">
              <div className="w-full">
                <PercentileBullet label="Goals/60" context="5v5" percentile={98} rawValue={1.42} rawUnit="/60" sampleSize={68} category="offense" />
              </div>
            </VariantCard>
            <VariantCard caption="65th: above median">
              <div className="w-full">
                <PercentileBullet label="Goals/60" context="5v5" percentile={65} rawValue={0.82} rawUnit="/60" sampleSize={68} category="offense" />
              </div>
            </VariantCard>
            <VariantCard caption="50th: exactly at median">
              <div className="w-full">
                <PercentileBullet label="Goals/60" context="5v5" percentile={50} rawValue={0.61} rawUnit="/60" sampleSize={68} category="offense" />
              </div>
            </VariantCard>
            <VariantCard caption="32nd: below median, no pattern">
              <div className="w-full">
                <PercentileBullet label="Goals/60" context="5v5" percentile={32} rawValue={0.41} rawUnit="/60" sampleSize={68} category="offense" />
              </div>
            </VariantCard>
            <VariantCard caption="18th: far-low · diagonal stripe pattern" className="md:col-span-2">
              <div className="w-full">
                <PercentileBullet label="Goals/60" context="5v5" percentile={18} rawValue={0.22} rawUnit="/60" sampleSize={68} category="offense" />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Special states">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VariantCard caption="No data: empty track + caption">
              <div className="w-full">
                <PercentileBullet label="xGA/60" context="5v5" percentile={null} category="defense" />
              </div>
            </VariantCard>
            <VariantCard caption="Low sample: 50% opacity + SS badge">
              <div className="w-full">
                <PercentileBullet label="xG/60" context="5v5" percentile={73} rawValue={2.91} rawUnit="/60" sampleSize={11} category="offense" />
              </div>
            </VariantCard>
            <VariantCard caption="Loading skeleton">
              <div className="w-full">
                <PercentileBullet label="loading" percentile={50} isLoading />
              </div>
            </VariantCard>
            <VariantCard caption="Compact mode: label + bar only">
              <div className="w-full">
                <PercentileBullet label="EVO GAR" percentile={87} rawValue={2.18} category="defense" compact />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Sizes: sm vs md">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VariantCard caption="sm · no floor scale · for stacks of 8+">
              <div className="w-full space-y-2">
                <PercentileBullet size="sm" label="xG/60" percentile={87} rawValue={3.42} rawUnit="/60" sampleSize={68} category="offense" />
                <PercentileBullet size="sm" label="EVD" percentile={42} rawValue={2.18} rawUnit="/60" sampleSize={68} category="defense" />
                <PercentileBullet size="sm" label="PP" percentile={91} rawValue={9.82} rawUnit="/60" sampleSize={68} category="special" />
              </div>
            </VariantCard>
            <VariantCard caption="md · with floor scale · for hero breakdowns">
              <div className="w-full">
                <PercentileBullet size="md" label="xG/60" percentile={87} rawValue={3.42} rawUnit="/60" sampleSize={68} category="offense" />
              </div>
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Full statistical breakdown: stacked vertical layout">
          <div className="max-w-md p-5 rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10">
            <div className="flex items-center gap-3 mb-5">
              <PlayerMonogram size="md" {...MCDAVID} teamAbbrev={MCDAVID.team} jerseyNumber={MCDAVID.jersey} />
              <div>
                <div className="font-sans font-bold text-pastel-cream text-[15px]">Connor McDavid</div>
                <div className="font-jbmono text-[10px] uppercase tracking-wider text-white/55">C · EDM · 5v5</div>
              </div>
            </div>
            <div className="space-y-3">
              <PercentileBullet size="sm" label="EVO GAR" context="off" percentile={99} rawValue={4.21} rawUnit="/60" sampleSize={71} category="offense" />
              <PercentileBullet size="sm" label="EVD GAR" context="def" percentile={48} rawValue={0.12} rawUnit="/60" sampleSize={71} category="defense" />
              <PercentileBullet size="sm" label="PPO GAR" context="PP" percentile={94} rawValue={3.18} rawUnit="/60" sampleSize={71} category="special" />
              <PercentileBullet size="sm" label="PEN GAR" context="net" percentile={62} rawValue={0.41} rawUnit="/60" sampleSize={71} category="neutral" />
              <PercentileBullet size="sm" label="GP" percentile={88} rawValue={71} sampleSize={71} category="neutral" />
            </div>
          </div>
        </SubSection>

        {/* ────────────────────────────────────────────────────────── */}
        {/* StaleDataBadge                                              */}
        {/* ────────────────────────────────────────────────────────── */}
        <SectionHeader
          eyebrow="Primitive 3 of 3"
          title="StaleDataBadge"
          blurb="First-class freshness signal. We display this everywhere a card or section is showing data that hasn't refreshed in 14+ days. Auto-computes severity from days-since-update. Warning (14-30d) → alert (30-84d) → critical (84d+)."
        />

        <SubSection title="Inline chip: three severity tiers">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <VariantCard caption="Warning · 17d (player_directory pattern)">
              <StaleDataBadge asOf={daysAgo(17)} />
            </VariantCard>
            <VariantCard caption="Alert · 45d (between thresholds)">
              <StaleDataBadge asOf={daysAgo(45)} />
            </VariantCard>
            <VariantCard caption="Critical · 137d (goalie_gar pattern)">
              <StaleDataBadge asOf={daysAgo(137)} />
            </VariantCard>
          </div>
        </SubSection>

        <SubSection title="Block banner: for full sections">
          <div className="space-y-3 max-w-2xl">
            <StaleDataBadge variant="block" asOf={daysAgo(17)} label="Player directory" />
            <StaleDataBadge variant="block" asOf={daysAgo(45)} label="ROS projections" />
            <StaleDataBadge variant="block" asOf={daysAgo(137)} label="Goalie GAR model" />
            <StaleDataBadge variant="block" asOf={null} label="Pipeline status" />
          </div>
        </SubSection>

        <SubSection title="Hidden state: fresh data renders nothing">
          <VariantCard caption="2d old data → no badge rendered (verify by inspecting the empty card below)">
            <div className="text-white/55 font-jbmono text-[10px] uppercase tracking-wider">
              <StaleDataBadge asOf={daysAgo(2)} />
              <span>(nothing should render before this caption)</span>
            </div>
          </VariantCard>
        </SubSection>

        <SubSection title="Custom threshold: daily-projected stats want 7-day threshold">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <VariantCard caption="Default 14d threshold · 7d data is fresh">
              <StaleDataBadge asOf={daysAgo(7)} />
              <span className="text-white/55 font-jbmono text-[10px] uppercase tracking-wider ml-2">
                (no badge)
              </span>
            </VariantCard>
            <VariantCard caption="Custom 7d threshold · 7d data triggers warning">
              <StaleDataBadge asOf={daysAgo(7)} thresholdDays={7} />
            </VariantCard>
          </div>
        </SubSection>

        {/* ────────────────────────────────────────────────────────── */}
        {/* Composition example — the three primitives together         */}
        {/* ────────────────────────────────────────────────────────── */}
        <SectionHeader
          eyebrow="Putting it together"
          title="Composition preview"
          blurb="A glimpse at how these three primitives compose into a player profile card. Real assembly happens in Phase 1 (Day 4-5)."
        />

        <div className="max-w-md p-5 rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <PlayerMonogram size="lg" fullName="Igor Shesterkin" teamAbbrev="NYR" jerseyNumber={31} isLowSample />
              <div>
                <div className="font-sans font-black text-pastel-cream text-[18px] leading-tight">
                  Igor Shesterkin
                </div>
                <div className="font-jbmono text-[10px] uppercase tracking-wider text-white/55 mt-0.5">
                  G · NYR · 5v5
                </div>
              </div>
            </div>
            <StaleDataBadge asOf={daysAgo(137)} />
          </div>
          <div className="space-y-3">
            <PercentileBullet size="sm" label="GSAx" context="5v5" percentile={91} rawValue={14.2} sampleSize={11} category="defense" />
            <PercentileBullet size="sm" label="Rebound Control" percentile={73} rawValue={2.41} rawUnit="%" sampleSize={11} category="defense" />
            <PercentileBullet size="sm" label="Total G-GAR" percentile={88} rawValue={11.8} sampleSize={11} category="defense" />
          </div>
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="font-jbmono text-[9px] uppercase tracking-[0.22em] text-white/55 font-bold mb-1">
              Stormy verdict
            </div>
            <p className="text-[13px] text-pastel-orange-soft italic font-sans">
              Elite GSAx season; only 11 GP raises sample concerns, and goalie model is 4+ months
              stale.
            </p>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-white/10">
          <div className="font-jbmono text-[10px] uppercase tracking-[0.22em] text-white/55 font-bold mb-2">
            Day 1 status
          </div>
          <p className="text-[13px] text-white/65">
            ✦ 3 of 5 primitives shipped. Day 2 morning: PercentileRingCluster (Concept A hero) +
            RinkHeatmap (one-mode-at-a-time spatial). Day 3: StormyVerdict generation pipeline +
            page composition. Live on prod by May 11 for Web Summit.
          </p>
        </div>
      </main>

      <HockeyFooter />
    </DarkLayout>
  );
}

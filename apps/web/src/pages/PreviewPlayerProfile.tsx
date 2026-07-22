/**
 * PreviewPlayerProfile — Component 6 of 7 for the Web Summit launch.
 *
 * The page-level composition: all five Citrus 2.0 dashboard primitives
 * (RinkHeatmap, PercentileRingCluster, SparklineMicroChart, VerdictTile,
 * WrappedChapter) wired together against the locked Concept 3 zone
 * contract — HERO / DATA / SHARE / CHROME.
 *
 * Bound to mock data for this iteration; the real Supabase wiring lands
 * in the follow-up (Component 6.5 / Phase 5).
 *
 * Route: /preview-player-profile
 *
 * ATTESTATION (per META-RULE protocol — see PLAYER_DASHBOARD_DESIGN_SPEC.md §9):
 * - 21st.dev primitive: hand-built page composition. Three queries fired
 *   ("athlete profile page layout" / "dashboard page composition" / "player
 *   profile fantasy sports") returned generic ProfileCard variants
 *   (similarity 0.145 / 0.091 / 0.01 — social/portfolio cards with avatars,
 *   bios, and stats grids) and a single "Hero 195" shadcn-card scaffold
 *   (similarity 4.172 nominally but the actual code is generic Card
 *   primitives + BorderBeam — wrong DNA). No primitive matches a
 *   composition with full-bleed sport hero + asymmetric bento data zone +
 *   Wrapped chapter. Hand-build justified.
 * - Design principle referenced: PLAYER_DASHBOARD_DESIGN_SPEC.md §2 zone
 *   contract — "The product is a single page with four declared zones.
 *   Every component lives in exactly one zone, and that zone declares
 *   which design movement governs its treatment." Plus §3 signature #2:
 *   "Asymmetric Bento (Stripe × Linear) — Variable-size tiles, complexity
 *   drives container — DATA zone — primary layout system."
 *   Plus canvas-design-system.md §1-4: 90% visual / 10% essential text,
 *   Visual Communication First, Minimal Text Integration, Systematic
 *   Patterns. Each zone honors its declared movement (HERO=Concrete
 *   Poetry; DATA=Modern Tech precision; SHARE=Wrapped chapters; CHROME=
 *   Geometric Silence).
 * - Matched mockup section: the entire concept-3-spatial-hero.jpg page
 *   composition — sticky CITRUS nav top (chrome) → full-bleed rink hero
 *   with jersey watermark + name + Stormy floating verdict + segmented
 *   mode control (HERO) → asymmetric bento with wide xG/60 sparkline tile
 *   above a 3-column row (Shot Breakdown bullets / 3-ring cluster / long-
 *   form verdict with dropcap) (DATA) → KDE chapter "POSITION VS LEAGUE"
 *   with monumental +4.21 callout (SHARE).
 */

import { useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import {
  DarkLayout,
  HockeyFooter,
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
  PercentileBullet,
  StaleDataBadge,
} from '@/components/citrus2';

// ── Mock data ────────────────────────────────────────────────────────
// Self-contained per-page mocks so the primitives compose against
// realistic fixtures. Real Supabase wiring lands in Phase 5.

const PLAYER = {
  fullName: 'Connor McDavid',
  eyebrow: 'C · EDM · 28YR',
  jersey: 97,
};

function jitter(center: number, spread: number): number {
  const u = Math.random() + 0.0001;
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, Math.min(1, center + z * spread));
}

// Iter #2 fix #3 — mock shots tagged with `mode` so the 5V5/PP toggle
// actually filters output. PP shots cluster heavier in the slot + circles
// (umbrella formation, less defensive pressure), 5v5 shots distribute
// across all zones.
const MOCK_SHOTS_5V5: ShotEvent[] = [
  ...Array.from({ length: 50 }, (_, i) => ({
    id: `5v5-slot-${i}`,
    x: jitter(0.50, 0.05),
    y: jitter(0.84, 0.04),
    xg_value: 0.18 + Math.random() * 0.14,
    is_goal: i % 5 === 0,
    mode: '5v5' as const,
  })),
  ...Array.from({ length: 28 }, (_, i) => ({
    id: `5v5-highslot-${i}`,
    x: jitter(0.50, 0.08),
    y: jitter(0.74, 0.04),
    xg_value: 0.10 + Math.random() * 0.10,
    is_goal: i % 9 === 0,
    mode: '5v5' as const,
  })),
  ...Array.from({ length: 18 }, (_, i) => ({
    id: `5v5-lowslot-${i}`,
    x: jitter(0.50, 0.04),
    y: jitter(0.93, 0.03),
    xg_value: 0.22 + Math.random() * 0.20,
    is_goal: i % 3 === 0,
    mode: '5v5' as const,
  })),
  ...Array.from({ length: 18 }, (_, i) => ({
    id: `5v5-lcircle-${i}`,
    x: jitter(0.30, 0.06),
    y: jitter(0.64, 0.07),
    xg_value: 0.04 + Math.random() * 0.08,
    is_goal: i % 12 === 0,
    mode: '5v5' as const,
  })),
  ...Array.from({ length: 18 }, (_, i) => ({
    id: `5v5-rcircle-${i}`,
    x: jitter(0.70, 0.06),
    y: jitter(0.64, 0.07),
    xg_value: 0.04 + Math.random() * 0.08,
    is_goal: i % 12 === 0,
    mode: '5v5' as const,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `5v5-point-${i}`,
    x: 0.20 + Math.random() * 0.60,
    y: 0.08 + Math.random() * 0.10,
    xg_value: 0.02 + Math.random() * 0.04,
    is_goal: false,
    mode: '5v5' as const,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `5v5-boards-${i}`,
    x: i % 2 === 0 ? 0.06 : 0.92,
    y: 0.45 + Math.random() * 0.30,
    xg_value: 0.02 + Math.random() * 0.04,
    is_goal: false,
    mode: '5v5' as const,
  })),
];

// PP — fewer total shots, but the slot + circle volume is dominant.
// Higher xG averages (less defensive pressure), more goals per shot.
const MOCK_SHOTS_PP: ShotEvent[] = [
  ...Array.from({ length: 22 }, (_, i) => ({
    id: `pp-slot-${i}`,
    x: jitter(0.50, 0.04),
    y: jitter(0.86, 0.04),
    xg_value: 0.24 + Math.random() * 0.16,
    is_goal: i % 3 === 0,
    mode: 'pp' as const,
  })),
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `pp-lcircle-${i}`,
    x: jitter(0.28, 0.04),
    y: jitter(0.62, 0.05),
    xg_value: 0.10 + Math.random() * 0.10,
    is_goal: i % 6 === 0,
    mode: 'pp' as const,
  })),
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `pp-rcircle-${i}`,
    x: jitter(0.72, 0.04),
    y: jitter(0.62, 0.05),
    xg_value: 0.10 + Math.random() * 0.10,
    is_goal: i % 6 === 0,
    mode: 'pp' as const,
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `pp-bumper-${i}`,
    x: jitter(0.50, 0.06),
    y: jitter(0.70, 0.04),
    xg_value: 0.16 + Math.random() * 0.10,
    is_goal: i % 5 === 0,
    mode: 'pp' as const,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `pp-point-${i}`,
    x: 0.30 + Math.random() * 0.40,
    y: 0.10 + Math.random() * 0.06,
    xg_value: 0.04 + Math.random() * 0.04,
    is_goal: false,
    mode: 'pp' as const,
  })),
];

const MOCK_SHOTS_ALL: ShotEvent[] = [...MOCK_SHOTS_5V5, ...MOCK_SHOTS_PP];

const OPPONENTS = ['NYR', 'BOS', 'PIT', 'TOR', 'MTL', 'OTT', 'TBL', 'FLA', 'CAR', 'WSH', 'PHI', 'NJD', 'DET', 'BUF', 'NYI', 'CBJ', 'CHI', 'COL', 'DAL', 'EDM', 'VAN', 'CGY', 'ANA', 'LAK', 'SJS', 'STL', 'NSH', 'WPG', 'MIN', 'VGK'];

function gameDateFor(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()}`;
}

const MOCK_XG_TREND: SparklinePoint[] = Array.from({ length: 30 }, (_, i) => {
  const base = 2.4 + Math.sin(i / 4.5) * 0.7 + (i / 30) * 0.5;
  return {
    x: i,
    y: Math.max(0.5, Number((base + (Math.random() - 0.5) * 0.4).toFixed(2))),
    gameDate: gameDateFor(29 - i),
    opponent: OPPONENTS[i % OPPONENTS.length],
  };
});

const MOCK_RINGS: RingMetric[] = [
  { category: 'offense', label: 'OFF', percentile: 99, sampleSize: 71 },
  { category: 'defense', label: 'DEF', percentile: 48, sampleSize: 71 },
  { category: 'special', label: 'ST', percentile: 94, sampleSize: 71 },
];

const MOCK_CENTER_GAR_SAMPLES: number[] = (() => {
  const out: number[] = [];
  const seedRand = (i: number) => {
    const x = Math.sin(i * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 906; i++) {
    const u1 = Math.max(seedRand(i * 2 + 1), 1e-6);
    const u2 = seedRand(i * 2 + 2);
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const v = z * 1 + (z > 0.8 ? 0.7 : 0);
    out.push(Number(v.toFixed(3)));
  }
  return out;
})();

interface ShotZoneRow {
  zone: string;
  share: number;
  xgPerShot: number;
  category: 'offense' | 'defense' | 'special' | 'neutral';
}

const SHOT_ZONES: ShotZoneRow[] = [
  { zone: 'SLOT',      share: 38, xgPerShot: 0.24, category: 'offense' },
  { zone: 'LOW SLOT',  share: 18, xgPerShot: 0.31, category: 'offense' },
  { zone: 'HIGH SLOT', share: 22, xgPerShot: 0.14, category: 'special' },
  { zone: 'POINT',     share: 12, xgPerShot: 0.04, category: 'defense' },
  { zone: 'BOARDS',    share: 10, xgPerShot: 0.03, category: 'neutral' },
];

// Iter #2 fix #4 — second breakdown tile metrics. JFresh-style standard
// percentile coverage (offense/defense/special teams), 8 metrics in a
// 4×2 grid. Mock values realistic for an elite center (McDavid).
interface PercentileMetric {
  label: string;
  context?: string;
  percentile: number;
  rawValue: number;
  rawUnit?: string;
  sampleSize: number;
  category: 'offense' | 'defense' | 'special' | 'neutral';
}

const STANDARD_METRICS: PercentileMetric[] = [
  { label: 'xG/60',        context: '5v5',  percentile: 96, rawValue: 3.42, rawUnit: '/60', sampleSize: 71, category: 'offense' },
  { label: 'Goals/60',     context: '5v5',  percentile: 99, rawValue: 1.62, rawUnit: '/60', sampleSize: 71, category: 'offense' },
  { label: 'Finishing',    context: 'G−xG', percentile: 88, rawValue: 0.48, rawUnit: '/60', sampleSize: 71, category: 'offense' },
  { label: 'A1/60',        context: '5v5',  percentile: 97, rawValue: 1.84, rawUnit: '/60', sampleSize: 71, category: 'offense' },
  { label: 'xGA/60',       context: 'on-ice', percentile: 42, rawValue: 2.31, rawUnit: '/60', sampleSize: 71, category: 'defense' },
  { label: 'xGF%',         context: 'on-ice', percentile: 81, rawValue: 60.4, rawUnit: '%',   sampleSize: 71, category: 'defense' },
  { label: 'PP1 xGF/60',   context: 'PP',   percentile: 94, rawValue: 9.82, rawUnit: '/60', sampleSize: 71, category: 'special' },
  { label: 'PEN±',         context: 'diff', percentile: 71, rawValue: 0.42, rawUnit: '/60', sampleSize: 71, category: 'special' },
];

const TODAY_ISO = new Date().toISOString();

// ── ChapterEyebrow — page-level chapter header above each zone ──────
// Iter #2 fix #2 — chapter-numbered section header, mirrors WrappedChapter's
// own eyebrow style for consistency. Page reads as a chaptered narrative.
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

// ── Local sub-composition: ShotBreakdownTile ─────────────────────────
// Vertical stack of PercentileBullets — 5 zones with hairline dividers.

function ShotBreakdownTile() {
  return (
    <div
      role="group"
      aria-label="Shot breakdown by zone"
      className="rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10 p-5 sm:p-6 h-full flex flex-col"
    >
      <div className="font-jbmono text-[10px] uppercase tracking-[0.22em] text-white/55 font-bold mb-5">
        Shot Breakdown · 5v5
      </div>
      <div className="flex-1 flex flex-col divide-y divide-white/[0.06]">
        {SHOT_ZONES.map((row, idx) => (
          <div key={row.zone} className={idx === 0 ? 'pb-3' : 'py-3 last:pb-0'}>
            <PercentileBullet
              size="sm"
              label={row.zone}
              percentile={row.share * 2.2}
              rawValue={row.share}
              rawUnit="%"
              sampleSize={188}
              category={row.category}
            />
            <div className="mt-1 font-jbmono text-[9px] uppercase tracking-[0.22em] text-white/35 font-bold tabular-nums">
              {row.xgPerShot.toFixed(2)} xG/shot
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────

export default function PreviewPlayerProfile() {
  const [rinkMode, setRinkMode] = useState<RinkMode>('5v5');

  // Iter #2 fix #3 — actually filter the shots by mode.
  // 5v5 → 5v5 only. pp → PP only. xg → all (current xG-color encoding).
  // g-xg → goals only (talent layer — finishing variance highlighted).
  const filteredShots = useMemo(() => {
    if (rinkMode === '5v5') return MOCK_SHOTS_5V5;
    if (rinkMode === 'pp') return MOCK_SHOTS_PP;
    if (rinkMode === 'g-xg') return MOCK_SHOTS_ALL.filter((s) => s.is_goal);
    // default 'xg' or anything else: all shots
    return MOCK_SHOTS_ALL;
  }, [rinkMode]);

  return (
    <DarkLayout>
      {/* CHROME ZONE — sticky nav (existing Navbar from app shell) */}
      <Navbar />

      <main className="relative pt-20 pb-12">
        {/* ────────────────────────────────────────────────────────── */}
        {/* HERO ZONE — full-bleed RinkHeatmap, Concrete Poetry         */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 mb-6">
          <ChapterEyebrow chapterNumber={1} title="OVERVIEW" />
        </div>
        <section
          aria-labelledby="player-hero-name"
          className="relative px-4 sm:px-6"
        >
          <RinkHeatmap
            shots={filteredShots}
            mode={rinkMode}
            onModeChange={setRinkMode}
            playerName={PLAYER.fullName}
            eyebrow={PLAYER.eyebrow}
            jerseyNumber={PLAYER.jersey}
            verdict="Generates 73% of his offense from the high slot — top decile in the league this season."
            verdictEyebrow="Stormy verdict"
          />
        </section>

        {/* ────────────────────────────────────────────────────────── */}
        {/* DATA ZONE — sparkline (CHAPTER 2 — Recent Trends)           */}
        {/* ────────────────────────────────────────────────────────── */}
        <section
          aria-label="Recent trends"
          className="relative max-w-[1280px] mx-auto px-4 sm:px-6 mt-12 sm:mt-16"
        >
          <ChapterEyebrow chapterNumber={2} title="RECENT TRENDS" className="mb-6" />
          <div className="rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10 p-5 sm:p-7">
            <SparklineMicroChart
              data={MOCK_XG_TREND}
              eyebrow="Last 30 days · xG/60"
              endpointUnit="/60"
              tooltipUnit="/60"
            />
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────── */}
        {/* DATA ZONE — bento (CHAPTER 3 — Breakdown)                    */}
        {/* ────────────────────────────────────────────────────────── */}
        <section
          aria-label="Player breakdown"
          className="relative max-w-[1280px] mx-auto px-4 sm:px-6 mt-12 sm:mt-16"
        >
          <ChapterEyebrow chapterNumber={3} title="BREAKDOWN" className="mb-6" />

          {/* Asymmetric bento row — Shot Breakdown / Rings / Verdict
              On lg+, ratio 1.1 / 1 / 1.1. Collapses to single column under lg. */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr_1.1fr] gap-5 sm:gap-6 items-stretch">
            <ShotBreakdownTile />

            <div className="rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10 p-5 sm:p-6 flex flex-col items-center justify-center">
              <PercentileRingCluster
                metrics={MOCK_RINGS}
                ringSize={92}
                caption="OFF · DEF · ST GAR PERCENTILES"
              />
            </div>

            <div className="flex flex-col">
              <VerdictTile
                size="lg"
                dropcap
                accent="orange"
                body="Elite slot finisher whose underlying xG model overrates his shot volume but underrates the quality of selection — bet on the underlying skill, fade the short-sample variance, and ride the powerplay deployment."
                signature="Stormy · Assistant GM"
                className="h-full"
              />
            </div>
          </div>

          {/* Iter #2 fix #4 — second breakdown tile: 8 standard percentile
              metrics in a 2-col grid (1-col under sm, 2-col sm+, 4-col lg+).
              Sits beneath the asymmetric bento row to extend BREAKDOWN. */}
          <div className="mt-5 sm:mt-6 rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10 p-5 sm:p-7">
            <div className="flex items-baseline justify-between gap-3 mb-5">
              <div className="font-jbmono text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-white/55 font-bold">
                Standard Percentiles · vs all centers
              </div>
              <div className="font-jbmono text-[9px] uppercase tracking-[0.22em] text-white/35 font-bold tabular-nums">
                71 GP · 906 cohort
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
              {STANDARD_METRICS.map((m) => (
                <PercentileBullet
                  key={m.label}
                  size="sm"
                  label={m.label}
                  context={m.context}
                  percentile={m.percentile}
                  rawValue={m.rawValue}
                  rawUnit={m.rawUnit}
                  sampleSize={m.sampleSize}
                  category={m.category}
                />
              ))}
            </div>
          </div>

          {/* Subtle freshness chip below the bento — chrome-zone inline citation */}
          <div className="mt-5 sm:mt-6 flex items-center justify-end gap-2">
            <StaleDataBadge asOf={TODAY_ISO} label="xG model" />
            <span className="font-jbmono text-[9px] uppercase tracking-[0.22em] text-white/35 font-bold">
              · 906 centers benchmarked
            </span>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────── */}
        {/* SHARE ZONE — Wrapped chapter (CHAPTER 4)                    */}
        {/* ────────────────────────────────────────────────────────── */}
        <section
          aria-label="Position vs league"
          className="relative max-w-[1280px] mx-auto px-4 sm:px-6 mt-12 sm:mt-16"
        >
          <WrappedChapter
            chapterNumber={4}
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
        </section>
      </main>

      {/* CHROME ZONE — minimal footer */}
      <HockeyFooter />
    </DarkLayout>
  );
}

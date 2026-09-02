import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Mug } from '@/components/roster/Mug';
import { PercentileBullet } from '@/components/citrus2/PercentileBullet';
import { ROW_HEADLINE, ROW_HEADLINE_LABEL, ROW_META, ROW_MICRO, ROW_NAME } from '@/components/phoneRowScale';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  usePlayerDashboardIndex,
  type DashboardIndexEntry,
} from '@/hooks/usePlayerDashboardIndex';
import {
  COMPACT_METRIC_COUNT,
  DISTRIBUTION_MIN_GP,
  buildAdvancedCardData,
  findDashboardPlayer,
  fmt1,
  fmt2,
  playerDashboardHref,
  type AdvancedCardData,
} from './playerAdvancedMetrics';

/**
 * PWS-1 — THE CONDENSED PLAYER CARD, ON EVERY PLAYER SURFACE.
 *
 * Implements `apps/web/docs/PLAYER_DASHBOARD_DESIGN_SPEC.md` §"Post-Web-Summit
 * todos → PWS-1: PlayerCard (condensed, embedded surface)": identity strip,
 * metric stack of `PercentileBullet size="sm"` rows, verdict line, and a
 * click-through to the full dashboard. Density target per the spec is
 * JFresh's static cards; vocabulary is strictly Citrus 2.0 — no primitive is
 * introduced here that `components/citrus2/` did not already ship.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE GAP THIS CLOSES
 *
 * The whole player-dashboard design system — `PercentileBullet`,
 * `PercentileRingCluster`, `RinkHeatmap`, `SparklineMicroChart`,
 * `VerdictTile`, `PlayerMonogram`, `StaleDataBadge` — was built, reviewed
 * and then referenced by exactly two files: `pages/PreviewDashboardPrimitives`
 * and `pages/PreviewPlayerProfile`. `App.tsx` gates every `Preview*` route
 * behind `import.meta.env.DEV`, which is statically false in a production
 * build, so Rollup drops those routes and with them every import below them.
 * The design system rendered for nobody. This component is the first
 * production consumer of it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT MUST NEVER BREAK ITS HOST
 *
 * `/api/players/dashboard-index` sits behind `authMiddleware`. On a guest,
 * demo or expired-token surface it 401s, and this card's contract is then
 * simple: RENDER NOTHING. Not a spinner, not an error, not an empty frame —
 * `null`, so a roster, a draft board or a free-agent list looks and behaves
 * exactly as it did before this feature existed. Every other missing-data
 * path (player absent from the index, endpoint down, first load still in
 * flight) collapses to the same `null`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ANTI-PATTERN CHECKLIST (spec §4) — what this component does about each
 *
 *  1. No flat stacked percentile bars: `PercentileBullet` is the sanctioned
 *     meterstrip with its median tick, used at its `sm` preset exactly as
 *     PWS-1 asks.
 *  2. No 3-column card grid: one column, hairline-separated bands.
 *  3. No decorative axes: the bullets carry one median hairline and no
 *     numeric scale, which is the primitive's own refinement.
 *  4. Pills only for meaningful state: the sole chip is LIMITED SAMPLE, and
 *     it appears only when the player really is under the threshold.
 *  5. Not centered: every band is left-anchored with its value flushed
 *     right — asymmetric, per the data-zone law.
 *  6. No tab strips.
 *  7. Every colour encodes: orange = offence/focal, sage = defence/success,
 *     butter = special teams and caution, cream = primary text. See the
 *     finishing row for the one judgement call.
 *  8. No hero-number-with-caps-label-below: every label sits ABOVE or LEFT
 *     of its number.
 *  9. No layout-mirroring skeletons: an unresolved card renders nothing.
 * 10. No hockey clichés: the jersey number in the identity strip is the
 *     maximum literal reference the spec allows, and it is the only one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PHONE FIRST. Sized and measured at 393×852. Type comes from
 * `components/phoneRowScale.ts` — names 15px, headline numbers 17px mono,
 * meta 12px, micro 10px — so this card wears the same ladder as the roster
 * row, the matchup row and the free-agent row rather than inventing a fifth.
 */

export type PlayerAdvancedCardVariant = 'compact' | 'expanded';

export interface PlayerAdvancedCardProps {
  /**
   * The NHL player id the host surface already holds. `HockeyPlayer.id`,
   * `Player.id` and `player_directory.player_id` are all the same number —
   * see `findDashboardPlayer` for the provenance.
   */
  playerId: number | string | null | undefined;
  /**
   * `compact` (default) is the PWS-1 embedded card: ~180–240px tall, four
   * metric rows. `expanded` adds the rest of the GAR decomposition and the
   * rest-of-season projection, for hosts with the height — a modal, a
   * comparison drawer.
   */
  variant?: PlayerAdvancedCardVariant;
  /** Skip the fetch entirely (a closed modal). Defaults to true. */
  enabled?: boolean;
  /** Render the "Full dashboard" link. Off where navigating away is hostile. */
  showLink?: boolean;
  className?: string;
  /**
   * Inject the index instead of reading the shared hook. Tests and the render
   * harness use this; production never passes it.
   */
  indexOverride?: readonly DashboardIndexEntry[];
}

/**
 * FINISHING IS COLOURED BY SIGN, and this is the one place the card makes a
 * colour judgement the design system did not already make for it.
 *
 * The vocabulary has no "bad" colour — orange is focal, sage is
 * defence/success, butter is special-teams/electric, cream is text. So:
 *
 *   over expected  → `pastel-sage` #84A57D  (the system's live/success token)
 *   under expected → `pastel-butter` #F4E5B8 (what `StaleDataBadge` already
 *                                             uses for its WARNING tier, so
 *                                             it reads as "look at this",
 *                                             not "this player is bad")
 *   level          → `pastel-cream`
 *
 * `pastel-sage` and not `pastel-sage-soft`: shot at 393 on
 * /harness/advanced.html with sage-soft (#C8DCC4) and the "+3.9" was
 * indistinguishable from the cream beside it — a sign encoding nobody can
 * see is not an encoding. #84A57D measures ~5.8:1 on the #1A2A20 tile, so it
 * clears AA and actually reads green.
 *
 * Butter rather than a red, deliberately. A negative G−xG is NOT a bad
 * player — it is very often a buy-low, and the verdict line right below says
 * so in words. A red would overrule the sentence.
 */
function finishingTone(v: number): string {
  if (v >= 0.5) return 'text-pastel-sage';
  if (v <= -0.5) return 'text-pastel-butter';
  return 'text-pastel-cream';
}

/** A hairline band. One divider style for the whole card. */
function Band({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('border-t border-white/10 px-3.5 py-2.5', className)}>{children}</div>;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(ROW_MICRO, 'font-jbmono uppercase tracking-[0.18em] text-white/55')}>
      {children}
    </div>
  );
}

export function PlayerAdvancedCard({
  playerId,
  variant = 'compact',
  enabled = true,
  showLink = true,
  className,
  indexOverride,
}: PlayerAdvancedCardProps) {
  const isMobile = useIsMobile();
  // The hook is called unconditionally (rules of hooks) but never fetches
  // when an override is supplied or the host says it is not needed.
  const shared = usePlayerDashboardIndex({ enabled: enabled && !indexOverride });
  const index = indexOverride ?? shared.players;

  const player = useMemo(() => findDashboardPlayer(index, playerId), [index, playerId]);

  // Memoised on the index's IDENTITY, which is stable for the session — the
  // hook hands out one frozen array from a module-level cache — so the
  // cohort walk over ~2k rows happens once per player, not once per render.
  const data: AdvancedCardData | null = useMemo(
    () => (player ? buildAdvancedCardData(player, index) : null),
    [player, index],
  );

  // THE DEGRADED PATH. 401, network failure, still loading, unknown player —
  // all one branch, all `null`. The host renders exactly what it always did.
  if (!enabled || !player || !data) return null;

  const showAll = variant === 'expanded';
  const metrics = showAll ? data.metrics : data.metrics.slice(0, COMPACT_METRIC_COUNT);
  const visible = metrics.filter((m) => m.value != null || m.percentile != null);

  // A card with an identity strip and no numbers is worse than no card: it
  // implies we measured this player and found nothing. If the payload has
  // him but every metric is null (a call-up with no stats row), stand down.
  if (visible.length === 0 && !data.finishing) return null;

  const projFp = player.proj_fantasy_points;
  const projPpg = player.proj_fantasy_ppg;
  const hasProjection = projFp != null || projPpg != null;

  return (
    <section
      data-testid="player-advanced-card"
      data-cohort={data.cohort}
      data-variant={variant}
      aria-label={`${player.name} — advanced metrics`}
      className={cn(
        'w-full min-w-0 overflow-hidden rounded-2xl',
        'bg-pastel-surface-tile ring-1 ring-white/10',
        className,
      )}
    >
      {/* ── Identity strip ───────────────────────────────────────────
          PWS-1 asks for monogram + name + caps eyebrow `POS · TEAM · AGE`
          + jersey. AGE IS NOT IN THIS PAYLOAD — `DashboardIndexEntry` has
          no birth date and `player_directory` is not joined for one — so
          the eyebrow prints POS · TEAM and the jersey takes the third
          slot rather than an invented number. Deviation logged in the
          spec's change table. */}
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <Mug
          p={{ name: player.name, image: player.headshot_url, team: player.team }}
          size={isMobile ? 'md' : 'lg'}
          crest
        />
        <div className="min-w-0 flex-1">
          <div className={cn(ROW_NAME, 'text-pastel-cream')}>{player.name}</div>
          <div className={cn(ROW_META, 'mt-1 font-jbmono uppercase tracking-[0.12em] text-white/55')}>
            {player.position} · {player.team}
            {player.jersey != null && ` · #${player.jersey}`}
          </div>
        </div>
        {data.lowSample && (
          /* Anti-pattern #4: a chip for MEANINGFUL state only. This one
             fires solely when the player is genuinely below the sample
             floor the distribution is built on. */
          <span
            data-testid="advanced-card-low-sample"
            title={`${player.gp} games played — too few to trust a per-60 rate`}
            className={cn(
              ROW_MICRO,
              'flex-shrink-0 rounded-md px-1.5 py-0.5 font-jbmono font-bold uppercase tracking-[0.18em]',
              'bg-pastel-butter/15 text-pastel-butter ring-1 ring-pastel-butter/40',
            )}
          >
            {player.gp} GP
          </span>
        )}
      </div>

      {/* ── Finishing: G − xG ────────────────────────────────────────
          The most Citrus-specific number on the card — it exists only
          because we scored all 118,975 shots of the season ourselves.
          Label ABOVE the number (anti-pattern #8), value flushed right. */}
      {data.finishing && (
        <Band className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>Finishing</Eyebrow>
            <div className={cn(ROW_META, 'mt-1 text-white/70')}>
              {player.goals} goals on {fmt1(player.x_goals)} expected
            </div>
          </div>
          <div className="flex-shrink-0 text-right">
            <div
              data-testid="advanced-card-finishing"
              className={cn(ROW_HEADLINE, finishingTone(data.finishing.value))}
            >
              {data.finishing.display}
            </div>
            <div className={cn(ROW_HEADLINE_LABEL, 'mt-1 text-white/55')}>
              {data.finishing.percentile != null
                ? `${data.finishing.percentile}th · ${data.cohortNoun}`
                : 'vs expected'}
            </div>
          </div>
        </Band>
      )}

      {/* ── The metric stack ─────────────────────────────────────────
          `PercentileBullet size="sm"`, exactly as PWS-1 specifies. Each
          row carries its own raw value, so the metric stays readable
          even where the cohort is too small for a percentile. */}
      {visible.length > 0 && (
        <Band>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <Eyebrow>vs {data.cohortNoun}</Eyebrow>
            <span className={cn(ROW_MICRO, 'font-jbmono tabular-nums text-white/55')}>
              n={data.cohortSize}
            </span>
          </div>
          <div className="space-y-2">
            {visible.map((m) => (
              <PercentileBullet
                key={m.spec.key}
                size="sm"
                label={m.spec.label}
                context={m.spec.context}
                category={m.spec.category}
                percentile={m.percentile}
                rawValue={m.display}
                sampleSize={player.gp}
                /* ONE sample threshold per card, not two. PercentileBullet
                   defaults to 20 GP for its own LOW SAMPLE flag; left alone,
                   a goalie with 17 starts (a genuine starter's mid-season
                   workload) wore the chip on all four rows while the card's
                   header chip — which fires at DISTRIBUTION_MIN_GP — did not.
                   Two different marks for "thin sample" on one surface is
                   worse than either. Measured on /harness/advanced.html. */
                lowSampleThreshold={DISTRIBUTION_MIN_GP}
              />
            ))}
          </div>
        </Band>
      )}

      {/* ── Rest-of-season projection ────────────────────────────────
          Expanded only: a condensed card is a read of what HAS happened,
          and PWS-1 budgets it 180–240px. */}
      {showAll && hasProjection && (
        <Band className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>Rest of season</Eyebrow>
            <div className={cn(ROW_META, 'mt-1 text-white/70')}>
              {player.is_goalie
                ? `${fmt1(player.proj_wins)} W · ${fmt1(player.proj_saves)} SV · ${fmt1(player.proj_shutouts)} SO`
                : `${fmt1(player.proj_goals)} G · ${fmt1(player.proj_assists)} A · ${fmt1(player.proj_sog)} SOG`}
              {player.proj_gp != null && ` over ${Math.round(player.proj_gp)} GP`}
            </div>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className={cn(ROW_HEADLINE, 'text-pastel-orange-soft')}>{fmt2(projPpg)}</div>
            <div className={cn(ROW_HEADLINE_LABEL, 'mt-1 text-white/55')}>
              FP/G · {fmt1(projFp)} total
            </div>
          </div>
        </Band>
      )}

      {/* ── Verdict ──────────────────────────────────────────────────
          PWS-1: "one-line verdict in italic pastel-orange-soft,
          abbreviated. No dropcap, no signature in this surface."
          Derived, never generated — see `deriveVerdict`. Omitted
          entirely when the numbers do not support a sentence. */}
      {data.verdict && (
        <Band className="bg-white/5">
          <p
            data-testid="advanced-card-verdict"
            className={cn(ROW_META, 'italic leading-snug text-pastel-orange-soft')}
          >
            {data.verdict}
          </p>
        </Band>
      )}

      {/* ── Click-through ────────────────────────────────────────────
          PWS-1 says "card is a link". It is a LABELLED link here instead
          of a whole-card target, deliberately: this card's biggest host
          is a modal that opens inside a live draft room, and turning a
          surface a manager reads and taps into a full-page navigation
          target is a trap, not a feature. Deviation logged in the spec's
          change table. */}
      {showLink && (
        <Band className="py-2.5">
          <Link
            to={playerDashboardHref(player.id)}
            data-testid="advanced-card-link"
            className={cn(
              ROW_MICRO,
              'font-jbmono uppercase tracking-[0.18em] text-white/70 transition-colors hover:text-pastel-orange-soft',
            )}
          >
            Full dashboard →
          </Link>
        </Band>
      )}
    </section>
  );
}

export default PlayerAdvancedCard;

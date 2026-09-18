import { useState } from 'react';
// Direct module import, not the citrus2 barrel: the barrel re-exports
// Homepage, which pulls Navbar -> AuthContext -> the Supabase client, and that
// throws at module scope without VITE_SUPABASE_*. A card should be renderable
// in a test without booting auth.
import { PercentileBullet } from '@/components/citrus2/PercentileBullet';
import { COHORT_LABEL, formatMetricValue, ordinal, type DraftKitCard } from './types';

/**
 * The Draft Kit player card.
 *
 * ── WHAT WE TOOK FROM JFRESH HOCKEY ──────────────────────────────────
 * Researched 2026-09-02 from jfresh.substack.com ("Player Card Explainer",
 * "Player Card 2.0 Explainer"). What was worth taking is the GRAMMAR, and
 * only the grammar:
 *
 *   1. Identity block on top: name, team, position, and the deployment
 *      context that tells you how the numbers were earned. His shows age,
 *      cap hit, TOI/GP, QoC and QoT. Ours shows games played, ice time per
 *      game is not on the index payload, so we show the sample and the
 *      cohort size instead of implying context we do not have.
 *   2. One headline number, then its parts underneath. His is projected WAR
 *      percentile decomposed into EV offence / EV defence / PP / PK /
 *      finishing / penalties. Ours is projected fantasy value decomposed
 *      into the GAR components our pipeline writes.
 *   3. Every number is a percentile in a bar, not a rate in a table.
 *   4. Goalies get a different card, not a skater card with blanks.
 *
 * What we did NOT take: his layout, his blue-to-red colour ramp, his WAR
 * model, his thresholds, his sample-size rules, or any of his words. The bar
 * primitive here is Citrus's own `PercentileBullet`, which predates this
 * section and already carries the four-category Citrus palette.
 *
 * ── THE COHORT LINE IS NOT DECORATION ────────────────────────────────
 * Every card states which pool its percentiles were taken against and how big
 * that pool is. A percentile with no stated cohort is an unfalsifiable number,
 * and this section's whole claim is that its numbers can be checked. The
 * server computes them inside F / D / G and never across; the footer is where
 * the reader gets told so.
 *
 * ── ART ──────────────────────────────────────────────────────────────
 * The only image on this card is the player's own NHL headshot from
 * player_directory.headshot_url. When it is missing or fails to load the
 * fallback is a monogram, not a generated portrait. No artwork is invented
 * here.
 */

/** Metric key to PercentileBullet colour category. */
const CATEGORY: Record<string, 'offense' | 'defense' | 'special' | 'neutral'> = {
  gar60: 'neutral',
  evo: 'offense',
  evd: 'defense',
  ppo: 'special',
  ppd: 'special',
  pen: 'special',
  xg60: 'offense',
  finishing: 'offense',
  gsax: 'defense',
  xg_faced: 'neutral',
  save_pct: 'defense',
  wins: 'offense',
};

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function Headshot({ card }: { card: DraftKitCard }) {
  const [broken, setBroken] = useState(false);
  const cls = 'h-14 w-14 shrink-0 rounded-xl ring-1 ring-white/15 bg-white/5';
  if (!card.headshotUrl || broken) {
    return (
      <div
        className={`${cls} flex items-center justify-center font-jbmono text-[13px] font-bold text-white/60`}
        aria-hidden="true"
      >
        {initials(card.name)}
      </div>
    );
  }
  return (
    <img
      src={card.headshotUrl}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className={`${cls} object-cover`}
    />
  );
}

export interface DraftKitPlayerCardProps {
  card: DraftKitCard;
  /** Cohort size, for the footer line that states what the percentiles mean. */
  cohortSize: number;
  /** Season the impact metrics describe. */
  metricsSeason: number;
  /** Shown when the caller is unentitled: the card renders identity only. */
  locked?: boolean;
}

export function DraftKitPlayerCard({
  card,
  cohortSize,
  metricsSeason,
  locked = false,
}: DraftKitPlayerCardProps) {
  const cohortName = COHORT_LABEL[card.cohort].toLowerCase();
  const seasonLabel = `${metricsSeason}-${String(metricsSeason + 1).slice(2)}`;

  return (
    <article
      data-testid="draft-kit-player-card"
      data-player-id={card.playerId}
      className="rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10 overflow-hidden"
    >
      {/* Identity */}
      <header className="flex items-start gap-3 p-4">
        <Headshot card={card} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-sans text-[16px] font-black leading-tight text-pastel-cream">
            {card.name}
          </h3>
          <p className="mt-0.5 font-jbmono text-[11px] uppercase tracking-[0.14em] text-white/50">
            {card.position} · {card.team}
            {card.jersey != null ? ` · #${card.jersey}` : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {card.tier != null && (
              <span className="rounded-md bg-pastel-orange/15 px-1.5 py-0.5 font-jbmono text-[10px] font-bold uppercase tracking-[0.14em] text-pastel-orange-soft ring-1 ring-pastel-orange/30">
                Tier {card.tier}
              </span>
            )}
            {card.cohortRank != null && (
              <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-jbmono text-[10px] font-bold uppercase tracking-[0.14em] text-white/60 ring-1 ring-white/10">
                {ordinal(card.cohortRank)} {cohortName}
              </span>
            )}
            {card.previousTeam && (
              <span className="rounded-md bg-pastel-butter/10 px-1.5 py-0.5 font-jbmono text-[10px] font-bold uppercase tracking-[0.14em] text-pastel-butter ring-1 ring-pastel-butter/25">
                New: {card.previousTeam} to {card.team}
              </span>
            )}
            {card.rosterStatus && ['IR', 'LTIR'].includes(card.rosterStatus) && (
              <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 font-jbmono text-[10px] font-bold uppercase tracking-[0.14em] text-red-300 ring-1 ring-red-400/30">
                {card.rosterStatus}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Headline: projected value, and where it sits in the cohort */}
      {!locked && card.projectedFantasyPoints != null && (
        <div className="mx-4 rounded-xl bg-white/[0.03] px-3 py-3 ring-1 ring-white/10">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-jbmono text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
              Projected fantasy points
            </span>
            <span className="font-jbmono text-[18px] font-black tabular-nums text-pastel-cream">
              {card.projectedFantasyPoints.toFixed(0)}
            </span>
          </div>
          <div className="mt-2">
            <PercentileBullet
              label="Value among cohort"
              context={COHORT_LABEL[card.cohort]}
              percentile={card.valuePercentile}
              rawValue={card.projectedFantasyPpg != null ? card.projectedFantasyPpg.toFixed(2) : null}
              rawUnit="/gp"
              category="offense"
              size="sm"
            />
          </div>
          {card.projectedGames != null && (
            <p className="mt-1.5 font-jbmono text-[10px] uppercase tracking-[0.14em] text-white/55">
              {card.projectedGames} projected games
            </p>
          )}
        </div>
      )}

      {/* Decomposition */}
      {!locked && card.metrics.length > 0 && (
        <div className="px-4 pt-4">
          <h4 className="font-jbmono text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-orange-soft">
            {card.cohort === 'G' ? 'Goaltending' : 'Impact breakdown'}
          </h4>
          <div className="mt-2.5 space-y-2.5">
            {card.metrics.map((m) => (
              <PercentileBullet
                key={m.key}
                label={m.label}
                percentile={m.percentile}
                rawValue={formatMetricValue(m.value, m.format)}
                sampleSize={card.sampleGames}
                category={CATEGORY[m.key] ?? 'neutral'}
                size="sm"
              />
            ))}
          </div>
        </div>
      )}

      {locked && (
        <div className="mx-4 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-4 text-center">
          <p className="text-[13px] leading-relaxed text-white/55">
            Percentiles, projections and the impact breakdown are part of the paid kit.
          </p>
        </div>
      )}

      {/* The audit line. Says what the numbers mean and where they came from. */}
      <footer className="mt-4 border-t border-white/10 px-4 py-3">
        <p className="font-jbmono text-[10px] leading-relaxed uppercase tracking-[0.12em] text-white/55">
          Percentiles vs {cohortSize} {cohortName}
          {card.sampleGames > 0 ? ` · ${card.sampleGames} GP in ${seasonLabel}` : ''}
        </p>
        {!locked && card.metrics.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer font-jbmono text-[10px] uppercase tracking-[0.12em] text-white/55 hover:text-pastel-orange-soft">
              Where these numbers come from
            </summary>
            <ul className="mt-2 space-y-1">
              {card.metrics.map((m) => (
                <li key={m.key} className="font-jbmono text-[10px] leading-relaxed text-white/55">
                  <span className="text-white/55">{m.label}:</span>{' '}
                  <span className="break-all">{m.source}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </footer>
    </article>
  );
}

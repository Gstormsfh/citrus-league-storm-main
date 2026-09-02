import { Fragment, useMemo } from 'react';
import { COHORT_LABEL, ordinal, type Cohort, type DraftKitCard } from './types';

/**
 * The ranked board, cut into tiers.
 *
 * ── WHY A TIERED BOARD AND NOT A FLAT LIST ───────────────────────────
 * The flat list is JFresh's format; the tiered board is the draft-kit format.
 * Yahoo's Ultra tier sells "tiered cheat sheets" and ESPN's draft guide leads
 * with tiers for the same reason: on the clock, the question is never "who is
 * ranked 34th", it is "is there anyone left in this group". Tiers answer that
 * and a rank column does not.
 *
 * ── HOW THE TIERS ARE DRAWN ──────────────────────────────────────────
 * By the largest gaps in projected fantasy points, computed on the server in
 * DraftKitService.tierBreaks. No weighting and no judgement: the boundaries
 * fall where the drops are biggest, so a reader looking at the numbers on
 * screen can reproduce them. That is deliberate. A tier break nobody can check
 * is an assertion, and this section does not make assertions it cannot show.
 *
 * ── COHORTS ──────────────────────────────────────────────────────────
 * Ranks are within position, so a forward and a defenceman are never given a
 * shared ordinal. The tab switcher is the cohort selector.
 */

export interface DraftKitRankingsProps {
  cards: DraftKitCard[];
  cohort: Cohort;
  cohortSize: number;
  /** Identity only: the free board shows who is on it, not what they project. */
  locked?: boolean;
  onSelect?: (playerId: number) => void;
  selectedPlayerId?: number | null;
}

export function DraftKitRankings({
  cards,
  cohort,
  cohortSize,
  locked = false,
  onSelect,
  selectedPlayerId,
}: DraftKitRankingsProps) {
  const rows = useMemo(
    () =>
      cards
        .filter((c) => c.cohort === cohort && c.cohortRank != null)
        .sort((a, b) => (a.cohortRank as number) - (b.cohortRank as number)),
    [cards, cohort],
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl bg-pastel-surface-tile px-4 py-6 text-center text-[13px] text-white/50 ring-1 ring-white/10">
        No ranked {COHORT_LABEL[cohort].toLowerCase()} yet. Rankings populate from the nightly
        projection batch.
      </p>
    );
  }

  return (
    <div data-testid="draft-kit-rankings" className="overflow-hidden rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <h3 className="font-jbmono text-[11px] font-bold uppercase tracking-[0.2em] text-pastel-orange-soft">
          {COHORT_LABEL[cohort]}
        </h3>
        <span className="font-jbmono text-[10px] uppercase tracking-[0.14em] text-white/55">
          {rows.length} of {cohortSize} ranked
        </span>
      </div>

      <ol className="divide-y divide-white/5">
        {rows.map((c, i) => {
          const prev = rows[i - 1];
          const startsTier = c.tier != null && (!prev || prev.tier !== c.tier);
          const selected = selectedPlayerId === c.playerId;
          return (
            <Fragment key={c.playerId}>
              {startsTier && (
                <li className="bg-white/[0.03] px-4 py-1.5">
                  <span className="font-jbmono text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">
                    Tier {c.tier}
                  </span>
                </li>
              )}
              <li>
                <button
                  type="button"
                  onClick={() => onSelect?.(c.playerId)}
                  aria-pressed={selected}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    selected ? 'bg-pastel-orange/10' : 'hover:bg-white/5'
                  }`}
                >
                  <span className="w-7 shrink-0 font-jbmono text-[12px] font-bold tabular-nums text-white/55">
                    {c.cohortRank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-pastel-cream">
                      {c.name}
                    </span>
                    <span className="block truncate font-jbmono text-[10px] uppercase tracking-[0.14em] text-white/55">
                      {c.position} · {c.team}
                      {c.previousTeam ? ` · from ${c.previousTeam}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {locked || c.projectedFantasyPoints == null ? (
                      <span className="font-jbmono text-[11px] uppercase tracking-[0.14em] text-white/25">
                        Locked
                      </span>
                    ) : (
                      <>
                        <span className="block font-jbmono text-[13px] font-black tabular-nums text-pastel-cream">
                          {c.projectedFantasyPoints.toFixed(0)}
                        </span>
                        <span className="block font-jbmono text-[9px] uppercase tracking-[0.14em] text-white/55">
                          {c.valuePercentile != null ? `${ordinal(c.valuePercentile)} pct` : 'proj fp'}
                        </span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

import { ordinal, COHORT_LABEL, type RosterChange } from './types';

/**
 * Roster-change highlights: who is playing somewhere new.
 *
 * ── HOW A "CHANGE" IS DETECTED ───────────────────────────────────────
 * By comparing player_directory.team_abbrev across two seasons of the
 * directory: the season being projected, and the one before it. A player whose
 * abbreviation differs between the two rows changed clubs. That is the whole
 * rule, and it is computed on the server in DraftKitService.getBoard.
 *
 * Both sides are anchored to the projection season on purpose. Pairing the
 * metrics season with the projection season looks equivalent and is not: in
 * the offseason those two keys are one apart, but in season they are the same
 * number, and the comparison would silently find that nobody had moved.
 *
 * player_directory has a prior_team column that would have been the obvious
 * source. It is NULL on every row in production (checked 2026-09-02), so
 * using it would have produced an empty list that looked like "nobody moved".
 * The two-season comparison is the honest derivation available today.
 *
 * WHAT THIS LIST DOES NOT CLAIM: it does not say whether a move was a trade,
 * a signing, a waiver claim or an expansion pick, because the directory does
 * not record that. It says the club changed. Anything more specific belongs in
 * a written blurb with a byline on it.
 */

export interface RosterChangeListProps {
  changes: RosterChange[];
  /** Total behind the gate, when the caller is seeing none of them. */
  totalChanges: number;
  locked?: boolean;
  limit?: number;
  onSelect?: (playerId: number) => void;
}

export function RosterChangeList({
  changes,
  totalChanges,
  locked = false,
  limit = 25,
  onSelect,
}: RosterChangeListProps) {
  if (locked) {
    return (
      <div
        data-testid="roster-changes-locked"
        className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-6 text-center"
      >
        <p className="text-[14px] font-bold text-pastel-cream">
          {totalChanges} players are on a new club
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
          Roster-change tracking is part of the paid kit.
        </p>
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <p className="rounded-2xl bg-pastel-surface-tile px-4 py-6 text-center text-[13px] text-white/50 ring-1 ring-white/10">
        No club changes detected between the two directory seasons yet.
      </p>
    );
  }

  const shown = changes.slice(0, limit);

  return (
    <div
      data-testid="roster-changes"
      className="overflow-hidden rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <h3 className="font-jbmono text-[11px] font-bold uppercase tracking-[0.2em] text-pastel-orange-soft">
          On a new club
        </h3>
        <span className="font-jbmono text-[10px] uppercase tracking-[0.14em] text-white/55">
          {shown.length} of {totalChanges}
        </span>
      </div>
      <ul className="divide-y divide-white/5">
        {shown.map((c) => (
          <li key={c.playerId}>
            <button
              type="button"
              onClick={() => onSelect?.(c.playerId)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-pastel-cream">
                  {c.name}
                </span>
                <span className="block truncate font-jbmono text-[10px] uppercase tracking-[0.14em] text-white/55">
                  {c.position} · {c.fromTeam} to {c.toTeam}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {c.projectedFantasyPoints != null && (
                  <span className="block font-jbmono text-[13px] font-black tabular-nums text-pastel-cream">
                    {c.projectedFantasyPoints.toFixed(0)}
                  </span>
                )}
                {c.cohortRank != null && (
                  <span className="block font-jbmono text-[9px] uppercase tracking-[0.14em] text-white/55">
                    {ordinal(c.cohortRank)} {COHORT_LABEL[c.cohort].toLowerCase()}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

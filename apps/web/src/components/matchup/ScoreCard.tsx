import { Calendar } from "lucide-react";
import { CitrusWedge, CitrusSlice, CitrusBurst } from "@/components/icons/CitrusIcons";
import { WinProbabilityBar } from "./WinProbabilityBar";
import { TeamDisc } from "./TeamDisc";
import { winProbabilityFromTotals } from "@/utils/winProbability";

interface ScoreCardProps {
  myTeamName: string;
  myTeamRecord: { wins: number; losses: number };
  opponentTeamName: string;
  opponentTeamRecord: { wins: number; losses: number };
  myTeamPoints: string;
  opponentTeamPoints: string;
  /**
   * Owner's profile picture for each side (the league/teams response joins
   * `profiles.avatar_url` by owner_id — audit M8). The disc falls back to
   * the team's initial when absent or when the image fails to load.
   */
  myTeamAvatarUrl?: string | null;
  opponentTeamAvatarUrl?: string | null;
  myTeamGamesRemaining?: number;
  opponentTeamGamesRemaining?: number;
  /** Today's projected points (starters with a game today). */
  myTeamProjection?: number;
  opponentTeamProjection?: number;
  /**
   * Projected FINAL for the week: points banked + every remaining
   * starter-game's projection (utils/winProbability.computeWinProbability).
   * Renders as "proj 112.4" under each score. Omitted → the line is hidden
   * rather than showing a number that would only be today's slice.
   */
  myTeamExpectedFinal?: number;
  opponentTeamExpectedFinal?: number;
  /**
   * The finals are still being COMPUTED - the week's projections are in
   * flight - as opposed to deliberately absent (a settled week, a dormant
   * schedule, a bye). True only for the first, so the card can hold the
   * line's height open instead of growing under the reader when the numbers
   * land: `proj 112.4` is a 10px line per side, and the card sits above the
   * day strip and the entire lineup, all of which used to jump down with it.
   *
   * Default false, so a caller that does not know keeps today's behaviour:
   * no reserved space, and the same shift it always had.
   */
  expectedFinalsPending?: boolean;
  /**
   * Win chance for the LEFT team, 0–100, from the same computation. When
   * omitted the card derives one from the finals / games-left it has —
   * never from the share of points scored so far, which is not a
   * probability (a 10.5–3.2 Monday lead used to print "77%").
   */
  winProbability?: number;
  /** Matchup UUID for Monte Carlo simulation data */
  matchupId?: string;
  /** Which side of a stored simulation row the LEFT team is (see WinProbabilityBar). */
  simulationPerspective?: 'team1' | 'team2';
  /**
   * True when the LEFT team is the viewer's own team — drives the "YOU"
   * badge and the orange identity accent.
   *
   * This is NOT always true. MatchupService.getMatchupDataById falls back
   * to `team1` as the "userTeam" when the viewer is not in the matchup
   * (league dropdown -> someone else's matchup), so the left side is only
   * genuinely yours when the caller says so. Defaults to false: an
   * unlabelled scorecard is merely neutral, whereas labelling a
   * stranger's team "YOU" is a lie.
   */
  isOwnTeam?: boolean;
  /**
   * The schedule has nothing to play right now — `SeasonStatus.isDormant`
   * from `useSeasonStatus()`, which the PAGE reads and passes down.
   *
   * A prop, not a hook read, in all three matchup header components
   * (ScoreCard, WinProbabilityBar, and the phone's PressBoxScoreBlock). They are handed
   * pre-formatted strings and told what to draw; none of them fetches
   * anything, and putting a React Query call inside one would make a
   * presentational component fail to render outside a QueryClientProvider —
   * which is exactly how every test in `__tests__/` mounts them. The page
   * already owns the matchup's data; the schedule is one more fact it owns.
   *
   * Default false, so a caller that has not been wired up yet and a
   * `phase === 'unknown'` schedule both behave exactly as before: only an
   * affirmative `true` suppresses anything.
   */
  seasonDormant?: boolean;
}

/**
 * "YOU" pill — same treatment as the Standings table's own-team row
 * (bg-pastel-orange/20 + pastel-orange-soft + ring-pastel-orange/40), so
 * "orange means you" reads identically on every screen in the app.
 *
 * Orange is deliberately NOT sage: sage is spoken for by the score
 * cluster, where it means "currently leading" (locked by
 * ScoreCard.test.tsx). Identity and standing are different questions and
 * must not share a colour, or a losing user reads their sage-lit
 * opponent score as their own.
 */
const YouPill = ({ className = '' }: { className?: string }) => (
  <span
    className={`inline-flex items-center bg-pastel-orange/20 text-pastel-orange-soft ring-1 ring-pastel-orange/40 rounded-md font-jbmono uppercase font-bold ${className}`}
  >
    You
  </span>
);

/**
 * "N left" — starter-games still to play. The desktop badge always had it;
 * the mobile header did not, which left phones with no "yet to play" signal
 * at all (audit M2). Own side keeps the orange identity RING (never orange
 * text — the number stays cream), opponent stays muted: same rule as the
 * desktop badge chip it mirrors.
 */
const GamesLeftChip = ({ count, own = false }: { count: number; own?: boolean }) => (
  <span
    className={`inline-flex items-center gap-0.5 bg-white/5 px-1 py-0 rounded-md ring-1 font-jbmono text-[10px] leading-4 whitespace-nowrap ${own ? 'ring-pastel-orange/30' : 'ring-white/10'}`}
  >
    <span className="font-bold text-pastel-cream tabular-nums">{count}</span>
    <span className="text-white/55">left</span>
  </span>
);

/**
 * The same box with nothing in it: `visibility: hidden` keeps the line's
 * height while the projections are still loading, so the score column is
 * the height it will BE. `aria-hidden` because there is nothing to read,
 * and the widest realistic string ("proj 000.0") so the column never
 * changes width either.
 */
const ProjectedFinalSlot = ({ className }: { className: string }) => (
  <div
    aria-hidden="true"
    data-testid="projected-final-slot"
    className={`font-jbmono tabular-nums leading-none whitespace-nowrap invisible ${className}`}
  >
    proj 000.0
  </div>
);

/** "proj 112.4" — projected final under a score. Caller sets the size. */
const ProjectedFinal = ({ value, className }: { value: number; className: string }) => (
  <div className={`font-jbmono text-white/55 tabular-nums leading-none whitespace-nowrap ${className}`}>
    proj {value.toFixed(1)}
  </div>
);

export const ScoreCard = ({
  myTeamName,
  myTeamRecord,
  opponentTeamName,
  opponentTeamRecord,
  myTeamPoints,
  opponentTeamPoints,
  myTeamAvatarUrl,
  opponentTeamAvatarUrl,
  myTeamGamesRemaining = 0,
  opponentTeamGamesRemaining = 0,
  myTeamProjection = 0,
  opponentTeamProjection = 0,
  myTeamExpectedFinal,
  opponentTeamExpectedFinal,
  expectedFinalsPending = false,
  winProbability: winProbabilityProp,
  matchupId,
  simulationPerspective,
  isOwnTeam = false,
  seasonDormant = false,
}: ScoreCardProps) => {
  const myPointsNum = parseFloat(myTeamPoints) || 0;
  const oppPointsNum = parseFloat(opponentTeamPoints) || 0;

  // Projected finals are shown only when the caller computed them for the
  // whole week; today's projection alone would understate every side that
  // still has games later in the week.
  const hasExpectedFinals =
    typeof myTeamExpectedFinal === 'number' && Number.isFinite(myTeamExpectedFinal) &&
    typeof opponentTeamExpectedFinal === 'number' && Number.isFinite(opponentTeamExpectedFinal);

  // Win chance: the page's full computation when supplied, else the same
  // model on what this card knows (finals or today's projections, and
  // games left). Either way it is Φ(margin/σ), never a share of points.
  const winProbability = typeof winProbabilityProp === 'number' && Number.isFinite(winProbabilityProp)
    ? Math.round(Math.min(100, Math.max(0, winProbabilityProp)))
    : Math.round(
        winProbabilityFromTotals({
          myExpectedFinal: hasExpectedFinals ? myTeamExpectedFinal : myPointsNum + myTeamProjection,
          oppExpectedFinal: hasExpectedFinals ? opponentTeamExpectedFinal : oppPointsNum + opponentTeamProjection,
          myGamesLeft: myTeamGamesRemaining,
          oppGamesLeft: opponentTeamGamesRemaining,
        }).probability * 100,
      );

  // "0 LEFT" IS A FACT IN SEASON and noise outside one. Mid-week it says the
  // week is spent and no starter has a game coming, which is the difference
  // between a lead that is safe and one that is not. On 2026-09-02 the count
  // is zero for an unrelated reason — the schedule holds nothing between
  // 2026-06-14 and 2026-09-29 — and the card printed it four times (a chip
  // per side on mobile, a badge per side on desktop) beside a matchup that
  // cannot be played for another 27 days.
  //
  // Zero AND dormant is the only combination with nothing to say. Any
  // non-zero count still renders, and every count renders while the season
  // is live or the schedule is `unknown`, so nothing about the in-season
  // card moves.
  const showsGamesLeft = (count: number) => !(seasonDormant && count === 0);

  const isWinning = myPointsNum > oppPointsNum;
  const isLosing = myPointsNum < oppPointsNum;

  // Identity accent (WHO), kept strictly separate from the score accent
  // (WHO'S AHEAD). When the viewer isn't in this matchup, both sides fall
  // back to the neutral treatment and nothing claims to be "you".
  const myBadgeShell = isOwnTeam
    ? 'bg-pastel-orange/10 ring-1 ring-pastel-orange/40'
    : 'bg-white/5 ring-1 ring-white/10';
  const myNameText = isOwnTeam ? 'text-pastel-orange-soft' : 'text-pastel-cream';

  // The opponent is ALWAYS the muted side. Previously both badges were
  // identical sage patches distinguished only by an "H"/"A" letter, which
  // is the "you can't tell whose team is whose" bug this fixes. The discs
  // themselves (owner avatar → team initial, orange shell = you) are
  // TeamDisc, shared with the sticky bar and the scoreboard strip.
  const oppBadgeShell = 'bg-white/5 ring-1 ring-white/10';

  return (
    <div className="mb-4 md:mb-6 rounded-xl md:rounded-[2rem] bg-[#1A2A20] ring-1 ring-white/10 md:ring-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)] overflow-hidden relative">
      {/* Floating Citrus Decorations - Hidden on mobile */}
      <CitrusSlice className="hidden md:block absolute top-3 right-3 w-8 h-8 text-pastel-sage/10 rotate-12" aria-hidden="true" />
      <CitrusBurst className="hidden md:block absolute bottom-3 left-3 w-10 h-10 text-pastel-sage/10" aria-hidden="true" />

      {/* Mobile: Compact single-row layout — the AT-REST header (audit M8).
          On a phone the page's PressBoxScoreBlock is the compressed
          version of this card (disc · name · score · proj · win chance,
          both sides) and never leaves the screen; this card adds what the
          band has no room for — records, the YOU pill, "N left", the full
          win-chance bar — and scrolls away with the page.
          Identity clusters (avatar · name · record · YOU) stay as they were;
          each score column stacks score / "proj final" / "N left", so what a
          side has banked and what it still has coming read in one glance —
          Sleeper's "projected for and accumulated" header, in Citrus voice.
          The identity clusters have ~40px of text on a phone, so the chip
          lives under the score rather than wrapping the record line. */}
      <div className="md:hidden px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          {/* Team 1 - Compact */}
          <div className={`flex items-center gap-2 min-w-0 flex-1 rounded-lg px-1.5 py-1 ${myBadgeShell}`}>
            <TeamDisc size="md" name={myTeamName} avatarUrl={myTeamAvatarUrl} own={isOwnTeam} />
            <div className="min-w-0">
              <div className={`font-varsity text-[10px] uppercase truncate ${myNameText}`}>{myTeamName}</div>
              <div className="flex items-center gap-1">
                {isOwnTeam && <YouPill className="text-[7px] px-1 py-0 tracking-wide" />}
                <span className="font-mono text-[9px] text-white/55">{myTeamRecord.wins}-{myTeamRecord.losses}</span>
              </div>
            </div>
          </div>

          {/* Scores - Compact: score / proj final / N left per side */}
          <div className="flex items-start gap-2 flex-shrink-0">
            <div className="flex flex-col items-center gap-0.5">
              <div className={`font-varsity text-2xl tabular-nums leading-8 ${isWinning ? 'text-pastel-sage' : 'text-white/70'}`}>{myTeamPoints}</div>
              {hasExpectedFinals
                ? <ProjectedFinal value={myTeamExpectedFinal} className="text-[10px]" />
                : expectedFinalsPending && <ProjectedFinalSlot className="text-[10px]" />}
              {showsGamesLeft(myTeamGamesRemaining) && <GamesLeftChip count={myTeamGamesRemaining} own={isOwnTeam} />}
            </div>
            <span className="text-xs text-white/55 font-bold leading-8">vs</span>
            <div className="flex flex-col items-center gap-0.5">
              <div className={`font-varsity text-2xl tabular-nums leading-8 ${isLosing ? 'text-pastel-sage' : 'text-white/70'}`}>{opponentTeamPoints}</div>
              {hasExpectedFinals
                ? <ProjectedFinal value={opponentTeamExpectedFinal} className="text-[10px]" />
                : expectedFinalsPending && <ProjectedFinalSlot className="text-[10px]" />}
              {showsGamesLeft(opponentTeamGamesRemaining) && <GamesLeftChip count={opponentTeamGamesRemaining} />}
            </div>
          </div>

          {/* Team 2 - Compact */}
          <div className={`flex items-center gap-2 min-w-0 flex-1 justify-end rounded-lg px-1.5 py-1 ${oppBadgeShell}`}>
            <div className="min-w-0 text-right">
              <div className="font-varsity text-[10px] text-pastel-cream uppercase truncate">{opponentTeamName}</div>
              <div className="font-mono text-[9px] text-white/55">{opponentTeamRecord.wins}-{opponentTeamRecord.losses}</div>
            </div>
            <TeamDisc size="md" name={opponentTeamName} avatarUrl={opponentTeamAvatarUrl} />
          </div>
        </div>

        {/* Win chance - Compact (formula, overridden by a fresh simulation row) */}
        <WinProbabilityBar
          matchupId={matchupId}
          fallbackWinProbability={winProbability}
          team1Projected={myTeamProjection}
          team2Projected={opponentTeamProjection}
          simulationPerspective={simulationPerspective}
          seasonDormant={seasonDormant}
          compact
        />
      </div>

      {/* Desktop: Full layout */}
      <div className="hidden md:block relative px-4 py-4 md:px-6 md:py-5 border-b border-white/10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Team 1 Badge - Embroidered patch */}
          <div className={`flex items-center gap-3 p-3 rounded-2xl ${myBadgeShell}`}>
            <TeamDisc size="lg" name={myTeamName} avatarUrl={myTeamAvatarUrl} own={isOwnTeam} />
            <div>
              <div className="flex items-center gap-2">
                <div className={`font-varsity text-sm uppercase ${myNameText}`}>{myTeamName}</div>
                {isOwnTeam && <YouPill className="text-[9px] px-1.5 py-0.5 tracking-wider" />}
              </div>
              <div className="font-mono text-xs text-white/55">{myTeamRecord.wins}-{myTeamRecord.losses}</div>
              {showsGamesLeft(myTeamGamesRemaining) && (
                <div className="flex flex-col gap-0.5 mt-1">
                  {/* Games Remaining */}
                  <div className={`flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded-md ring-1 ${isOwnTeam ? 'ring-pastel-orange/30' : 'ring-white/10'}`}>
                    <Calendar className={`w-2.5 h-2.5 ${isOwnTeam ? 'text-pastel-orange' : 'text-pastel-sage'}`} aria-hidden="true" />
                    <span className="text-[9px] font-varsity font-bold text-pastel-cream tabular-nums">
                      {myTeamGamesRemaining}
                    </span>
                    <span className="text-[8px] font-display text-white/55">
                      left
                    </span>
                    <CitrusWedge className={`w-2 h-2 opacity-60 ${isOwnTeam ? 'text-pastel-orange' : 'text-pastel-sage'}`} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Center scores with stitched divider */}
          <div className="flex items-center gap-6 relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-cream font-script text-xl px-3 py-1 rounded-varsity shadow-patch">
              vs
            </div>
            <div className="text-center">
              <div className={`font-varsity text-6xl tabular-nums ${isWinning ? 'text-pastel-sage' : 'text-white/70'}`}>{myTeamPoints}</div>
              {hasExpectedFinals
                ? <ProjectedFinal value={myTeamExpectedFinal} className="mt-1 text-[11px]" />
                : expectedFinalsPending && <ProjectedFinalSlot className="mt-1 text-[11px]" />}
            </div>
            <div className="w-1 h-20 border-l-2 border-dashed border-white/10"></div>
            <div className="text-center">
              <div className={`font-varsity text-6xl tabular-nums ${isLosing ? 'text-pastel-sage' : 'text-white/70'}`}>{opponentTeamPoints}</div>
              {hasExpectedFinals
                ? <ProjectedFinal value={opponentTeamExpectedFinal} className="mt-1 text-[11px]" />
                : expectedFinalsPending && <ProjectedFinalSlot className="mt-1 text-[11px]" />}
            </div>
          </div>

          {/* Team 2 Badge */}
          <div className={`flex items-center gap-3 p-3 rounded-2xl ${oppBadgeShell}`}>
            <div>
              <div className="font-varsity text-sm text-pastel-cream uppercase text-right">{opponentTeamName}</div>
              <div className="font-mono text-xs text-white/55 text-right">{opponentTeamRecord.wins}-{opponentTeamRecord.losses}</div>
              {showsGamesLeft(opponentTeamGamesRemaining) && (
                <div className="flex flex-col gap-0.5 mt-1 items-end">
                  {/* Games Remaining */}
                  <div className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded-md ring-1 ring-white/10">
                    <CitrusWedge className="w-2 h-2 text-pastel-sage opacity-60" />
                    <span className="text-[8px] font-display text-white/55">
                      left
                    </span>
                    <span className="text-[9px] font-varsity font-bold text-pastel-cream tabular-nums">
                      {opponentTeamGamesRemaining}
                    </span>
                    <Calendar className="w-2.5 h-2.5 text-pastel-sage" aria-hidden="true" />
                  </div>
                </div>
              )}
            </div>
            <TeamDisc size="lg" name={opponentTeamName} avatarUrl={opponentTeamAvatarUrl} />
          </div>
        </div>
      </div>

      {/* Win chance - Desktop (formula, overridden by a fresh simulation row) */}
      <div className="hidden md:block">
        <WinProbabilityBar
          matchupId={matchupId}
          fallbackWinProbability={winProbability}
          team1Projected={myTeamProjection}
          team2Projected={opponentTeamProjection}
          simulationPerspective={simulationPerspective}
          seasonDormant={seasonDormant}
        />
      </div>
    </div>
  );
};

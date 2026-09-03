import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TeamDisc } from './TeamDisc';

/**
 * STICKY SCORE BAR — the phone's one-band matchup header (2026-09-01,
 * Sleeper parity audit M8).
 *
 * ESPN pins the scores at the top while you scroll; Sleeper's header is one
 * dense, legible band with the manager's avatar, name, score and projection
 * on each side and the win chance across it. Citrus's mobile chrome used to
 * stack four deep before the first player row — a sticky bar with two bare
 * numbers, the ScoreCard, the day strip's "Week Overview" bar and the
 * lineup's team header — and the only thing that survived a scroll was the
 * bar with the least on it.
 *
 * This is the compressed header. In 56px it carries, on BOTH sides:
 *
 *   disc · name · win chance          score · proj final
 *
 * mirrored so each side's number meets the centre, plus a hairline
 * win-chance bar along the bottom edge (sage = the left team's share, the
 * same number the ScoreCard's bar shows). The ScoreCard below is the
 * at-rest version with the records, the YOU pill, "N left" and the full
 * bar; this band is what never leaves the screen.
 *
 * Colour follows the page's identity ≠ standing rule (ScoreCard tests):
 *   orange  = YOU        — the disc shell and the name on the viewer's side
 *   sage    = AHEAD      — the leading score, the bar's filled share
 *   cream / white-70     — everything else; numbers in jbmono + tabular figures
 * The old bar painted the viewer's SCORE orange, which is the leak the
 * ScoreCard contract forbids: a losing viewer read their sage-lit
 * opponent as themselves. Identity lives on the disc and the name now.
 *
 * The page's MobileMenuButton comes in through `menu` so the button stays
 * inside the sticky header (mobileHeaderMenuGuard's contract) without this
 * component knowing about navigation.
 */

export interface StickyScoreBarProps {
  /** Week number for the centre eyebrow; omitted → "VS". */
  week?: number;
  myTeamName: string;
  /** Points banked so far, already formatted ("112.4"). */
  myTeamPoints: string;
  /** Projected final for the week (points + remaining projections); hidden when absent. */
  myTeamExpectedFinal?: number | null;
  /** Owner's profile picture; the disc falls back to the team initial. */
  myTeamAvatarUrl?: string | null;
  opponentTeamName: string;
  opponentTeamPoints: string;
  opponentTeamExpectedFinal?: number | null;
  opponentTeamAvatarUrl?: string | null;
  /**
   * Win chance for the LEFT team, 0–100. The right side shows the
   * complement. Omitted while the page cannot yet say (lineups or
   * projections still loading) — the line is hidden, never "—".
   */
  winProbability?: number | null;
  /**
   * Nothing left to play: the chances and the projections come down. Note
   * what this does NOT mean on its own — see `seasonDormant` and the
   * `showFinal` derivation below for why it stopped being enough to print
   * the word "Final".
   */
  settled?: boolean;
  /**
   * The schedule has nothing to play right now (`SeasonStatus.isDormant`),
   * read by the page and passed down — same contract, and the same
   * prop-not-a-hook reasoning, as ScoreCard's prop of the same name.
   */
  seasonDormant?: boolean;
  /** True only when the LEFT team is the viewer's own (see ScoreCard's prop note). */
  isOwnTeam?: boolean;
  /** The page's MobileMenuButton, rendered at the trailing edge. */
  menu?: ReactNode;
  className?: string;
}

/**
 * Numbers in the mono face with tabular figures; the WORDS beside them
 * ("proj", "win") in the display face — the scoreboard strip's rule. On a
 * 375px phone each side has ~136px for disc · name · score · two labels;
 * a mono "proj 118.3" is 60px, the mixed one ~52px, and those 8px are two
 * more letters of the team name before it truncates.
 */
const NUMBER = 'font-jbmono tabular-nums';
const WORD = 'font-display';

interface SideProps {
  side: 'left' | 'right';
  name: string;
  points: string;
  expectedFinal?: number | null;
  avatarUrl?: string | null;
  own: boolean;
  leading: boolean;
  /** This side's own win chance, 0–100, or null to hide. */
  winChance: number | null;
}

const Side = ({ side, name, points, expectedFinal, avatarUrl, own, leading, winChance }: SideProps) => {
  const mirrored = side === 'right';
  const hasFinal = typeof expectedFinal === 'number' && Number.isFinite(expectedFinal);
  return (
    <div
      data-testid={`sticky-score-${side}`}
      data-own={own || undefined}
      className={cn('flex items-center gap-1 min-w-0 flex-1', mirrored && 'flex-row-reverse')}
    >
      <TeamDisc size="sm" name={name} avatarUrl={avatarUrl} own={own} />
      <div className={cn('min-w-0 flex-1 leading-none', mirrored && 'text-right')}>
        <div
          className={cn(
            'truncate text-[11px] font-semibold leading-4',
            WORD,
            own ? 'text-pastel-orange-soft' : 'text-pastel-cream',
          )}
          title={name}
        >
          {name}
        </div>
        {winChance !== null && (
          <div
            data-testid="sticky-score-chance"
            className="text-[10px] leading-4 text-white/70 whitespace-nowrap"
          >
            <span className={NUMBER}>{winChance}%</span>
            <span className={WORD}> win</span>
          </div>
        )}
      </div>
      <div className={cn('flex flex-col flex-shrink-0 leading-none', mirrored ? 'items-start' : 'items-end')}>
        <span
          data-testid="sticky-score-points"
          data-leading={leading || undefined}
          className={cn(
            'font-calistoga text-base leading-5',
            NUMBER,
            leading ? 'text-pastel-sage' : 'text-white/70',
          )}
        >
          {points}
        </span>
        {hasFinal && (
          <span
            data-testid="sticky-score-proj"
            className="text-[10px] leading-4 text-white/55 whitespace-nowrap"
          >
            <span className={WORD}>proj </span>
            <span className={NUMBER}>{expectedFinal.toFixed(1)}</span>
          </span>
        )}
      </div>
    </div>
  );
};

const toPoints = (value: string): number => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

export function StickyScoreBar({
  week,
  myTeamName,
  myTeamPoints,
  myTeamExpectedFinal,
  myTeamAvatarUrl,
  opponentTeamName,
  opponentTeamPoints,
  opponentTeamExpectedFinal,
  opponentTeamAvatarUrl,
  winProbability,
  settled = false,
  seasonDormant = false,
  isOwnTeam = false,
  menu,
  className,
}: StickyScoreBarProps) {
  const my = toPoints(myTeamPoints);
  const opp = toPoints(opponentTeamPoints);

  // "FINAL" MEANS PLAYED AND OVER — and `settled` alone stopped carrying
  // that. It arrives from `winProbabilityFromTotals`, which sets
  // `settled: true` on its `variance <= 0` branch: no games left to add
  // variance. In-season that branch means the week is spent. On 2026-09-02
  // it means no game was ever scheduled inside the week, and the band read
  //
  //     0.0    Wk 1 / Final    0.0
  //
  // over a matchup nobody has played.
  //
  // The distinction that holds in both directions is the scoreboard itself:
  // a week that was played leaves points behind. So the word is withheld
  // only when the schedule is dormant AND neither side has scored — which
  // keeps February honest, where an All-Star break sets `isDormant` while a
  // 96.1–88.4 week genuinely is final. `phase === 'unknown'` never reaches
  // here: it leaves `isDormant` false and the bar behaves as it always has.
  const neverPlayed = seasonDormant && my === 0 && opp === 0;
  const showFinal = settled && !neverPlayed;

  const hasChance = !settled && typeof winProbability === 'number' && Number.isFinite(winProbability);
  const leftChance = hasChance ? Math.round(Math.min(100, Math.max(0, winProbability))) : null;
  const rightChance = leftChance === null ? null : 100 - leftChance;

  return (
    <div
      data-testid="sticky-score-bar"
      data-settled={settled || undefined}
      className={cn('relative flex items-center h-14 px-3 gap-1.5', className)}
    >
      <Side
        side="left"
        name={myTeamName}
        points={myTeamPoints}
        expectedFinal={settled ? null : myTeamExpectedFinal}
        avatarUrl={myTeamAvatarUrl}
        own={isOwnTeam}
        leading={my > opp}
        winChance={leftChance}
      />

      {/* Centre: the week, and "Final" once the week is decided. */}
      <div className="flex flex-col items-center px-1 flex-shrink-0 leading-none">
        <span className="font-jbmono text-[10px] font-bold text-white/55 uppercase tracking-wider whitespace-nowrap">
          {typeof week === 'number' && week > 0 ? `Wk ${week}` : 'VS'}
        </span>
        {showFinal && (
          <span data-testid="sticky-score-final" className="font-jbmono text-[10px] font-bold text-pastel-cream uppercase tracking-wider">
            Final
          </span>
        )}
      </div>

      <Side
        side="right"
        name={opponentTeamName}
        points={opponentTeamPoints}
        expectedFinal={settled ? null : opponentTeamExpectedFinal}
        avatarUrl={opponentTeamAvatarUrl}
        own={false}
        leading={opp > my}
        winChance={rightChance}
      />

      {menu && <div className="flex-shrink-0 -mr-1">{menu}</div>}

      {/* Hairline win-chance bar: sage = the left team's share, the same
          number the ScoreCard's bar shows. Inside the 56px box so the
          lineup's sticky team header (top: 3.5rem) still tucks under. */}
      {leftChance !== null && (
        <div
          aria-hidden="true"
          data-testid="sticky-score-chance-bar"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-pastel-sage/15"
        >
          <div className="h-full bg-pastel-sage transition-[width] duration-700 ease-out" style={{ width: `${leftChance}%` }} />
        </div>
      )}
    </div>
  );
}

export default StickyScoreBar;

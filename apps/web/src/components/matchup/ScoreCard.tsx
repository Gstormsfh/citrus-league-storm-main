import { Calendar } from "lucide-react";
import { CitrusWedge, CitrusSparkle, CitrusSlice, CitrusBurst } from "@/components/icons/CitrusIcons";
import { Badge } from "@/components/ui/badge";
import { WinProbabilityBar } from "./WinProbabilityBar";

interface ScoreCardProps {
  myTeamName: string;
  myTeamRecord: { wins: number; losses: number };
  opponentTeamName: string;
  opponentTeamRecord: { wins: number; losses: number };
  myTeamPoints: string;
  opponentTeamPoints: string;
  myTeamGamesRemaining?: number;
  opponentTeamGamesRemaining?: number;
  myTeamProjection?: number;
  opponentTeamProjection?: number;
  /** Matchup UUID for Monte Carlo simulation data */
  matchupId?: string;
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
}

/** First initial of a team name, for the badge avatar. */
const initialOf = (name: string): string => {
  const ch = (name || '').trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
};

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

export const ScoreCard = ({
  myTeamName,
  myTeamRecord,
  opponentTeamName,
  opponentTeamRecord,
  myTeamPoints,
  opponentTeamPoints,
  myTeamGamesRemaining = 0,
  opponentTeamGamesRemaining = 0,
  myTeamProjection = 0,
  opponentTeamProjection = 0,
  matchupId,
  isOwnTeam = false,
}: ScoreCardProps) => {
  // Calculate win probability based on scores and projections
  const myPointsNum = parseFloat(myTeamPoints) || 0;
  const oppPointsNum = parseFloat(opponentTeamPoints) || 0;
  const totalPoints = myPointsNum + oppPointsNum;

  // If no scores yet, use projections for win probability
  let winProbability = 50;
  if (totalPoints > 0) {
    winProbability = Math.round((myPointsNum / totalPoints) * 100);
  } else if (myTeamProjection > 0 || opponentTeamProjection > 0) {
    const totalProjection = myTeamProjection + opponentTeamProjection;
    winProbability = totalProjection > 0 ? Math.round((myTeamProjection / totalProjection) * 100) : 50;
  }

  const isWinning = myPointsNum > oppPointsNum;
  const isLosing = myPointsNum < oppPointsNum;
  const isTied = Math.abs(myPointsNum - oppPointsNum) < 0.01;

  // Identity accent (WHO), kept strictly separate from the score accent
  // (WHO'S AHEAD). When the viewer isn't in this matchup, both sides fall
  // back to the neutral treatment and nothing claims to be "you".
  const myBadgeShell = isOwnTeam
    ? 'bg-pastel-orange/10 ring-1 ring-pastel-orange/40'
    : 'bg-white/5 ring-1 ring-white/10';
  const myAvatarShell = isOwnTeam
    ? 'bg-pastel-orange/20 ring-2 ring-pastel-orange/50'
    : 'bg-white/5 ring-1 ring-white/15';
  const myAvatarText = isOwnTeam ? 'text-pastel-orange-soft' : 'text-pastel-cream';
  const myNameText = isOwnTeam ? 'text-pastel-orange-soft' : 'text-pastel-cream';

  // The opponent is ALWAYS the muted side. Previously both badges were
  // identical sage patches distinguished only by an "H"/"A" letter, which
  // is the "you can't tell whose team is whose" bug this fixes.
  const oppBadgeShell = 'bg-white/5 ring-1 ring-white/10';
  const oppAvatarShell = 'bg-white/5 ring-1 ring-white/15';

  return (
    <div className="mb-4 md:mb-6 rounded-xl md:rounded-[2rem] bg-[#1A2A20] ring-1 ring-white/10 md:ring-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)] overflow-hidden relative">
      {/* Floating Citrus Decorations - Hidden on mobile */}
      <CitrusSlice className="hidden md:block absolute top-3 right-3 w-8 h-8 text-pastel-sage/10 rotate-12" aria-hidden="true" />
      <CitrusBurst className="hidden md:block absolute bottom-3 left-3 w-10 h-10 text-pastel-sage/10" aria-hidden="true" />

      {/* Mobile: Compact single-row layout */}
      <div className="md:hidden px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          {/* Team 1 - Compact */}
          <div className={`flex items-center gap-2 min-w-0 flex-1 rounded-lg px-1.5 py-1 ${myBadgeShell}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${myAvatarShell}`}>
              <span className={`font-varsity text-xs ${myAvatarText}`}>{initialOf(myTeamName)}</span>
            </div>
            <div className="min-w-0">
              <div className={`font-varsity text-[10px] uppercase truncate ${myNameText}`}>{myTeamName}</div>
              <div className="flex items-center gap-1">
                {isOwnTeam && <YouPill className="text-[7px] px-1 py-0 tracking-wide" />}
                <span className="font-mono text-[9px] text-white/55">{myTeamRecord.wins}-{myTeamRecord.losses}</span>
              </div>
            </div>
          </div>

          {/* Scores - Compact */}
          <div className="flex items-center gap-2">
            <div className={`font-varsity text-2xl tabular-nums ${isWinning ? 'text-pastel-sage' : 'text-white/70'}`}>{myTeamPoints}</div>
            <span className="text-xs text-white/55 font-bold">vs</span>
            <div className={`font-varsity text-2xl tabular-nums ${isLosing ? 'text-pastel-sage' : 'text-white/70'}`}>{opponentTeamPoints}</div>
          </div>

          {/* Team 2 - Compact */}
          <div className={`flex items-center gap-2 min-w-0 flex-1 justify-end rounded-lg px-1.5 py-1 ${oppBadgeShell}`}>
            <div className="min-w-0 text-right">
              <div className="font-varsity text-[10px] text-pastel-cream uppercase truncate">{opponentTeamName}</div>
              <div className="font-mono text-[9px] text-white/55">{opponentTeamRecord.wins}-{opponentTeamRecord.losses}</div>
            </div>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${oppAvatarShell}`}>
              <span className="font-varsity text-xs text-pastel-cream">{initialOf(opponentTeamName)}</span>
            </div>
          </div>
        </div>

        {/* Win probability - Compact (Monte Carlo powered) */}
        <WinProbabilityBar
          matchupId={matchupId}
          fallbackWinProbability={winProbability}
          team1Projected={myTeamProjection}
          team2Projected={opponentTeamProjection}
          compact
        />
      </div>

      {/* Desktop: Full layout */}
      <div className="hidden md:block relative px-4 py-4 md:px-6 md:py-5 border-b border-white/10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Team 1 Badge - Embroidered patch */}
          <div className={`flex items-center gap-3 p-3 rounded-2xl ${myBadgeShell}`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)] ${myAvatarShell}`}>
              <span className={`font-varsity text-xl ${myAvatarText}`}>{initialOf(myTeamName)}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <div className={`font-varsity text-sm uppercase ${myNameText}`}>{myTeamName}</div>
                {isOwnTeam && <YouPill className="text-[9px] px-1.5 py-0.5 tracking-wider" />}
              </div>
              <div className="font-mono text-xs text-white/55">{myTeamRecord.wins}-{myTeamRecord.losses}</div>
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
            </div>
          </div>

          {/* Center scores with stitched divider */}
          <div className="flex items-center gap-6 relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-cream font-script text-xl px-3 py-1 rounded-varsity shadow-patch">
              vs
            </div>
            <div className="text-center">
              <div className={`font-varsity text-6xl tabular-nums ${isWinning ? 'text-pastel-sage' : 'text-white/70'}`}>{myTeamPoints}</div>
            </div>
            <div className="w-1 h-20 border-l-2 border-dashed border-white/10"></div>
            <div className="text-center">
              <div className={`font-varsity text-6xl tabular-nums ${isLosing ? 'text-pastel-sage' : 'text-white/70'}`}>{opponentTeamPoints}</div>
            </div>
          </div>

          {/* Team 2 Badge */}
          <div className={`flex items-center gap-3 p-3 rounded-2xl ${oppBadgeShell}`}>
            <div>
              <div className="font-varsity text-sm text-pastel-cream uppercase text-right">{opponentTeamName}</div>
              <div className="font-mono text-xs text-white/55 text-right">{opponentTeamRecord.wins}-{opponentTeamRecord.losses}</div>
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
            </div>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)] ${oppAvatarShell}`}>
              <span className="font-varsity text-xl text-pastel-cream">{initialOf(opponentTeamName)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Win probability - Desktop (Monte Carlo powered) */}
      <div className="hidden md:block">
        <WinProbabilityBar
          matchupId={matchupId}
          fallbackWinProbability={winProbability}
          team1Projected={myTeamProjection}
          team2Projected={opponentTeamProjection}
        />
      </div>
    </div>
  );
};

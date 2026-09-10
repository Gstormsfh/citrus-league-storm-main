/**
 * Roster depth grading for the Team Intel hub. Pure; see TeamIntelHub.tsx
 * for the fetches that feed it.
 */

// Strength and grade: this team's projected points PER PLAYER at the
// position against the league's per-player average at the same position
// (getLeagueAverageProjections is per player). Before 2026-09-10 the team
// TOTAL was divided by the per-player average, and a league average of 0
// (preseason, no projections yet) was clamped to 1, so every position on
// every roster read "Weak (C)" until opening night.
export const calculateStrength = (
  position: string,
  teamPerPlayer: number,
  leagueAverage: number,
): { strength: 'Elite' | 'Good' | 'Average' | 'Weak'; grade: string } => {
  if (!(leagueAverage > 0) || !Number.isFinite(teamPerPlayer)) {
    // No projections to compare against: say nothing rather than guess.
    return { strength: 'Average', grade: '–' };
  }
  const ratio = teamPerPlayer / leagueAverage;

  if (ratio >= 1.25) return { strength: 'Elite', grade: 'A+' };
  if (ratio >= 1.0) return { strength: 'Good', grade: 'A' };
  if (ratio >= 0.75) return { strength: 'Average', grade: 'B' };
  return { strength: 'Weak', grade: 'C' };
};

/** The positions a roster is graded on: F/D/G leagues fold C, LW and RW into F. */
export const depthPositionsFor = (positionType: unknown): string[] =>
  positionType === 'forward' ? ['F', 'D', 'G'] : ['C', 'LW', 'RW', 'D', 'G'];

export const isForward = (pos: string): boolean => pos === 'C' || pos === 'LW' || pos === 'RW';

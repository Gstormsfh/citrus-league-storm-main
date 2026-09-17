import type { createUserClient } from './supabase';
import { AppError } from './errors';

type UserClient = ReturnType<typeof createUserClient>;

export interface VisibleMatchup {
  team1_id: string;
  team2_id: string | null;
}

/**
 * IDOR guard for routes whose service methods use getSupabaseAdmin().
 *
 * Several matchup/roster service methods resolve the matchup on the
 * service-role client so that AI-team rows (owner_id NULL) stay visible. That
 * bypasses RLS on `matchups`, `team_lineups` and `fantasy_daily_rosters`, and
 * some of them also WRITE (backfill / ensure-rosters persist default lineups;
 * daily-scores persists fantasy_matchup_lines). Without this check any
 * signed-in user who learns a matchup UUID could read both teams' frozen
 * lineups for any league, and trigger roster/score persistence for a league
 * they have never joined.
 *
 * The lookup deliberately uses the CALLER's token so the `matchups` SELECT
 * policy ("Users can view matchups in their leagues": commissioner or team
 * owner) is the gate. A caller outside the league gets no row back and the
 * route answers 404 before any admin-client work runs. A lookup failure is
 * surfaced as an error rather than treated as "not visible" so an outage does
 * not masquerade as a missing matchup.
 */
export async function assertMatchupVisible(
  supabase: UserClient,
  matchupId: string,
): Promise<{ matchup: VisibleMatchup | null; error: AppError | null }> {
  const { data, error } = await supabase
    .from('matchups')
    .select('team1_id, team2_id')
    .eq('id', matchupId)
    .maybeSingle();

  if (error) {
    return { matchup: null, error: AppError.internal('Failed to verify matchup visibility') };
  }
  if (!data) {
    return { matchup: null, error: AppError.notFound('Matchup') };
  }
  return { matchup: { team1_id: data.team1_id, team2_id: data.team2_id ?? null }, error: null };
}

/**
 * Same gate, then pins the request to the two teams actually in that
 * matchup, so membership in one league cannot be traded for a read of
 * another league's team by pairing a visible matchupId with a foreign teamId.
 */
export async function assertMatchupTeamVisible(
  supabase: UserClient,
  matchupId: string,
  teamId: string,
): Promise<AppError | null> {
  const { matchup, error } = await assertMatchupVisible(supabase, matchupId);
  if (error) return error;
  if (teamId !== matchup!.team1_id && teamId !== matchup!.team2_id) {
    return AppError.forbidden('That team is not in this matchup');
  }
  return null;
}

/**
 * The anonymous session.
 *
 * NO LOGIN BEFORE FIRST PLAY is a hard constraint, and it is not the same as
 * "no identity". A player needs an identity the moment they finish a puzzle,
 * because that is when a result and its points get written — so the session
 * is created lazily, on the first completed game, and never on page load.
 * Opening the suite to look at it costs nothing and creates no auth row.
 *
 * WHY SUPABASE ANONYMOUS SIGN-IN rather than an opaque id of our own: it
 * produces a real `auth.users` row, so `auth.uid()` works and every RLS
 * policy on the Game Day tables is the ordinary kind rather than a bespoke
 * one. `server/src/middleware/auth.ts` already accepts these tokens
 * (`verifyAccessToken.test.ts` pins `is_anonymous: true`), so nothing on the
 * server needed teaching.
 *
 * UPGRADING AT PRIZE CLAIM keeps the same user id. `linkIdentity` /
 * `updateUser` attach an email to the existing anonymous user rather than
 * creating a second one, so the points ledger and every play row stay
 * exactly where they are. There is no merge step to get wrong, which is the
 * entire reason for choosing this over a session table.
 */
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { gameDayDb } from '@/lib/gameDay/db';

let inFlight: Promise<string | null> | null = null;

/**
 * Returns a user id, creating an anonymous one if there is no session.
 *
 * Concurrent callers share one request: finishing a puzzle can fire the
 * submit and the ledger refresh at the same moment, and two parallel
 * `signInAnonymously` calls would create two users and split the player's
 * points between them.
 */
export async function ensureGameDaySession(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user?.id) return data.session.user.id;

  if (!inFlight) {
    inFlight = supabase.auth
      .signInAnonymously()
      .then(({ data: created, error }) => {
        if (error) {
          // Anonymous sign-ins can be disabled in the Supabase dashboard, and
          // the failure must be legible rather than a silent dead submit.
          logger.error('Game Day: anonymous sign-in failed', error);
          return null;
        }
        return created.user?.id ?? null;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** The current user id without creating one. Null before the first play. */
export async function currentGameDayUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function isAnonymousPlayer(): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  // `is_anonymous` is absent on older sessions; absent means a real account.
  return Boolean((data.user as { is_anonymous?: boolean } | null)?.is_anonymous);
}

export interface GameDayTotals {
  totalPoints: number;
  gamesPlayed: number;
}

/** The cross-game ledger total. Returns zeroes for a player with no session. */
export async function fetchGameDayTotals(): Promise<GameDayTotals> {
  const userId = await currentGameDayUserId();
  if (!userId) return { totalPoints: 0, gamesPlayed: 0 };

  const { data, error } = await gameDayDb()
    .from('game_day_points_ledger')
    .select('points')
    .eq('user_id', userId);

  if (error) {
    logger.error('Game Day: could not read the points ledger', error);
    return { totalPoints: 0, gamesPlayed: 0 };
  }

  const rows = data ?? [];
  return {
    totalPoints: rows.reduce((sum, row) => sum + (row.points ?? 0), 0),
    gamesPlayed: rows.length,
  };
}

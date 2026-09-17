import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { validateBody, getValidatedBody } from '../middleware/validate';
import { createUserClient, getSupabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { AuditService } from '../services/AuditService';

/**
 * AUTODRAFT THAT SURVIVES A CLOSED TAB (2026-09-14).
 *
 * The v2 room's AUTODRAFT toggle used to live in localStorage and fire from
 * the browser. The flag is now `teams.autodraft_enabled`; the engine reads
 * it when the seat comes on the clock (LobbyManager.
 * refreshAutodraftForOnClockTeam) and arms the instant-autopick window.
 *
 * Only the team's owner may set it. Membership middleware gates the league;
 * the ownership check below gates the team, on the caller's own client so
 * RLS on `teams` is the second line. The write goes through the admin client
 * after that check so a future tightening of the teams UPDATE policy cannot
 * silently break the toggle.
 */
const draftV2AutodraftRoutes = new Hono<Env>();
draftV2AutodraftRoutes.use('*', authMiddleware);

const autodraftBody = z.object({ enabled: z.boolean() });

async function assertOwnsTeam(c: Context<Env>, leagueId: string, teamId: string) {
  const supabase = createUserClient(c.get('userToken'));
  const { data, error } = await supabase
    .from('teams')
    .select('id, owner_id, autodraft_enabled')
    .eq('id', teamId)
    .eq('league_id', leagueId)
    .maybeSingle();
  if (error) return { error: AppError.internal('Failed to verify team ownership'), team: null };
  if (!data) return { error: AppError.notFound('Team'), team: null };
  if (data.owner_id !== c.get('userId')) return { error: AppError.forbidden('Only the team owner can change autodraft'), team: null };
  return { error: null, team: data as { id: string; owner_id: string; autodraft_enabled: boolean | null } };
}

// GET /api/draft/v2/league/:leagueId/teams/:teamId/autodraft
draftV2AutodraftRoutes.get('/league/:leagueId/teams/:teamId/autodraft', membershipMiddleware, async (c) => {
  const { error, team } = await assertOwnsTeam(c, c.req.param('leagueId'), c.req.param('teamId'));
  if (error) return fail(c, error);
  return ok(c, { enabled: team!.autodraft_enabled === true });
});

// PUT /api/draft/v2/league/:leagueId/teams/:teamId/autodraft  { enabled }
draftV2AutodraftRoutes.put(
  '/league/:leagueId/teams/:teamId/autodraft',
  membershipMiddleware,
  validateBody(autodraftBody),
  async (c) => {
    const leagueId = c.req.param('leagueId');
    const teamId = c.req.param('teamId');
    const { enabled } = getValidatedBody<z.infer<typeof autodraftBody>>(c);
    const { error } = await assertOwnsTeam(c, leagueId, teamId);
    if (error) return fail(c, error);

    const admin = getSupabaseAdmin();
    const { error: updateError } = await admin
      .from('teams')
      .update({ autodraft_enabled: enabled })
      .eq('id', teamId)
      .eq('league_id', leagueId);
    if (updateError) return handleError(c, updateError, 'Failed to update autodraft');

    void new AuditService(admin).log('DRAFT_AUTODRAFT_TOGGLED', leagueId, {
      teamId, enabled, userId: c.get('userId'),
    });
    return ok(c, { enabled });
  },
);

export { draftV2AutodraftRoutes };

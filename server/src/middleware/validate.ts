import { Context, Next } from 'hono';
import { z, ZodSchema, ZodError } from 'zod';

/**
 * Request validation middleware using Zod schemas.
 *
 * Usage:
 *   import { validateBody, validateQuery } from '../middleware/validate';
 *   import { z } from 'zod';
 *
 *   const createLeagueSchema = z.object({
 *     name: z.string().min(1).max(100),
 *     roster_size: z.number().int().min(1).max(30).optional(),
 *   });
 *
 *   leagueRoutes.post('/', validateBody(createLeagueSchema), async (c) => {
 *     const body = c.get('validatedBody');
 *     // body is typed and validated
 *   });
 */

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}

/**
 * Validate the JSON request body against a Zod schema.
 * Sets `validatedBody` on the Hono context.
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json(
        { error: 'Validation failed', details: formatZodError(result.error) },
        400,
      );
    }

    c.set('validatedBody' as any, result.data);
    await next();
  };
}

/**
 * Validate query parameters against a Zod schema.
 * Sets `validatedQuery` on the Hono context.
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    const query: Record<string, string> = {};
    const url = new URL(c.req.url);
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const result = schema.safeParse(query);
    if (!result.success) {
      return c.json(
        { error: 'Invalid query parameters', details: formatZodError(result.error) },
        400,
      );
    }

    c.set('validatedQuery' as any, result.data);
    await next();
  };
}

// ========================================
// Shared validation schemas for mutations
// ========================================

export const schemas = {
  // League creation
  createLeague: z.object({
    name: z.string().min(1, 'League name is required').max(100),
    roster_size: z.number().int().min(1).max(30).optional(),
    draft_rounds: z.number().int().min(1).max(30).optional(),
    settings: z.record(z.unknown()).optional(),
    scoring_settings: z.record(z.unknown()).optional(),
    waiver_settings: z.record(z.unknown()).optional(),
  }),

  // Join league
  joinLeague: z.object({
    joinCode: z.string().min(1, 'Join code is required'),
    teamName: z.string().min(1).max(100).optional(),
  }),

  // Draft pick
  makeDraftPick: z.object({
    playerId: z.string().min(1, 'playerId is required'),
    teamId: z.union([z.string(), z.number()]),
    pickNumber: z.number().int().optional(),
    roundNumber: z.number().int().optional(),
    draftSessionId: z.string().optional(),
    teamsCount: z.number().int().optional(),
  }),

  // Trade creation
  createTrade: z.object({
    fromTeamId: z.union([z.string(), z.number()]),
    toTeamId: z.union([z.string(), z.number()]),
    offeredPlayerIds: z.array(z.string()).min(1, 'Must offer at least one player'),
    requestedPlayerIds: z.array(z.string()).min(1, 'Must request at least one player'),
    message: z.string().max(500).optional(),
  }),

  // Waiver claim
  submitWaiverClaim: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.string().min(1, 'playerId is required'),
    dropPlayerId: z.string().nullable().optional(),
  }),

  // FAAB bid
  submitFAABBid: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.string().min(1, 'playerId is required'),
    bidAmount: z.number().int().min(0, 'Bid amount must be non-negative'),
    dropPlayerId: z.string().nullable().optional(),
    isConditionalDrop: z.boolean().optional(),
  }),

  // Free agent add
  addFreeAgent: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.string().min(1, 'playerId is required'),
    dropPlayerId: z.string().nullable().optional(),
  }),

  // Stormy chat
  stormyChat: z.object({
    message: z.string().min(1, 'Message is required').max(2000),
    leagueId: z.string().optional(),
    context: z.record(z.unknown()).optional(),
  }),

  // Lineup update
  updateLineup: z.object({
    starters: z.array(z.string()).optional(),
    bench: z.array(z.string()).optional(),
    ir: z.array(z.string()).optional(),
    slot_assignments: z.record(z.unknown()).optional(),
  }),

  // Trade vote
  tradeVote: z.object({
    voterTeamId: z.union([z.string(), z.number()]),
    vote: z.enum(['approve', 'veto']),
  }),

  // Commissioner decision
  commissionerDecision: z.object({
    leagueId: z.string().min(1),
    decision: z.enum(['approve', 'veto']),
  }),
};

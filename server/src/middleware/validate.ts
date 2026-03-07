import { Context, Next } from 'hono';
import { z, ZodSchema, ZodError } from 'zod';

/**
 * Request validation middleware using Zod schemas.
 */

/** Type-safe accessor for validated body set by validateBody middleware */
export function getValidatedBody<T>(c: Context): T {
  return (c as unknown as { get(key: 'validatedBody'): T }).get('validatedBody');
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}

/** Validate JSON request body against a Zod schema. Sets `validatedBody` on context. */
export function validateBody<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: formatZodError(result.error) } }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono context doesn't support custom keys natively
    (c as any).set('validatedBody', result.data);
    await next();
  };
}

/** Validate query parameters against a Zod schema. Sets `validatedQuery` on context. */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    const query: Record<string, string> = {};
    const url = new URL(c.req.url);
    url.searchParams.forEach((value, key) => { query[key] = value; });

    const result = schema.safeParse(query);
    if (!result.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: formatZodError(result.error) } }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono context doesn't support custom keys natively
    (c as any).set('validatedQuery', result.data);
    await next();
  };
}

// ── Shared validation schemas for mutations ──────────────────────────

export const schemas = {
  createLeague: z.object({
    name: z.string().min(1, 'League name is required').max(100),
    roster_size: z.number().int().min(1).max(30).optional(),
    draft_rounds: z.number().int().min(1).max(30).optional(),
    settings: z.record(z.unknown()).optional(),
    scoring_settings: z.record(z.unknown()).optional(),
    waiver_settings: z.record(z.unknown()).optional(),
  }),

  joinLeague: z.object({
    joinCode: z.string().min(1, 'Join code is required'),
    teamName: z.string().min(1).max(100).optional(),
  }),

  makeDraftPick: z.object({
    playerId: z.string().min(1, 'playerId is required'),
    teamId: z.union([z.string(), z.number()]),
    pickNumber: z.number().int().optional(),
    roundNumber: z.number().int().optional(),
    draftSessionId: z.string().optional(),
    teamsCount: z.number().int().optional(),
  }),

  createTrade: z.object({
    fromTeamId: z.union([z.string(), z.number()]),
    toTeamId: z.union([z.string(), z.number()]),
    offeredPlayerIds: z.array(z.string()).min(1, 'Must offer at least one player'),
    requestedPlayerIds: z.array(z.string()).min(1, 'Must request at least one player'),
    message: z.string().max(500).optional(),
  }),

  submitWaiverClaim: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.string().min(1, 'playerId is required'),
    dropPlayerId: z.string().nullable().optional(),
  }),

  submitFAABBid: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.string().min(1, 'playerId is required'),
    bidAmount: z.number().int().min(0, 'Bid amount must be non-negative'),
    dropPlayerId: z.string().nullable().optional(),
    isConditionalDrop: z.boolean().optional(),
  }),

  addFreeAgent: z.object({
    teamId: z.union([z.string(), z.number()]),
    playerId: z.string().min(1, 'playerId is required'),
    dropPlayerId: z.string().nullable().optional(),
  }),

  stormyChat: z.object({
    message: z.string().min(1, 'Message is required').max(2000),
    leagueId: z.string().optional(),
    context: z.record(z.unknown()).optional(),
  }),

  tradeVote: z.object({
    voterTeamId: z.union([z.string(), z.number()]),
    vote: z.enum(['approve', 'veto']),
  }),

  commissionerDecision: z.object({
    leagueId: z.string().min(1),
    decision: z.enum(['approve', 'veto']),
  }),
};

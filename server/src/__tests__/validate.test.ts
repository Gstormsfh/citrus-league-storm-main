import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { validateBody, validateQuery, schemas } from '../middleware/validate';

function createTestApp(path: string, middleware: any, handler: any) {
  const app = new Hono();
  app.post(path, middleware, handler);
  return app;
}

describe('validateBody middleware', () => {
  const schema = z.object({
    name: z.string().min(1),
    count: z.number().int().min(0),
  });

  const app = createTestApp('/test', validateBody(schema), (c: any) => {
    const body = c.get('validatedBody');
    return c.json({ data: body });
  });

  it('passes valid body to handler', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', count: 5 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ name: 'Test', count: 5 });
  });

  it('rejects invalid body with validation details', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', count: -1 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Validation failed');
    expect(body.error.details).toBeDefined();
    expect(typeof body.error.details).toBe('string');
  });

  it('rejects invalid JSON', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{{{',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Invalid JSON body');
  });

  it('rejects missing fields', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Validation failed');
  });
});

describe('validateQuery middleware', () => {
  const schema = z.object({
    page: z.string().regex(/^\d+$/).optional(),
    search: z.string().min(1).optional(),
  });

  const app = new Hono();
  app.get('/test', validateQuery(schema), (c: any) => {
    const query = c.get('validatedQuery');
    return c.json({ data: query });
  });

  it('passes valid query params', async () => {
    const res = await app.request('/test?page=2&search=hello');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ page: '2', search: 'hello' });
  });

  it('rejects invalid query params', async () => {
    const res = await app.request('/test?page=abc');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Invalid query parameters');
  });
});

describe('Schema definitions', () => {
  describe('createLeague', () => {
    it('accepts valid league data', () => {
      const result = schemas.createLeague.safeParse({
        name: 'My League',
        roster_size: 15,
        draft_rounds: 10,
      });
      expect(result.success).toBe(true);
    });

    it('requires name', () => {
      const result = schemas.createLeague.safeParse({ roster_size: 15 });
      expect(result.success).toBe(false);
    });

    it('rejects empty name', () => {
      const result = schemas.createLeague.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects name over 100 chars', () => {
      const result = schemas.createLeague.safeParse({ name: 'x'.repeat(101) });
      expect(result.success).toBe(false);
    });

    it('accepts optional settings', () => {
      const result = schemas.createLeague.safeParse({
        name: 'Test',
        settings: { type: 'fantasy' },
        scoring_settings: { goals: 3 },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('joinLeague', () => {
    it('accepts valid join code', () => {
      const result = schemas.joinLeague.safeParse({ joinCode: 'ABC123' });
      expect(result.success).toBe(true);
    });

    it('rejects empty join code', () => {
      const result = schemas.joinLeague.safeParse({ joinCode: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('makeDraftPick', () => {
    it('accepts valid pick', () => {
      const result = schemas.makeDraftPick.safeParse({
        playerId: '12345',
        teamId: 'team-uuid',
      });
      expect(result.success).toBe(true);
    });

    it('accepts numeric teamId', () => {
      const result = schemas.makeDraftPick.safeParse({
        playerId: '12345',
        teamId: 42,
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty playerId', () => {
      const result = schemas.makeDraftPick.safeParse({
        playerId: '',
        teamId: 'abc',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createTrade', () => {
    it('accepts valid trade', () => {
      const result = schemas.createTrade.safeParse({
        fromTeamId: 'team1',
        toTeamId: 'team2',
        offeredPlayerIds: ['p1'],
        requestedPlayerIds: ['p2'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty offered array', () => {
      const result = schemas.createTrade.safeParse({
        fromTeamId: 'team1',
        toTeamId: 'team2',
        offeredPlayerIds: [],
        requestedPlayerIds: ['p2'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty requested array', () => {
      const result = schemas.createTrade.safeParse({
        fromTeamId: 'team1',
        toTeamId: 'team2',
        offeredPlayerIds: ['p1'],
        requestedPlayerIds: [],
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional message', () => {
      const result = schemas.createTrade.safeParse({
        fromTeamId: 'team1',
        toTeamId: 'team2',
        offeredPlayerIds: ['p1'],
        requestedPlayerIds: ['p2'],
        message: 'Fair trade!',
      });
      expect(result.success).toBe(true);
    });

    it('rejects message over 500 chars', () => {
      const result = schemas.createTrade.safeParse({
        fromTeamId: 'team1',
        toTeamId: 'team2',
        offeredPlayerIds: ['p1'],
        requestedPlayerIds: ['p2'],
        message: 'x'.repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('submitWaiverClaim', () => {
    it('accepts valid claim', () => {
      const result = schemas.submitWaiverClaim.safeParse({
        teamId: 'team-1',
        playerId: 'player-1',
      });
      expect(result.success).toBe(true);
    });

    it('accepts null dropPlayerId', () => {
      const result = schemas.submitWaiverClaim.safeParse({
        teamId: 'team-1',
        playerId: 'player-1',
        dropPlayerId: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('submitFAABBid', () => {
    it('accepts valid bid', () => {
      const result = schemas.submitFAABBid.safeParse({
        teamId: 'team-1',
        playerId: 'player-1',
        bidAmount: 10,
      });
      expect(result.success).toBe(true);
    });

    it('accepts zero bid', () => {
      const result = schemas.submitFAABBid.safeParse({
        teamId: 'team-1',
        playerId: 'player-1',
        bidAmount: 0,
      });
      expect(result.success).toBe(true);
    });

    it('rejects negative bid', () => {
      const result = schemas.submitFAABBid.safeParse({
        teamId: 'team-1',
        playerId: 'player-1',
        bidAmount: -5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('stormyChat', () => {
    it('accepts valid message', () => {
      const result = schemas.stormyChat.safeParse({
        message: 'Who should I start this week?',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty message', () => {
      const result = schemas.stormyChat.safeParse({ message: '' });
      expect(result.success).toBe(false);
    });

    it('rejects message over 2000 chars', () => {
      const result = schemas.stormyChat.safeParse({ message: 'x'.repeat(2001) });
      expect(result.success).toBe(false);
    });
  });

  describe('tradeVote', () => {
    it('accepts approve vote', () => {
      const result = schemas.tradeVote.safeParse({
        voterTeamId: 'team-1',
        vote: 'approve',
      });
      expect(result.success).toBe(true);
    });

    it('accepts veto vote', () => {
      const result = schemas.tradeVote.safeParse({
        voterTeamId: 'team-1',
        vote: 'veto',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid vote value', () => {
      const result = schemas.tradeVote.safeParse({
        voterTeamId: 'team-1',
        vote: 'abstain',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('commissionerDecision', () => {
    it('accepts approve', () => {
      const result = schemas.commissionerDecision.safeParse({
        leagueId: 'league-1',
        decision: 'approve',
      });
      expect(result.success).toBe(true);
    });

    it('accepts veto', () => {
      const result = schemas.commissionerDecision.safeParse({
        leagueId: 'league-1',
        decision: 'veto',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid decision', () => {
      const result = schemas.commissionerDecision.safeParse({
        leagueId: 'league-1',
        decision: 'override',
      });
      expect(result.success).toBe(false);
    });
  });

  // Chunk 11g.10 sub-step 10c-2 batch 1 (item 3): pickTimeLimit clamp
  // regression. The prior schema was `z.number().int().min(0).optional()`
  // which accepted `0` (→ 1-second RPC window per submit_pick_v2) and
  // any value above the UI dropdown's 300 s cap. The new schema mirrors
  // the DraftLobby.tsx <Select> options range.
  describe('draftSettings.pickTimeLimit clamp (30..300)', () => {
    it('accepts UI dropdown allowed values (30, 45, 60, 90, 120, 180, 300)', () => {
      for (const v of [30, 45, 60, 90, 120, 180, 300]) {
        const result = schemas.draftSettings.safeParse({ pickTimeLimit: v });
        expect(result.success, `pickTimeLimit=${v} should pass`).toBe(true);
      }
    });

    it('rejects below-min values (0, 29)', () => {
      expect(schemas.draftSettings.safeParse({ pickTimeLimit: 0 }).success).toBe(false);
      expect(schemas.draftSettings.safeParse({ pickTimeLimit: 29 }).success).toBe(false);
    });

    it('rejects above-max values (301, 999999)', () => {
      expect(schemas.draftSettings.safeParse({ pickTimeLimit: 301 }).success).toBe(false);
      expect(schemas.draftSettings.safeParse({ pickTimeLimit: 999999 }).success).toBe(false);
    });

    it('remains optional (accepts absence)', () => {
      const result = schemas.draftSettings.safeParse({ draft_rounds: 21 });
      expect(result.success).toBe(true);
    });
  });
});

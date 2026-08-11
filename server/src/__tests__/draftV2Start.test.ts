/**
 * Draft Engine v2 — start endpoint contract test (Entry 79 seam-pin, 2026-08-10).
 *
 * F28's first real press (Aug 10 evening) surfaced that the ignition
 * route was passing `actor.kind='user'` to start_draft_v2, but the RPC's
 * actor gate requires kind='commissioner' — defense-in-depth on top of
 * commissionerMiddleware. The offline mocks in the T7 wire-up tests
 * mocked the RPC call but did NOT assert its arguments, so the wrong
 * contract survived until Garrett + architect walked the button.
 *
 * This test pins the seam client-side of the mock: any future edit that
 * regresses `p_actor.kind` back to 'user' (or any non-'commissioner'
 * value) fails here before it hits Garrett's next click.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json(
        { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Missing or invalid Authorization header' } },
        401,
      );
    }
    c.set('userId', c.req.header('X-Test-User-Id') ?? 'user-default');
    c.set('userToken', auth.slice(7));
    await next();
  },
  optionalAuthMiddleware: async (_: any, next: any) => { await next(); },
}));

vi.mock('../middleware/membership', () => ({
  membershipMiddleware: async (_: any, next: any) => { await next(); },
  commissionerMiddleware: async (_: any, next: any) => { await next(); },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUserClientRpc: ReturnType<typeof vi.fn<(...args: any[]) => Promise<any>>>;

vi.mock('../lib/supabase', () => ({
  createUserClient: () => ({
    rpc: (...args: any[]) => mockUserClientRpc(...args),
  }),
}));

vi.mock('../services/AuditService', () => ({
  AuditService: {
    log: vi.fn(async () => {}),
  },
}));

const LEAGUE_ID = '11111111-1111-1111-1111-111111111111';
const START_PATH = `/api/draft/v2/league/${LEAGUE_ID}/start`;
const VALID_KEY = '22222222-2222-2222-2222-222222222222';

function authedHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
    ...extra,
  };
}

let appPromise: Promise<any> | null = null;
async function getApp() {
  if (!appPromise) {
    appPromise = import('../app').then((m) => m.app);
  }
  return appPromise;
}

describe('POST /api/draft/v2/league/:leagueId/start — actor contract (Entry 79 seam-pin)', () => {
  beforeAll(async () => {
    await getApp();
  });

  beforeEach(() => {
    mockUserClientRpc = vi.fn().mockResolvedValue({
      data: {
        event_id: 1,
        seq: 1,
        first_pick_deadline: '2026-08-21T00:00:00Z',
        was_duplicate: false,
      },
      error: null,
    });
  });

  it('passes p_actor.kind === "commissioner" to start_draft_v2 RPC (Entry 79 fix lock)', async () => {
    const app = await getApp();
    const res = await app.request(START_PATH, {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({ idempotency_key: VALID_KEY }),
    });

    expect(res.status).toBe(200);

    // Entry 79 root-cause pin: RPC gate refuses actor.kind !== 'commissioner'.
    // commissionerMiddleware verifies commissionership above; the actor gate
    // is defense-in-depth. Rig + route must agree on the contract.
    expect(mockUserClientRpc).toHaveBeenCalledWith(
      'start_draft_v2',
      expect.objectContaining({
        p_league_id: LEAGUE_ID,
        p_actor: expect.objectContaining({ kind: 'commissioner' }),
      }),
    );

    // Belt-and-suspenders: also assert kind is NOT 'user' (the regressed
    // value). This makes the intent unambiguous for future readers.
    const rpcCallArgs = mockUserClientRpc.mock.calls[0]?.[1];
    expect(rpcCallArgs?.p_actor?.kind).not.toBe('user');
    expect(rpcCallArgs?.p_actor?.kind).toBe('commissioner');
    expect(rpcCallArgs?.p_actor?.id).toBe('user-default');
  });
});

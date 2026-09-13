import { describe, it, expect } from 'vitest';
import { MemberClaimService } from '../../services/import/MemberClaimService';
import { AppError } from '../../lib/errors';
import { FakeSupabase } from './fakeSupabase';

const LEAGUE = 'league-1';

function db(over: Record<string, any[]> = {}) {
  return new FakeSupabase({
    league_member_honours: [
      { league_id: LEAGUE, member_id: 'm-bob', display_name: 'Bob', owner_id: null, merged_into_member_id: null, first_season: 2015, last_season: 2024, seasons_played: 10, titles: 2, playoff_seasons: 6, best_finish: 1 },
      { league_id: LEAGUE, member_id: 'm-alice', display_name: 'Alice', owner_id: 'user-alice', merged_into_member_id: null, first_season: 2015, last_season: 2024, seasons_played: 10, titles: 1, playoff_seasons: 5, best_finish: 1 },
      { league_id: LEAGUE, member_id: 'm-old', display_name: 'Bob (old account)', owner_id: null, merged_into_member_id: 'm-bob', first_season: 2015, last_season: 2016, seasons_played: 2, titles: 0, playoff_seasons: 0, best_finish: 4 },
      { league_id: LEAGUE, member_id: 'm-cy', display_name: 'Cy', owner_id: null, merged_into_member_id: null, first_season: 2020, last_season: 2024, seasons_played: null, titles: null, playoff_seasons: null, best_finish: null },
      { league_id: LEAGUE, member_id: 'm-dee', display_name: 'Dee', owner_id: 'user-dee', merged_into_member_id: null, first_season: null, last_season: null, seasons_played: 0, titles: 0, playoff_seasons: 0, best_finish: null },
      { league_id: 'league-2', member_id: 'm-other', display_name: 'Other league', owner_id: null, merged_into_member_id: null, first_season: 2020, last_season: 2024, seasons_played: 1, titles: 0, playoff_seasons: 0, best_finish: 2 },
    ],
    league_members: [
      { id: 'm-bob', league_id: LEAGUE, owner_id: null, merged_into_member_id: null, claim_token: 'tok-bob', claimed_at: null },
      { id: 'm-alice', league_id: LEAGUE, owner_id: 'user-alice', merged_into_member_id: null, claim_token: null, claimed_at: '2026-09-01T00:00:00.000Z' },
      { id: 'm-old', league_id: LEAGUE, owner_id: null, merged_into_member_id: 'm-bob', claim_token: null, claimed_at: null },
      { id: 'm-cy', league_id: LEAGUE, owner_id: null, merged_into_member_id: null, claim_token: 'tok-cy', claimed_at: null },
      // The foundation seed: a current team owner with a row, no history and no claim yet.
      { id: 'm-dee', league_id: LEAGUE, owner_id: 'user-dee', merged_into_member_id: null, claim_token: null, claimed_at: null },
    ],
    ...over,
  });
}

describe('MemberClaimService.listUnclaimed', () => {
  it('lists unclaimed, unmerged members of this league with their one-line career, sorted by name', async () => {
    const svc = new MemberClaimService(db() as any);
    const { members: list } = await svc.listUnclaimed(LEAGUE, 'user-dee');
    expect(list.map((m) => m.id)).toEqual(['m-bob', 'm-cy']);
    expect(list[0]).toEqual({ id: 'm-bob', display_name: 'Bob', first_season: 2015, last_season: 2024, titles: 2, seasons_played: 10, playoff_seasons: 6, best_finish: 1 });
    // Null aggregates become zeros so the UI never renders "null titles".
    expect(list[1]).toMatchObject({ titles: 0, seasons_played: 0, playoff_seasons: 0, best_finish: null });
  });

  it('a seeded team owner with no claim yet is still asked; a claimed member is not; a stranger is asked', async () => {
    const svc = new MemberClaimService(db() as any);
    // Dee has a row (the seed) but nobody has attached history to it: owner_id alone must not count as done.
    expect((await svc.listUnclaimed(LEAGUE, 'user-dee')).attached).toBe(false);
    expect((await svc.listUnclaimed(LEAGUE, 'user-alice')).attached).toBe(true);
    expect((await svc.listUnclaimed(LEAGUE, 'user-nobody')).attached).toBe(false);
  });

  it('the merged filter goes to the view, not a second read', async () => {
    const fake = db();
    await new MemberClaimService(fake as any).listUnclaimed(LEAGUE, 'user-dee');
    const honours = fake.opsFor('league_member_honours');
    expect(honours).toHaveLength(1);
    expect(honours[0].filters).toEqual(expect.arrayContaining(['owner_id is null', 'merged_into_member_id is null']));
  });

  it('surfaces a read failure', async () => {
    const fake = db();
    fake.failNext = { table: 'league_member_honours', op: 'select', error: { message: 'nope' } };
    await expect(new MemberClaimService(fake as any).listUnclaimed(LEAGUE, 'user-dee')).rejects.toThrow('league_member_honours read failed: nope');
    const fake2 = db();
    fake2.failNext = { table: 'league_members', op: 'select', error: { message: 'down' } };
    await expect(new MemberClaimService(fake2 as any).listUnclaimed(LEAGUE, 'user-dee')).rejects.toThrow('league_members read failed: down');
  });
});

describe('MemberClaimService.claim', () => {
  it('calls the claim function with the token and returns its row', async () => {
    const fake = db();
    fake.rpcHandlers.citrus_claim_league_member = (args) => {
      expect(args).toEqual({ p_member_id: 'm-bob', p_claim_token: 'tok-bob' });
      return [{ member_id: 'm-bob', league_id: LEAGUE, display_name: 'Bob', claim_method: 'email_link' }];
    };
    const res = await new MemberClaimService(fake as any).claim('m-bob', 'tok-bob');
    expect(res).toEqual({ member_id: 'm-bob', league_id: LEAGUE, display_name: 'Bob', claim_method: 'email_link' });
  });

  it('list-pick path passes a null token', async () => {
    const fake = db();
    fake.rpcHandlers.citrus_claim_league_member = (args) => {
      expect(args.p_claim_token).toBeNull();
      return { member_id: 'm-cy', league_id: LEAGUE, display_name: 'Cy', claim_method: 'list_pick' };
    };
    const res = await new MemberClaimService(fake as any).claim('m-cy');
    expect(res.claim_method).toBe('list_pick');
  });

  it("the function's refusal is a 400 with its own wording", async () => {
    const fake = db();
    fake.rpcHandlers.citrus_claim_league_member = () => { throw new Error('That member is already claimed.'); };
    const err = await new MemberClaimService(fake as any).claim('m-alice').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('That member is already claimed.');
  });

  it('an empty result is an error, not a silent success', async () => {
    const fake = db();
    fake.rpcHandlers.citrus_claim_league_member = () => [];
    await expect(new MemberClaimService(fake as any).claim('m-bob', 'tok-bob')).rejects.toThrow('Claim returned no row');
  });
});

describe('MemberClaimService.merge', () => {
  it('returns the survivor id from the merge function', async () => {
    const fake = db();
    fake.rpcHandlers.citrus_merge_league_members = (args) => {
      expect(args).toEqual({ p_from: 'm-old', p_into: 'm-bob', p_claim_method: null });
      return 'm-bob';
    };
    expect(await new MemberClaimService(fake as any).merge('m-old', 'm-bob')).toBe('m-bob');
  });

  it('a shared-season clash from the function is a 400', async () => {
    const fake = db();
    fake.rpcHandlers.citrus_merge_league_members = () => { throw new Error('Both members have standings in 3 shared season(s). Resolve those seasons first.'); };
    const err = await new MemberClaimService(fake as any).merge('m-cy', 'm-bob').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
  });
});

describe('MemberClaimService.assign', () => {
  it('attaches an unclaimed member to a user who has no row yet', async () => {
    const fake = db();
    const res = await new MemberClaimService(fake as any).assign(LEAGUE, 'm-bob', 'user-bob');
    expect(res).toEqual({ memberId: 'm-bob', merged: false });
    expect(fake.rows('league_members').find((m) => m.id === 'm-bob')).toMatchObject({ owner_id: 'user-bob', claim_method: 'commissioner_assign', claim_token: null });
    expect(fake.rows('league_members').find((m) => m.id === 'm-bob')!.claimed_at).toBeTruthy();
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('merges into the row the user already holds instead of giving them two', async () => {
    const fake = db();
    fake.rpcHandlers.citrus_merge_league_members = (args) => {
      expect(args).toEqual({ p_from: 'm-cy', p_into: 'm-alice', p_claim_method: 'commissioner_assign' });
      return 'm-alice';
    };
    const res = await new MemberClaimService(fake as any).assign(LEAGUE, 'm-cy', 'user-alice');
    expect(res).toEqual({ memberId: 'm-alice', merged: true });
    // The direct update path was not taken.
    expect(fake.opsFor('league_members', 'update')).toHaveLength(0);
  });

  it('assigning a member to the user who already owns it is an idempotent success', async () => {
    const fake = db();
    const before = fake.ops.length;
    const res = await new MemberClaimService(fake as any).assign(LEAGUE, 'm-alice', 'user-alice');
    expect(res).toEqual({ memberId: 'm-alice', merged: false });
    expect(fake.ops.slice(before).every((o) => o.op === 'select')).toBe(true);
  });

  it('refuses a member that is already claimed by someone else', async () => {
    const fake = db();
    const err = await new MemberClaimService(fake as any).assign(LEAGUE, 'm-alice', 'user-zed').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(409);
    expect(fake.rows('league_members').find((m) => m.id === 'm-alice')!.owner_id).toBe('user-alice');
  });

  it('never touches a member from another league', async () => {
    const fake = db({ league_members: [{ id: 'm-x', league_id: 'league-2', owner_id: null, merged_into_member_id: null }] });
    await expect(new MemberClaimService(fake as any).assign(LEAGUE, 'm-x', 'user-zed')).rejects.toBeInstanceOf(AppError);
    expect(fake.rows('league_members')[0].owner_id).toBeNull();
  });
});

describe('MemberClaimService.unclaim', () => {
  it('detaches the user and clears the claim fields', async () => {
    const fake = db();
    await new MemberClaimService(fake as any).unclaim(LEAGUE, 'm-alice');
    expect(fake.rows('league_members').find((m) => m.id === 'm-alice')).toMatchObject({ owner_id: null, claimed_at: null, claim_method: null });
  });

  it('surfaces an update failure', async () => {
    const fake = db();
    fake.failNext = { table: 'league_members', op: 'update', error: { message: 'RLS' } };
    await expect(new MemberClaimService(fake as any).unclaim(LEAGUE, 'm-alice')).rejects.toThrow('league_members update failed: RLS');
  });
});

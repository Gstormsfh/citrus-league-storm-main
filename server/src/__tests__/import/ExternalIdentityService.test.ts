import { describe, it, expect } from 'vitest';
import { ExternalIdentityService, newClaimToken } from '../../services/import/ExternalIdentityService';
import { FakeSupabase } from './fakeSupabase';
import type { ImportedSeason, ImportedTeam, ImportedManager } from '../../import/types';

const LEAGUE = 'league-1';
const IMPORTER = 'user-importer';

const mgr = (id: string, displayName = `Manager ${id}`): ImportedManager => ({ externalManagerId: id, displayName });
const team = (externalTeamId: string, managers: ImportedManager[], over: Partial<ImportedTeam> = {}): ImportedTeam => ({
  externalTeamId, teamName: `Team ${externalTeamId}`, managers, finalRank: null, finalRankSource: null, playoffSeed: null,
  wins: null, losses: null, ties: null, pointsFor: null, pointsAgainst: null, categoryRecord: null, madePlayoffs: null, playoffFinish: null, ...over,
});
const seasonOf = (season: number, teams: ImportedTeam[]): ImportedSeason => ({
  platform: 'espn', externalLeagueId: '777', externalSeasonKey: String(season + 1), season, isFinished: true,
  settings: { leagueName: 'L', scoringType: 'h2h_points', scoringItems: [], rosterSlots: [], regularSeasonWeeks: null, playoffTeamCount: null, playoffWeeks: null, keeperCount: null, keeperOrderType: null, draftType: null, usesFaab: null, isPublic: true },
  teams, matchups: [], picks: [], keepers: [], transactions: [], previousSeasons: [], warnings: [],
});

describe('newClaimToken', () => {
  it('is url-safe and long enough to be unguessable', () => {
    const t = newClaimToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(newClaimToken()).not.toBe(t);
  });
});

describe('ExternalIdentityService.resolveSeason', () => {
  it('first import: importer claimed on the spot, everyone else unclaimed with a token, identities recorded', async () => {
    const db = new FakeSupabase();
    const svc = new ExternalIdentityService(db as any);
    const season = seasonOf(2020, [team('1', [mgr('{SWID-A}', 'Alice')]), team('2', [mgr('{SWID-B}', 'Bob')]), team('3', [mgr('{SWID-C}', 'Cy')])]);

    const res = await svc.resolveSeason(LEAGUE, season, { importerUserId: IMPORTER, importerExternalId: '{SWID-B}' });

    expect(res.created).toBe(3);
    expect(res.matchedExisting).toBe(0);
    expect(res.byTeamId.get('2')).toBe(res.byExternalId.get('{SWID-B}'));
    const members = db.rows('league_members');
    expect(members).toHaveLength(3);
    const bob = members.find((m) => m.display_name === 'Bob')!;
    expect(bob).toMatchObject({ league_id: LEAGUE, owner_id: IMPORTER, claim_method: 'oauth_match', claim_token: null, first_season: 2020, last_season: 2020 });
    expect(bob.claimed_at).toBeTruthy();
    const alice = members.find((m) => m.display_name === 'Alice')!;
    expect(alice).toMatchObject({ owner_id: null, claim_method: null, claimed_at: null });
    expect(alice.claim_token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const identities = db.rows('league_member_identities');
    expect(identities).toHaveLength(3);
    expect(identities.find((i) => i.external_manager_id === '{SWID-B}')).toMatchObject({ league_id: LEAGUE, platform: 'espn', member_id: bob.id, display_name: 'Bob', first_seen_season: 2020, last_seen_season: 2020 });
  });

  it('attaches the importer to the row the foundation seed already gave them instead of creating a second one', async () => {
    const db = new FakeSupabase({
      league_members: [{ id: 'seeded', league_id: LEAGUE, owner_id: IMPORTER, display_name: 'garrett', merged_into_member_id: null, first_season: null, last_season: null, claim_method: 'seeded' }],
    });
    const svc = new ExternalIdentityService(db as any);
    const season = seasonOf(2020, [team('1', [mgr('{SWID-G}', 'G-Money')]), team('2', [mgr('{SWID-B}', 'Bob')])]);

    const res = await svc.resolveSeason(LEAGUE, season, { importerUserId: IMPORTER, importerExternalId: '{SWID-G}' });

    expect(res.byExternalId.get('{SWID-G}')).toBe('seeded');
    expect(res.created).toBe(1);
    expect(res.matchedExisting).toBe(1);
    expect(db.rows('league_members')).toHaveLength(2);
    expect(db.rows('league_members').find((m) => m.id === 'seeded')).toMatchObject({ first_season: 2020, last_season: 2020 });
    expect(db.rows('league_member_identities').find((i) => i.external_manager_id === '{SWID-G}')?.member_id).toBe('seeded');
    // The seed left claimed_at empty; the match stamps it so the screens stop asking the importer which one they are.
    const seeded = db.rows('league_members').find((m) => m.id === 'seeded')!;
    expect(seeded.claim_method).toBe('oauth_match');
    expect(typeof seeded.claimed_at).toBe('string');
  });

  it('a seeded row already stamped by an earlier import keeps its first claim', async () => {
    const db = new FakeSupabase({
      league_members: [{ id: 'seeded', league_id: LEAGUE, owner_id: IMPORTER, display_name: 'garrett', merged_into_member_id: null, first_season: 2019, last_season: 2019, claim_method: 'list_pick', claimed_at: '2026-01-01T00:00:00.000Z' }],
    });
    const svc = new ExternalIdentityService(db as any);
    await svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', [mgr('{SWID-G}', 'G-Money')])]), { importerUserId: IMPORTER, importerExternalId: '{SWID-G}' });
    expect(db.rows('league_members').find((m) => m.id === 'seeded')).toMatchObject({ claim_method: 'list_pick', claimed_at: '2026-01-01T00:00:00.000Z' });
  });

  it('a seeded row that belongs to a different league is never attached', async () => {
    const db = new FakeSupabase({
      league_members: [{ id: 'other-league', league_id: 'league-2', owner_id: IMPORTER, display_name: 'garrett', merged_into_member_id: null, first_season: null, last_season: null }],
    });
    const svc = new ExternalIdentityService(db as any);
    const res = await svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', [mgr('{SWID-G}')])]), { importerUserId: IMPORTER, importerExternalId: '{SWID-G}' });
    expect(res.byExternalId.get('{SWID-G}')).not.toBe('other-league');
    expect(res.created).toBe(1);
  });

  it('second season: existing identities are reused, ranges widened, latest name kept', async () => {
    const db = new FakeSupabase();
    const svc = new ExternalIdentityService(db as any);
    await svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', [mgr('{SWID-A}', 'Alice 2020')]), team('2', [mgr('{SWID-B}', 'Bob')])]), { importerUserId: IMPORTER, importerExternalId: '{SWID-B}' });
    const before = db.rows('league_members').map((m) => m.id).sort();

    // Team ids swapped: 2021 team "1" is Bob now. Identity, not team id, must carry the history.
    const res = await svc.resolveSeason(LEAGUE, seasonOf(2021, [team('1', [mgr('{SWID-B}', 'Bob')]), team('2', [mgr('{SWID-A}', 'Alice 2021')])]), { importerUserId: IMPORTER, importerExternalId: '{SWID-B}' });

    expect(res.created).toBe(0);
    expect(res.matchedExisting).toBe(2);
    expect(db.rows('league_members').map((m) => m.id).sort()).toEqual(before);
    expect(res.byTeamId.get('1')).toBe(res.byExternalId.get('{SWID-B}'));
    const alice = db.rows('league_member_identities').find((i) => i.external_manager_id === '{SWID-A}')!;
    expect(alice).toMatchObject({ first_seen_season: 2020, last_seen_season: 2021, display_name: 'Alice 2021' });
    expect(db.rows('league_members').find((m) => m.id === alice.member_id)).toMatchObject({ first_season: 2020, last_season: 2021 });
  });

  it('importing an older season afterwards widens downward and keeps the newer display name', async () => {
    const db = new FakeSupabase();
    const svc = new ExternalIdentityService(db as any);
    await svc.resolveSeason(LEAGUE, seasonOf(2021, [team('1', [mgr('{SWID-A}', 'Alice Now')])]), { importerUserId: IMPORTER });
    await svc.resolveSeason(LEAGUE, seasonOf(2018, [team('9', [mgr('{SWID-A}', 'Alice Then')])]), { importerUserId: IMPORTER });
    const identity = db.rows('league_member_identities')[0];
    expect(identity).toMatchObject({ first_seen_season: 2018, last_seen_season: 2021, display_name: 'Alice Now' });
    expect(db.rows('league_members')[0]).toMatchObject({ first_season: 2018, last_season: 2021 });
  });

  it('follows a merge pointer to the surviving member', async () => {
    const db = new FakeSupabase({
      league_members: [
        { id: 'old', league_id: LEAGUE, owner_id: null, display_name: 'Old', merged_into_member_id: 'survivor', first_season: 2019, last_season: 2019 },
        { id: 'survivor', league_id: LEAGUE, owner_id: 'user-x', display_name: 'X', merged_into_member_id: null, first_season: 2019, last_season: 2019 },
      ],
      league_member_identities: [{ league_id: LEAGUE, platform: 'espn', external_manager_id: '{SWID-A}', member_id: 'old', first_seen_season: 2019, last_seen_season: 2019, display_name: 'Old' }],
    });
    const svc = new ExternalIdentityService(db as any);
    const res = await svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', [mgr('{SWID-A}', 'A')])]), { importerUserId: IMPORTER });
    expect(res.byExternalId.get('{SWID-A}')).toBe('survivor');
    expect(res.byTeamId.get('1')).toBe('survivor');
    expect(res.created).toBe(0);
    expect(db.rows('league_members').find((m) => m.id === 'survivor')).toMatchObject({ last_season: 2020 });
  });

  it('co-managers each get a member; the team maps to the primary', async () => {
    const db = new FakeSupabase();
    const svc = new ExternalIdentityService(db as any);
    const res = await svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', [mgr('{P}', 'Primary'), mgr('{Q}', 'Co')]), team('2', [mgr('{Q}', 'Co')])]), { importerUserId: IMPORTER });
    expect(res.created).toBe(2);
    expect(res.byTeamId.get('1')).toBe(res.byExternalId.get('{P}'));
    expect(res.byExternalId.get('{Q}')).toBeDefined();
    const ids = db.rows('league_member_identities');
    expect(ids.find((i) => i.external_manager_id === '{P}')!.is_co_manager).toBe(false);
    // Q co-manages team 1 but runs team 2: a primary anywhere is not a co-manager.
    expect(ids.find((i) => i.external_manager_id === '{Q}')!.is_co_manager).toBe(false);
    const only = new FakeSupabase();
    await new ExternalIdentityService(only as any).resolveSeason(LEAGUE, seasonOf(2020, [team('1', [mgr('{P}'), mgr('{Q}')])]), { importerUserId: IMPORTER });
    expect(only.rows('league_member_identities').find((i) => i.external_manager_id === '{Q}')!.is_co_manager).toBe(true);
  });

  it('a team without a manager id gets no member and no team mapping', async () => {
    const db = new FakeSupabase();
    const svc = new ExternalIdentityService(db as any);
    const res = await svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', []), team('2', [{ externalManagerId: '', displayName: 'ghost' }])]), { importerUserId: IMPORTER });
    expect(res.created).toBe(0);
    expect(res.byTeamId.size).toBe(0);
    expect(db.rows('league_members')).toHaveLength(0);
  });

  it('an importer who did not manage a team that season is not given a row', async () => {
    const db = new FakeSupabase();
    const svc = new ExternalIdentityService(db as any);
    const res = await svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', [mgr('{SWID-A}')])]), { importerUserId: IMPORTER, importerExternalId: '{SWID-NOT-HERE}' });
    expect(res.created).toBe(1);
    expect(db.rows('league_members').every((m) => m.owner_id === null)).toBe(true);
  });

  it('a blank display name becomes a placeholder rather than an empty string', async () => {
    const db = new FakeSupabase();
    const svc = new ExternalIdentityService(db as any);
    await svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', [{ externalManagerId: '{X}', displayName: '' }])]), { importerUserId: IMPORTER });
    expect(db.rows('league_members')[0].display_name).toBe('Unknown manager');
  });

  it('surfaces a read failure with the table named', async () => {
    const db = new FakeSupabase();
    db.failNext = { table: 'league_member_identities', op: 'select', error: { message: 'permission denied' } };
    const svc = new ExternalIdentityService(db as any);
    await expect(svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', [mgr('{A}')])]), { importerUserId: IMPORTER })).rejects.toThrow('league_member_identities read failed: permission denied');
  });

  it('surfaces an insert failure and stops', async () => {
    const db = new FakeSupabase();
    db.failNext = { table: 'league_members', op: 'insert', error: { message: 'RLS' } };
    const svc = new ExternalIdentityService(db as any);
    await expect(svc.resolveSeason(LEAGUE, seasonOf(2020, [team('1', [mgr('{A}')])]), { importerUserId: IMPORTER })).rejects.toThrow('league_members insert failed: RLS');
    expect(db.rows('league_member_identities')).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), membership: vi.fn() }));
vi.mock('../services/DraftKitAccessService', () => ({ DRAFT_KIT_PRODUCT: 'draft-kit-2026-27', DraftKitAccessService: class { access = mocks.access; } }));
vi.mock('../services/LeagueMembershipService', () => ({ LeagueMembershipService: class { checkMembership = mocks.membership; } }));
import { DraftKitDeskService, roomDeskWeights } from '../services/DraftKitDeskService';
import { DESK_SUPPORTED_WEIGHTS } from '../services/PublishedDraftDeskService';
const supported = { skater: { goals: 6, assists: 4, hits: 0 }, goalie: { wins: 5 } };
function query(result: unknown) {
  const q: any = {};
  for (const key of ['select','eq','insert','update','limit']) q[key] = vi.fn(() => q);
  q.single = q.maybeSingle = vi.fn(async () => result);
  q.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return q;
}
function setup() {
  const league = query({ data: { name: 'League', commissioner_id: 'buyer', scoring_settings: { skater: { goals: 6 }, goalie: { wins: 5 } }, settings: {} } });
  const notes = query({ data: [{ player_key: 'canonical:1', note: 'Personal', target: true, version: 3 }] });
  const db = { from: vi.fn((table: string) => table === 'leagues' ? league : notes) };
  const exporter = { connected: vi.fn(async () => ({ kit: { fingerprint: 'a'.repeat(64), players: [{ key: 'canonical:1' }] }, warning: null })) };
  return { service: new DraftKitDeskService(db as any, exporter as any), db, league, notes, exporter };
}
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ active: true }); mocks.membership.mockResolvedValue({ isMember: true }); });
describe('Automatic purchased draft desk', () => {
  it('normalizes omitted stats to zero and rejects unsupported scoring instead of silently dropping it', () => {
    expect(roomDeskWeights({ skater: { goals: 3 }, goalie: {} }, supported, {})).toEqual({ skater: { goals: 3, assists: 0, hits: 0 }, goalie: { wins: 0 } });
    expect(() => roomDeskWeights({ skater: { plus_minus: 1 } }, supported, {})).toThrow(/does not project plus minus/);
    expect(() => roomDeskWeights({}, supported, { scoringFormat: 'roto' })).toThrow(/category/);
    expect(() => roomDeskWeights({}, supported, { scoringFormat: 'points-per-game' })).toThrow(/per-game/);
    for (const raw of [true, [], { skater: { hits: NaN } }, { skater: { hits: '1' } }, { skater: { hits: 10001 } }])
      expect(() => roomDeskWeights(raw, supported, {})).toThrow();
  });
  it('does not generate or query notes for a nonbuyer', async () => {
    const { service, exporter, db } = setup(); mocks.access.mockResolvedValue({ active: false });
    expect(await service.open('buyer', 'league')).toEqual({ owned: false });
    expect(exporter.connected).not.toHaveBeenCalled(); expect(db.from).not.toHaveBeenCalledWith('draft_kit_desk_notes');
  });
  it('denies a nonmember before looking up the purchase', async () => {
    mocks.membership.mockResolvedValue({ isMember: false });
    await expect(setup().service.open('buyer', 'league')).rejects.toMatchObject({ status: 403 });
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it('uses server league weights and owner-scoped notes, never manual pick marks', async () => {
    const { service, exporter, notes } = setup();
    const result = await service.open('buyer', 'league');
    expect(exporter.connected).toHaveBeenCalledWith('League', roomDeskWeights(
      { skater: { goals: 6 }, goalie: { wins: 5 } }, DESK_SUPPORTED_WEIGHTS, {}));
    expect(result).toMatchObject({ owned: true, versions: { 'canonical:1': 3 }, file: { progress: { rows: [{ key: 'canonical:1', drafted: false, target: true, note: 'Personal' }] } } });
    expect(notes.eq).toHaveBeenCalledWith('user_id', 'buyer'); expect(notes.eq).toHaveBeenCalledWith('league_id', 'league');
  });
  it('rechecks a refund during board generation', async () => {
    mocks.access.mockResolvedValueOnce({ active: true }).mockResolvedValueOnce({ active: false });
    await expect(setup().service.open('buyer', 'league')).rejects.toMatchObject({ status: 403 });
  });
  it('rejects a board if league scoring changes during generation', async () => {
    const { service, league } = setup();
    league.single.mockResolvedValueOnce({ data: { name: 'League', commissioner_id: 'buyer', scoring_settings: { skater: { goals: 6 }, goalie: { wins: 5 } }, settings: {} } })
      .mockResolvedValueOnce({ data: { name: 'League', commissioner_id: 'buyer', scoring_settings: { skater: { goals: 9 }, goalie: { wins: 5 } }, settings: {} } });
    await expect(service.open('buyer', 'league')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('scoring changed') });
  });
  it('rejects a switch to category scoring during generation', async () => {
    const { service, league } = setup();
    league.single.mockResolvedValueOnce({ data: { name: 'League', commissioner_id: 'buyer', scoring_settings: null, settings: {} } })
      .mockResolvedValueOnce({ data: { name: 'League', commissioner_id: 'buyer', scoring_settings: null, settings: { scoringFormat: 'roto' } } });
    await expect(service.open('buyer', 'league')).rejects.toMatchObject({ status: 400 });
  });
  it('rechecks publication on each open rather than reusing a dated PDF board', async () => {
    const { service, exporter } = setup();
    await Promise.all([service.open('buyer','same'), service.open('buyer','same')]);
    expect(exporter.connected).toHaveBeenCalledTimes(2); expect(mocks.access).toHaveBeenCalledTimes(4);
  });
  it('preserves a failed-refresh warning without changing notes or draft marks', async () => {
    const { service, exporter } = setup();
    exporter.connected.mockResolvedValue({kit:{fingerprint:'a'.repeat(64),players:[{key:'canonical:1'}]},warning:'Showing last published projections.'});
    expect(await service.open('buyer','same')).toMatchObject({warning:'Showing last published projections.'});
  });
  it('updates only the expected note version and never writes draft state', async () => {
    const { service, notes } = setup(); notes.maybeSingle.mockResolvedValue({ data: { version: 4, note: 'New', target: true } });
    expect(await service.save('buyer','league','canonical:1',{ version: 3, note: 'New', target: true })).toMatchObject({ version: 4 });
    expect(notes.eq).toHaveBeenCalledWith('version', 3);
    expect(notes.update).toHaveBeenCalledWith({ version: 4, note: 'New', target: true, updated_at: expect.any(String) });
  });
  it('rejects another tab’s changes and permits an exact lost-response retry', async () => {
    const { service, notes } = setup();
    notes.maybeSingle.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { version: 4, note: 'Other tab', target: true } });
    await expect(service.save('buyer','league','canonical:1',{ version: 3, note: 'New', target: true })).rejects.toMatchObject({ status: 409 });
    notes.maybeSingle.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { version: 4, note: 'New', target: true } });
    await expect(service.save('buyer','league','canonical:1',{ version: 3, note: 'New', target: true })).resolves.toMatchObject({ version: 4 });
  });
});

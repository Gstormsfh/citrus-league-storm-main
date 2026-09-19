import { describe, expect, it, vi } from 'vitest';
import { ExternalDraftSnapshotService, espnDraftSnapshot, yahooDraftSnapshot, resolveDraftSnapshot } from '../services/ExternalDraftSnapshotService';
import type { CrosswalkResult } from '../services/import/PlayerCrosswalkService';

const yahoo = (picks: unknown[] = []) => ({ league: { league_key: '461.l.123', season: '2026', game_code: 'nhl', draft_status: 'drafting', draft_results: picks } });
const keepers = (players: unknown[] = []) => ({ league: { league_key: '461.l.123', players } });
const yp = { player_key: '461.p.1234', team_key: '461.l.123.t.1', pick: '1' };
const espn = (picks: unknown[] = []) => ({ id: 123, seasonId: 2027, draftDetail: { picks, drafted: false }, teams: [{ id: 1, draftStrategy: { keeperPlayerIds: [] as number[] } }] });
const ep = { playerId: 1234, teamId: 1, overallPickNumber: 1, keeper: false };
const known = (method: CrosswalkResult['matchMethod'] = 'manual', ambiguous = false) => new Map<string,CrosswalkResult>([['1234',{ externalPlayerId: '1234', nhlPlayerId: 8478402, matchMethod: method, confidence: 1, isAmbiguous: ambiguous, candidates: [8478402] }]]);
const at = '2026-09-19T08:00:00Z';
describe('external draft snapshots (contract fixtures, not live-provider acceptance)', () => {
  it('reads Yahoo picks and existing keeper designation together', () => {
    const result = yahooDraftSnapshot(yahoo([yp]), keepers([{player_key:'461.p.1234',ownership:{owner_team_key:'461.l.123.t.1'}}]), '461.l.123', 2026);
    expect(result).toMatchObject({status:'in_progress',picks:[{externalPlayerId:'1234',keeper:true,overallPick:1}]});
  });
  it('preserves keepers that have no draft slot yet', () => {
    expect(yahooDraftSnapshot(yahoo(),keepers([{player_key:'461.p.1234',ownership:{owner_team_key:'461.l.123.t.1'}}]),'461.l.123',2026).picks[0].overallPick).toBeNull();
    const body=espn(); body.teams[0].draftStrategy.keeperPlayerIds=[1234];
    expect(espnDraftSnapshot(body,'123',2026).picks[0]).toMatchObject({keeper:true,overallPick:null});
  });
  it('converts the ESPN season boundary and does not invent live status', () => {
    expect(espnDraftSnapshot(espn([ep]),'123',2026)).toMatchObject({season:2026,status:'unknown',picks:[{externalPlayerId:'1234'}]});
    expect(()=>espnDraftSnapshot(espn([ep]),'123',2027)).toThrow();
  });
  it.each(['draft_results','league_key','season'])('rejects missing Yahoo %s rather than clearing the board', field => {
    const body=yahoo([yp]);delete (body.league as Record<string,unknown>)[field];
    expect(()=>yahooDraftSnapshot(body,keepers(),'461.l.123',2026)).toThrow();
  });
  it('rejects missing ESPN picks or keeper data', () => {
    expect(()=>espnDraftSnapshot({...espn(),draftDetail:{}},'123',2026)).toThrow();
    expect(()=>espnDraftSnapshot({...espn(),teams:[{id:1}]},'123',2026)).toThrow();
  });
  it('rejects cross-league and cross-sport rows', () => {
    expect(()=>yahooDraftSnapshot(yahoo([{...yp,team_key:'461.l.999.t.1'}]),keepers(),'461.l.123',2026)).toThrow();
    expect(()=>yahooDraftSnapshot(yahoo([{...yp,player_key:'999.p.1234'}]),keepers(),'461.l.123',2026)).toThrow();
    expect(()=>espnDraftSnapshot(espn([ep]),'999',2026)).toThrow();
  });
  it('rejects duplicate picks, slots and contradictory keeper ownership', () => {
    expect(()=>espnDraftSnapshot(espn([ep,ep]),'123',2026)).toThrow();
    expect(()=>espnDraftSnapshot(espn([ep,{...ep,playerId:99}]),'123',2026)).toThrow();
    expect(()=>yahooDraftSnapshot(yahoo([yp]),keepers([{player_key:'461.p.1234',ownership:{owner_team_key:'461.l.123.t.2'}}]),'461.l.123',2026)).toThrow();
  });
  it('uses whole snapshots so undo and reset restore player availability', () => {
    const before=resolveDraftSnapshot(espnDraftSnapshot(espn([ep]),'123',2026),known(),at);
    const after=resolveDraftSnapshot(espnDraftSnapshot(espn(),'123',2026),known(),at);
    expect(before.unavailableIds).toEqual(['8478402']);expect(after.unavailableIds).toEqual([]);
    expect(before.revision).not.toBe(after.revision);
  });
  it.each(['name_only','unmatched'] as const)('does not hide players on a %s guess', method => {
    expect(resolveDraftSnapshot(espnDraftSnapshot(espn([ep]),'123',2026),known(method),at)).toMatchObject({complete:false,unavailableIds:[],unresolved:['1234']});
  });
  it('does not hide ambiguous identities even with a candidate ID', () => {
    expect(resolveDraftSnapshot(espnDraftSnapshot(espn([ep]),'123',2026),known('manual',true),at).complete).toBe(false);
  });
  it('keeps revision stable across fetch time alone', () => {
    const snapshot=espnDraftSnapshot(espn([ep]),'123',2026);
    expect(resolveDraftSnapshot(snapshot,known(),at).revision).toBe(resolveDraftSnapshot(snapshot,known(),'2026-09-19T08:00:15Z').revision);
  });
  it('uses only the existing read clients and does not fall back to another season', async () => {
    const fetchSeason=vi.fn().mockResolvedValue({body:espn([ep])});
    const service=new ExternalDraftSnapshotService();
    await service.espn({fetchSeason} as never,'123',2026);
    expect(fetchSeason).toHaveBeenCalledExactlyOnceWith('123',2027,['mDraftDetail','mTeam'],undefined);
    fetchSeason.mockRejectedValueOnce(Error('private'));
    await expect(service.espn({fetchSeason} as never,'123',2026)).rejects.toThrow('private');
    expect(fetchSeason).toHaveBeenCalledTimes(2);
  });
});

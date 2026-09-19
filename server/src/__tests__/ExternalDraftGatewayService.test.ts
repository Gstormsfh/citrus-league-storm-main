import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({lookup:vi.fn(),league:vi.fn(),keepers:vi.fn()}));
vi.mock('../services/import/PlayerCrosswalkService',()=>({PlayerCrosswalkService:class{lookupKnown=mocks.lookup}}));
vi.mock('../import/yahoo/client',()=>({YahooClient:class{league=mocks.league;keepers=mocks.keepers}}));
import { ExternalDraftGatewayService, externalDraftWeights } from '../services/ExternalDraftGatewayService';
import { espnCore,espnDraft } from './import/espnFixtures';
import { parseEspnSeason } from '../import/espn/parse';

const team={id:1,swid:'{11111111-1111-1111-1111-111111111111}',name:'Owner',rank:1};
const payload=()=>({...espnCore(2027,[team]),...espnDraft([{overall:1,teamId:1,playerId:1234}])});
const request={platform:'espn' as const,leagueId:'777',season:2026};
const connection={status:vi.fn(),isConfigured:()=>true,tokenProvider:vi.fn()};
const fetchSeason=vi.fn(),connected=vi.fn();
const service=()=>new ExternalDraftGatewayService({} as never,{} as never,connection as never,{fetchSeason} as never,{connected} as never);
beforeEach(()=>{vi.clearAllMocks();fetchSeason.mockResolvedValue({body:payload()});mocks.lookup.mockResolvedValue(new Map([['1234',{nhlPlayerId:8478402,isAmbiguous:false,matchMethod:'manual'}]]));connected.mockResolvedValue({kit:{fingerprint:'a'.repeat(64)},warning:null});});
describe('external draft gateway',()=>{
  it('reads public ESPN draft data without creating a Citrus league',async()=>{
    const result=await service().snapshot('user',request);
    expect(result).toMatchObject({complete:true,unavailableIds:['8478402'],weights:{skater:{goals:7,assists:3,hits:0},goalie:{wins:0}}});
    expect(connected).not.toHaveBeenCalled();
  });
  it('blocks private ESPN data without membership and checks before identity lookup',async()=>{
    const body=payload();body.settings.isPublic=false;fetchSeason.mockResolvedValue({body});
    await expect(service().snapshot('user',request)).rejects.toThrow('member');
    expect(mocks.lookup).not.toHaveBeenCalled();
    await expect(service().snapshot('user',{...request,credentials:{espnS2:'session',swid:team.swid}})).resolves.toMatchObject({complete:true});
  });
  it('requires a connected Yahoo account',async()=>{
    connection.status.mockResolvedValue({connected:false,guid:null});
    await expect(service().snapshot('user',{platform:'yahoo',leagueId:'461.l.123',season:2026})).rejects.toThrow('Connect');
    expect(mocks.league).not.toHaveBeenCalled();
  });
  it('rejects a Yahoo league not owned by the authenticated source account',async()=>{
    connection.status.mockResolvedValue({connected:true,guid:'owner'});
    mocks.league.mockResolvedValue({content:{league:{teams:[{managers:[{guid:'someone-else'}]}]}}});
    await expect(service().snapshot('user',{platform:'yahoo',leagueId:'461.l.123',season:2026})).rejects.toThrow('not a member');
    expect(mocks.keepers).not.toHaveBeenCalled();
  });
  it('returns an incomplete snapshot for unresolved IDs and refuses to open it as ready',async()=>{
    mocks.lookup.mockResolvedValue(new Map());
    expect(await service().snapshot('user',request)).toMatchObject({complete:false,unresolved:['1234']});
    await expect(service().open('user',request)).rejects.toThrow('unresolved');
    expect(connected).not.toHaveBeenCalled();
  });
  it('opens against the existing published projection service and source weights',async()=>{
    expect(await service().open('user',request)).toMatchObject({file:{kind:'citrus-connected-desk'},snapshot:{complete:true}});
    expect(connected).toHaveBeenCalledWith('ESPN league 777',expect.objectContaining({skater:expect.objectContaining({goals:7,assists:3,hits:0})}),2026);
  });
  it('does not convert categories to points or silently drop unsupported weights',()=>{
    const settings=parseEspnSeason('777',{core:payload()}).settings;
    expect(()=>externalDraftWeights({...settings,scoringType:'h2h_categories'})).toThrow('cannot match');
    expect(()=>externalDraftWeights({...settings,scoringItems:[...settings.scoringItems,{sourceStatId:'999',citrusKey:'faceoff_wins',points:1,group:'skater',enabled:true,reverse:false}]})).toThrow('does not project');
  });
});

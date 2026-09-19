import {describe,it,expect} from 'vitest';
import {browserAvailability,readBrowserBundle,type BrowserBundle,type BrowserSnapshot} from '../browserCompanion';
import {deskFixture} from './deskFixture';
const bundle=():BrowserBundle=>({version:1,platform:'espn',file:deskFixture(),scoringVerified:false,mappings:[{externalPlayerId:'42',key:'canonical:8478402'},{externalPlayerId:'43',key:'canonical:8482116'}]});
const snapshot=():BrowserSnapshot=>({ok:true,version:1,platform:'espn',leagueId:'123',season:2026,status:'in_progress',title:'Practice',currentPick:2,totalRounds:20,picks:[{externalPlayerId:'42',overallPick:1}]});
describe('browser companion canonical availability',()=>{
 it('maps provider IDs, not player names or coincident numeric IDs',()=>{
  const b=readBrowserBundle(bundle());expect([...browserAvailability(b,snapshot(),1000,undefined,1000).unavailableIds]).toEqual(['8478402']);
 });
 it('restores players on undo and accepts off-board picks only with fully mapped board',()=>{
  const b=bundle(),first=browserAvailability(b,snapshot(),1000,undefined,1000);
  expect(browserAvailability(b,{...snapshot(),currentPick:1,picks:[]},1000,first.identity,1000).unavailableIds.size).toBe(0);
  expect(browserAvailability(b,{...snapshot(),picks:[{externalPlayerId:'99',overallPick:1}]},1000,first.identity,1000).unavailableIds.size).toBe(0);
 });
 it('rejects incomplete and ambiguous mappings',()=>{
  for(const mappings of [bundle().mappings.slice(0,1),[bundle().mappings[0],bundle().mappings[0]],[...bundle().mappings,{externalPlayerId:'44',key:'canonical:8478402'}]])expect(()=>readBrowserBundle({...bundle(),mappings})).toThrow();
 });
 it('rejects stale, changed, duplicate or partial source state',()=>{
  for(const s of [{...snapshot(),platform:'yahoo'},{...snapshot(),currentPick:3},{...snapshot(),currentPick:3,picks:[...snapshot().picks,...snapshot().picks]}])expect(()=>browserAvailability(bundle(),s as BrowserSnapshot,1000,undefined,1000)).toThrow();
  expect(()=>browserAvailability(bundle(),snapshot(),1000,undefined,8000)).toThrow();
  expect(()=>browserAvailability(bundle(),snapshot(),1000,'espn:999:2026',1000)).toThrow();
 });
 it('preserves notes and the exact forecast edition when validating',()=>{
  const b=bundle();expect(readBrowserBundle(b).file).toEqual(b.file);
 });
 it('requires a full verified ledger even when a source claims the draft finished',()=>{
  expect(()=>browserAvailability(bundle(),{...snapshot(),status:'finished'},1000,undefined,1000)).toThrow();
  const s:BrowserSnapshot={...snapshot(),status:'finished',teamCount:2,totalRounds:1,currentPick:3,picks:[{externalPlayerId:'42',overallPick:1},{externalPlayerId:'43',overallPick:2}]};
  expect(browserAvailability(bundle(),s,1000,undefined,1000).unavailableIds.size).toBe(2);
 });
});

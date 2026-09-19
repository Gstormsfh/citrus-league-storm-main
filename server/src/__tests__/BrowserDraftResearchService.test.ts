import {describe,it,expect} from 'vitest';
import {attachBrowserResearch} from '../services/BrowserDraftResearchService';
import type {ConnectedKit} from '../services/PublishedDraftDeskService';
const kit={revision:'review-1',players:[{key:'canonical:8478402',name:'Connor McDavid',team:'EDM',points:900,totals:{goals:44}}]} as unknown as ConnectedKit;
const library={asOf:'2026-09-14',items:[{playerId:8478402,name:'Connor McDavid',headline:'A reviewed story',body:'Original reviewed copy.',source:'Source publication',date:'2024-02-07',url:'https://example.com/story',sourceWordLimit:100}]};
const context={asOf:'2026-09-14',canonicalRevision:'review-1',deploymentSha256:'hash',items:[{playerId:8478402,name:'Connor McDavid',team:'EDM',headline:'Season context',body:'Original season assessment.',sources:[{label:'Reviewed news',date:'2026-09-12',url:'https://example.com/news'}]}]};
describe('authored companion research',()=>{
 it('preserves original prose, source labels and exact numerical projections',()=>{
  const result=attachBrowserResearch(kit,library,context,'hash',new Date('2026-09-19'));expect(result.players[0].research?.map(r=>r.kind)).toEqual(['history','season']);
  expect(result.players[0].research?.[0].body).toBe(library.items[0].body);expect(result.players[0].research?.[1].sources[0].label).toBe('Reviewed news');expect(Reflect.get(result.players[0],'points')).toBe(900);expect(Reflect.get(result.players[0],'totals')).toEqual({goals:44});expect(result.revision).toBe('review-1');
 });
 it('withholds season context when forecast or deployment provenance changed',()=>{
  for(const [k,h] of [[{...kit,revision:'new'},'hash'],[kit,'different']] as const)expect(attachBrowserResearch(k,library,context,h).players[0].research?.map(r=>r.kind)).toEqual(['history']);
 });
 it('withholds ambiguous stories, future dates, wrong players and unsafe links',()=>{
  for(const items of [[...library.items,...library.items],[{...library.items[0],name:'Other player'}],[{...library.items[0],url:'javascript:alert(1)'}],[{...library.items[0],date:'2027-01-01'}]])expect(attachBrowserResearch(kit,{...library,items},null,'').players[0].research).toBeUndefined();
 });
});

import { describe,it,expect } from 'vitest';
import { seasonOutlookWriteup } from '../outlook';
import { selectEditorialNews } from '../news';
import type { DashboardIndexEntry } from '../../types/playerDashboard';
const NOW=new Date('2026-09-13T12:00:00Z');
const base={id:1000,name:'Sample Forward',position:'C',is_goalie:false,gp:80,points:100,actuals_season:2025,projection_season:2026,proj_gp:80,proj_goals:35,proj_assists:80,proj_sog:280,proj_ppp:30,proj_hits:20,proj_blocks:20} as DashboardIndexEntry;
const render=(overrides:Partial<DashboardIndexEntry>={})=>seasonOutlookWriteup({...base,...overrides},[],NOW)!;
describe('evidence-led season outlooks',()=>{
 it('uses distinct arguments for equally productive stars rather than tier synonyms',()=>{
  const profiles=[render(),render({proj_sog:340}),render({position:'D'}),render({proj_goals:50,proj_assists:30,proj_gp:65,proj_sog:240}),render({proj_goals:45,proj_assists:55,proj_ppp:45})];
  expect(profiles.map(p=>p.headline)).toEqual(expect.arrayContaining([expect.stringContaining('Playmaking'),expect.stringContaining('Shot volume'),expect.stringContaining('Defence-slot'),expect.stringContaining('Goal production'),expect.stringContaining('Special-teams')]));
  const conclusions=profiles.map(p=>p.analysis.split(/[.!?]\s/)[0]);expect(new Set(conclusions).size).toBe(5);
  expect(profiles[0].summary).toContain('playmaking anchor');expect(profiles[1].summary).toContain('finishing goes quiet');
  expect(profiles[2].analysis).toContain('defencemen');expect(profiles[3].analysis).toContain('depth');expect(profiles[4].analysis).toContain('power-play bonus');
 });
 it('selects by evidence, not player identity; no default fantasy score is narrated',()=>{
  const a=render();const b=render({id:999,name:'Another Forward',proj_fantasy_points:999999,proj_fantasy_ppg:999});
  expect(b.summary.replace('Another Forward','Sample Forward')).toBe(a.summary);expect(b.analysis).toBe(a.analysis);
  expect(b.summary+b.analysis).not.toMatch(/999|fantasy points/);
 });
 it('separates an unallocated opportunity from zero talent and thin evidence from a confirmed rookie role',()=>{
  const empty=render({proj_gp:null,canonical_context:{season:2026} as never});expect(empty.summary).toContain('has not allocated');
  const thin=render({gp:0,actuals_season:null,canonical_context:{role:{pp:'PP2'}} as never});
  expect(thin.headline).toContain('Opportunity ahead');expect(thin.analysis).toContain('second power-play');expect(thin.analysis).not.toContain('will play');
 });
 it('uses published starts, never treats unspecified appearances as starts',()=>{
  const goalie={is_goalie:true,position:'G',proj_gp:55,proj_saves:1400,proj_wins:30,proj_goals_against:135};
  expect(render(goalie).summary).toContain('55 projected appearances');
  expect(render({...goalie,canonical_context:{exposure:{unit:'starts'}} as never}).summary).toContain('55 projected starts');
 });
 it('recognizes actual camp and transaction context without granting a role or promoting a trade request',()=>{
  const common={player_ids:[1000],url:'https://www.nhl.com/news/sample',source_id:'nhl',published_at:'2026-09-13T08:00:00Z'};
  const request={...common,title:'Forward trade speculation',snippet:"TORONTO -- Sample Forward’s request to be traded made headlines this offseason."};
  expect(selectEditorialNews(base,[request],NOW)[0]?.kind).toBe('trade-request');
  expect(seasonOutlookWriteup(base,[request],NOW)?.analysis).not.toContain('completed transaction');
  const camp={...common,title:'Forward attends 1st rookie practice, ready for camp',snippet:'TORONTO -- Sample Forward said the summer went quickly.'};
  expect(selectEditorialNews(base,[camp],NOW)[0]?.kind).toBe('camp');
  expect(selectEditorialNews({...base,name:'Other Forward'},[camp],NOW)).toEqual([]);
  expect(selectEditorialNews(base,[{...camp,title:'Forward might attend rookie practice'}],NOW)).toEqual([]);
 });
});

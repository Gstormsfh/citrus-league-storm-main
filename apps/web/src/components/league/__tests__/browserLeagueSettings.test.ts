import {describe,it,expect} from 'vitest';
import {reviewBrowserLeagueSettings,type LeagueSettingsCapture} from '../browserLeagueSettings';
const fixture=():LeagueSettingsCapture=>({ok:true,version:1,kind:'league-settings',platform:'espn',leagueId:'609963081',season:2026,name:'Practice league',scoringType:'Head to Head Points',teamCount:4,capturedAt:'2026-09-19T12:00:00Z',roster:[{label:'F',count:9},{label:'D',count:5},{label:'G',count:2},{label:'BE',count:5}],scoring:[{group:'skater',label:'Goals (G)',value:2},{group:'goalie',label:'Goals Against (GA)',value:-2},{group:'goalie',label:'Saves (SV)',value:0.2}],settings:[{label:'Draft Type',value:'Snake'}],coverage:{settings:true,rosters:false,history:false,keepers:false}});
describe('reviewed browser league settings',()=>{
 it('preserves forward slots and negative scoring without leaking defaults',()=>{
  const r=reviewBrowserLeagueSettings(fixture());expect(r.issues).toEqual([]);expect(r.prefill?.rosterSlots.F).toBe(9);expect(r.prefill?.rosterSlots.UTIL).toBe(0);expect(r.prefill?.rosterSlots.BN).toBe(5);expect(r.prefill?.positionType).toBe('forward');
  expect(r.prefill?.stats.find(s=>s.id==='ga')?.points).toBe(-2);expect(r.prefill?.stats.find(s=>s.id==='a')?.enabled).toBe(false);
 });
 it('does not silently drop Yahoo GWG, IR+ or NA',()=>{
  const s=fixture();s.platform='yahoo';s.scoringType='Head-to-Head - Points';s.roster.push({label:'IR+',count:2},{label:'NA',count:1});s.scoring.push({group:'skater',label:'Game-Winning Goals (GWG)',value:1});
  const r=reviewBrowserLeagueSettings(s);expect(r.prefill).toBeNull();expect(r.issues).toHaveLength(3);expect(r.issues.join(' ')).toMatch(/GWG/);
 });
 it('does not invent an ESPN overtime-loss forecast or transform categories to points',()=>{
  const s=fixture();s.scoring.push({group:'goalie',label:'Overtime Losses (OTL)',value:1});expect(reviewBrowserLeagueSettings(s).prefill).toBeNull();
  s.scoringType='Head-to-Head';expect(reviewBrowserLeagueSettings(s).issues.join(' ')).toMatch(/Scoring format/);
 });
 it('rejects duplicate, nonnumeric or falsely complete captures',()=>{
  const s=fixture();for(const bad of [{...s,scoring:[...s.scoring,s.scoring[0]]},{...s,roster:[{label:'F',count:NaN}]},{...s,coverage:{...s.coverage,rosters:true}}])expect(()=>reviewBrowserLeagueSettings(bad)).toThrow();
 });
 it('never claims player rosters, managers or history are imported',()=>{expect(reviewBrowserLeagueSettings(fixture()).notice).toMatch(/Player rosters, managers and history are not imported/);});
});

import { createRoot } from 'react-dom/client';
import '../src/pressboxFonts';
import '../src/index.css';
import { PlayerCompare, type ComparePlayer } from '../src/components/draftkit/PlayerCompare';
import { weightedCompareStats } from '../src/components/draftkit/compareAdapters';
import { deskFixture } from '../src/components/draftkit/__tests__/deskFixture';
import { HARNESS_PLAYERS, harnessHeadshotUrl } from './players';
const kit=deskFixture().kit;
const players:ComparePlayer[]=HARNESS_PLAYERS.slice(0,12).map((p,i)=>({id:p.nhlId,name:p.name,team:p.team,position:p.position,image:harnessHeadshotUrl(p.team,p.nhlId),goalie:p.position==='G',points:400+i*25,games:65+i,stats:p.position==='G'?{wins:p.wins,saves:1400+i*10,goals_against:120+i,shutouts:4}:{goals:p.goals,assists:p.assists,shots_on_goal:p.shots,power_play_points:20+(i*7)%25,blocks:90-i*7,hits:70+i*4}}));
const phone=new URLSearchParams(location.search).has('phone');
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1100,margin:'24px auto',padding:16}}>
  <h1 style={{color:'#f8f5ec',fontSize:24}}>Citrus comparison review</h1><p style={{color:'#cfdbcb'}}>Layout test data only. These numbers are not a published forecast.</p>
  {phone?<iframe title="390px mobile comparison" src="/harness/compare.html?frame" style={{width:390,maxWidth:'100%',height:1000,border:0}}/>:
    <PlayerCompare players={players} stats={weightedCompareStats(kit.weights)} context="Example points league · season projections"/>}
</main>);

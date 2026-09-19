import { createRoot } from 'react-dom/client';
import '../src/pressboxFonts';
import '../src/index.css';
import { PlayerCompare } from '../src/components/draftkit/PlayerCompare';
import { weightedCompareStats } from '../src/components/draftkit/compareAdapters';
import { deskFixture } from '../src/components/draftkit/__tests__/deskFixture';
const kit=deskFixture().kit;
const players=kit.players.map(p=>({id:p.key,name:p.name,team:p.team,position:p.position,goalie:p.goalie,points:p.points,games:p.games,stats:p.totals}));
players.push({id:'goalie1',name:'Test Goalie One',team:'AAA',position:'G',goalie:true,points:540,games:50,stats:{wins:30,saves:1450,goals_against:130,shutouts:4}},
  {id:'goalie2',name:'Test Goalie Two',team:'BBB',position:'G',goalie:true,points:580,games:55,stats:{wins:32,saves:1550,goals_against:120,shutouts:5}});
const phone=new URLSearchParams(location.search).has('phone');
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1100,margin:'24px auto',padding:16}}>
  <h1 style={{color:'#f8f5ec',fontSize:24}}>Citrus comparison review</h1><p style={{color:'#cfdbcb'}}>Layout test data only. These numbers are not a published forecast.</p>
  {phone?<iframe title="390px mobile comparison" src="/harness/compare.html?frame" style={{width:390,maxWidth:'100%',height:1000,border:0}}/>:
    <PlayerCompare players={players} stats={weightedCompareStats(kit.weights)} context="Example points league · season projections"/>}
</main>);

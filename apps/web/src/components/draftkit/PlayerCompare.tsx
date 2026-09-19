import { useId, useMemo, useState } from 'react';
import { isNativeShell } from '@/lib/nativeAuth';
import CompareCharts, { comparisonCharts } from './CompareCharts';
import './playerCompare.css';

export interface ComparePlayer {
  id: string; name: string; team: string; position: string;
  points: number | null; games: number | null; goalie: boolean;
  stats: Record<string, number | null | undefined>;
  image?: string | null; rank?: number | null; status?: string;
}
export interface CompareStat {
  key: string; label: string; group?: 'skater' | 'goalie';
  weight?: number; decimals?: number;
}
export const compareStats: CompareStat[] = [
  {key:'goals',label:'Goals',group:'skater'}, {key:'assists',label:'Assists',group:'skater'},
  {key:'shots_on_goal',label:'Shots',group:'skater'}, {key:'power_play_points',label:'Power-play points',group:'skater'},
  {key:'hits',label:'Hits',group:'skater'}, {key:'blocks',label:'Blocks',group:'skater'},
  {key:'penalty_minutes',label:'Penalty minutes',group:'skater'}, {key:'short_handed_points',label:'Short-handed points',group:'skater'},
  {key:'plus_minus',label:'Plus/minus',group:'skater'}, {key:'wins',label:'Wins',group:'goalie'},
  {key:'saves',label:'Saves',group:'goalie'}, {key:'goals_against',label:'Goals against',group:'goalie'},
  {key:'shutouts',label:'Shutouts',group:'goalie'},
];
export const finiteCompare = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fmt = (v: unknown, decimals = 1) => finiteCompare(v) ? v.toLocaleString('en-CA', {maximumFractionDigits:decimals}) : 'N/A';
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
type Props = { players: ComparePlayer[]; stats: CompareStat[]; context: string; availability?: string; rankLabel?: string };

/** Display-only: no scorer, entitlement request, pick submission or queue mutation. */
export function PlayerCompare(props: Props) {
  if (import.meta.env.VITE_NATIVE === '1' || isNativeShell()) return null;
  return <BrowserCompare {...props} />;
}
function BrowserCompare({players,stats,context,availability,rankLabel='Rank'}:Props) {
  const id = useId();
  const [open,setOpen] = useState(false), [query,setQuery] = useState('');
  const [ids,setIds] = useState<Array<string|null>>([]), [impact,setImpact] = useState(false);
  const selected = ids.flatMap((id,colorSlot) => {const p=players.find(p=>p.id===id);return p?[{...p,colorSlot}]:[];});
  const results = useMemo(()=>players.filter(p=>!ids.includes(p.id) && normalize(`${p.name} ${p.team}`).includes(normalize(query.trim()))).slice(0,8),[players,ids,query]);
  const rows = stats.filter(s => selected.some(p => !s.group || (p.goalie?'goalie':'skater')===s.group));
  const canImpact = stats.some(s=>finiteCompare(s.weight));
  function add(id:string) {setIds(old=>{
    const current=old.map(key=>players.some(p=>p.id===key)?key:null);
    if(current.includes(id)||current.filter(Boolean).length>=10)return current;
    const free=current.indexOf(null);if(free>=0)current[free]=id;else current.push(id);
    return current;
  });setQuery('');}
  return <section className="citrus-compare" aria-label="Player comparison">
    <button className="cc-toggle" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>
      <span>Compare players{selected.length ? ` · ${selected.length}` : ''}</span><span aria-hidden="true">{open?'−':'+'}</span>
    </button>
    {open && <div id={id} className="cc-body">
      <p className="cc-eyebrow">THE SIDE-BY-SIDE</p><h3>Who fits your next pick?</h3>
      <p className="cc-context">{context} Select two to ten players. Comparing never makes a pick.</p>
      {availability && <p role="status" className="cc-context">{availability}</p>}
      <div className="cc-search-row"><label>Find a player<input type="search" value={query} disabled={selected.length>=10} placeholder="Player name or team" onChange={e=>setQuery(e.target.value)} /></label>
        {selected.length>0 && <button onClick={()=>setIds([])}>Clear comparison</button>}</div>
      {selected.length<10 ? <div className="cc-results" aria-label="Players to compare">{results.map(p=><button key={p.id} aria-label={`Compare ${p.name}`} onClick={()=>add(p.id)}><strong>{p.name}</strong><span>{p.team} · {p.position}</span><span aria-hidden="true">+</span></button>)}{!results.length&&<p>No players match that search.</p>}</div>:<p role="status" className="cc-context">Ten players selected. Remove one to add another.</p>}
      {selected.length>0 && <>
        <div className="cc-view">{canImpact && <><button aria-pressed={!impact} onClick={()=>setImpact(false)}>Hockey totals</button><button aria-pressed={impact} onClick={()=>setImpact(true)}>Fantasy impact</button></>}<span>{selected.length<2?'Add another player to compare.':'Swipe the table on smaller screens.'}</span></div>
        <CompareCharts players={selected} stats={stats} impact={impact}/>
        <div className="cc-scroll" role="region" aria-label="Side-by-side player statistics" tabIndex={0}>
          <table><caption className="cc-context">{impact?'Fantasy points contributed by each scoring category':'Player projections and context'}</caption>
            <thead><tr><th scope="col">{rankLabel}</th>{selected.map(p=><th scope="col" key={p.id} style={{borderTop:`5px solid ${comparisonCharts.COLORS[p.colorSlot]}`}}>
              {p.image&&<img src={p.image} alt="" loading="lazy" onError={e=>{e.currentTarget.hidden=true;}}/>}
              <strong>{p.colorSlot+1}. {p.name}</strong><span>{p.team} · {p.position}{p.rank!=null?` · #${p.rank}`:''}</span>
              {p.status&&<span>{p.status}</span>}<button aria-label={`Remove ${p.name} from comparison`} onClick={()=>setIds(old=>old.map(id=>id===p.id?null:id))}>Remove</button>
            </th>)}</tr></thead>
            <tbody>
              <tr className="cc-points"><th scope="row">Projected FPTS</th>{selected.map(p=><td key={p.id}>{fmt(p.points)}</td>)}</tr>
              <tr><th scope="row">Workload</th>{selected.map(p=><td key={p.id}>{fmt(p.games)} <small>{p.goalie?'starts':'games'}</small></td>)}</tr>
              <tr><th scope="row">FPTS / game or start</th>{selected.map(p=><td key={p.id}>{fmt(finiteCompare(p.points)&&finiteCompare(p.games)&&p.games>0?p.points/p.games:null,2)}</td>)}</tr>
              {rows.map(s=>{
                const values=selected.map(p=>s.group&&(p.goalie?'goalie':'skater')!==s.group?null:p.stats[s.key]);
                const contributions=values.map(v=>finiteCompare(v)&&finiteCompare(s.weight)?v*s.weight:null);
                const comparable=contributions.filter(finiteCompare);
                const best=comparable.length>1&&new Set(comparable).size>1?Math.max(...comparable):null;
                return <tr key={s.key}><th scope="row">{s.label}{canImpact&&finiteCompare(s.weight)&&<small>{s.weight===0?'Not scored':`${fmt(s.weight,3)} FPTS each`}</small>}</th>{selected.map((p,i)=><td key={p.id} className={best!==null&&contributions[i]===best?'cc-edge':''}>
                  {fmt(impact?contributions[i]:values[i],s.decimals??1)}{best!==null&&contributions[i]===best&&<span className="cc-edge-label">Scoring edge</span>}
                </td>)}</tr>;
              })}
            </tbody>
          </table>
        </div>
        <p className="cc-context">N/A means unavailable or not applicable, never zero. {canImpact?'Scoring edge marks the best contribution among the selected players, including negative weights. It is not a draft recommendation.':''} Rounded components may not sum exactly to the published total.</p>
      </>}
    </div>}
  </section>;
}

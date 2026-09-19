import { useEffect, useRef, useState } from 'react';
import { getProjectionsSeason } from '@citrus/shared';
import type { ScoringSettings } from '@citrus/shared';
import { apiClient } from '@/api/client';
import { importApi, type YahooLeagueSeason } from '@/api/imports';
import { useAuth } from '@/contexts/AuthContext';
import { isNativeShell } from '@/lib/nativeAuth';
import { DraftDeskPanel, type DeskLiveState } from './ConnectedDraftDesk';
import { readDeskFile, type DeskFile } from './deskConnection';

type Source = { platform:'yahoo'|'espn'; leagueId:string; season:number; credentials?:{espnS2:string;swid:string} };
type Snapshot = {platform:Source['platform'];leagueId:string;season:number;status:'waiting'|'in_progress'|'finished'|'unknown';receivedAt:string;revision:string;complete:boolean;unavailableIds:string[];unresolved:string[];weights:Record<string,Record<string,number>>};
type Reply = {file:DeskFile;snapshot:Snapshot;warning:string|null};
const control='mt-1 block w-full rounded-lg border border-[#9dad99] bg-[#f8f5ec] p-3 text-[#10291f]';
const button='rounded-lg border border-[#9dad99] px-4 py-3 text-sm font-bold disabled:opacity-50';

export default function ExternalDraftCompanion(){
  if(import.meta.env.VITE_NATIVE==='1'||isNativeShell())return null;
  return <BrowserExternalDraftCompanion/>;
}
function BrowserExternalDraftCompanion(){
  const {user}=useAuth();
  return user?<Setup key={user.id}/>:null;
}
function Setup(){
  const [capabilities,setCapabilities]=useState<{yahoo:boolean;espn:boolean}|null>(null);
  const [platform,setPlatform]=useState<'yahoo'|'espn'>('yahoo'),[leagueId,setLeagueId]=useState('');
  const [season,setSeason]=useState(getProjectionsSeason()),[leagues,setLeagues]=useState<YahooLeagueSeason[]>([]);
  const [espnS2,setEspnS2]=useState(''),[swid,setSwid]=useState(''),[privateLeague,setPrivateLeague]=useState(false);
  const [source,setSource]=useState<Source|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{const controller=new AbortController();void apiClient.get<{yahoo:boolean;espn:boolean}>('/api/draft-kit/external/capabilities',{signal:controller.signal,retries:0}).then(r=>{
    if(!controller.signal.aborted&&r.data){setCapabilities(r.data);setPlatform(r.data.yahoo?'yahoo':'espn');}
  }).catch(()=>{/* Optional unreleased integrations do not block existing downloads. */});return()=>controller.abort();},[]);
  if(!capabilities||(!capabilities.yahoo&&!capabilities.espn))return null;
  async function loadYahoo(){
    setBusy(true);setError('');
    try{
      const connection=await importApi.yahooConnection();
      if(!connection.data?.connected){
        const result=await importApi.yahooConnectUrl();
        if(!result.data?.url||new URL(result.data.url).origin!=='https://api.login.yahoo.com')throw Error('Yahoo sign-in is unavailable.');
        window.location.assign(result.data.url);return;
      }
      const result=await importApi.yahooLeagues();
      const options=result.data?.chains.flatMap(c=>c.seasons).filter(l=>l.season===getProjectionsSeason())??[];
      setLeagues(options);if(!options.length)throw Error('No hockey leagues for this season were returned by Yahoo.');
      setLeagueId(options[0].leagueKey);setSeason(options[0].season);
    }catch(e){setError(e instanceof Error?e.message:'Could not connect Yahoo.');}finally{setBusy(false);}
  }
  function connect(){
    setError('');let value=leagueId.trim();
    if(platform==='espn'&&value.startsWith('https://')){
      try{const url=new URL(value);if(url.hostname!=='fantasy.espn.com')throw Error();value=url.searchParams.get('leagueId')??'';}catch{setError('Use your ESPN Fantasy league link or numeric league ID.');return;}
    }
    if(!(platform==='yahoo'?/^\d{1,6}\.l\.[1-9]\d{0,11}$/:/^[1-9]\d{0,11}$/).test(value)){setError('Select or enter a valid league.');return;}
    if(platform==='espn'&&privateLeague&&(!espnS2||!swid)){setError('Your private ESPN league needs both connection values.');return;}
    setSource({platform,leagueId:value,season,...(platform==='espn'&&privateLeague?{credentials:{espnS2,swid}}:{})});
    setEspnS2('');setSwid('');
  }
  return <section aria-label="External draft companion" className="mt-6 rounded-xl border border-[#9dad99] bg-[#f8f5ec] p-4 text-[#10291f]">
    <h3 className="text-xl font-bold">Follow your Yahoo or ESPN draft</h3>
    <p className="mt-2 text-sm">Keep making picks on your host platform. This read-only companion checks its available draft data every 15 seconds while this tab is visible. Provider delays can apply.</p>
    {source?<ExternalSession key={`${source.platform}:${source.leagueId}:${source.season}`} source={source} disconnect={()=>setSource(null)}/>:<>
      <label className="mt-4 block text-sm">Platform<select className={control} value={platform} onChange={e=>{setPlatform(e.target.value as 'yahoo'|'espn');setLeagueId('');setEspnS2('');setSwid('');}}>{capabilities.yahoo&&<option value="yahoo">Yahoo</option>}{capabilities.espn&&<option value="espn">ESPN</option>}</select></label>
      {platform==='yahoo'?<><button className={`${button} mt-3`} disabled={busy} onClick={()=>void loadYahoo()}>Connect Yahoo and find my leagues</button>{leagues.length>0&&<label className="mt-3 block text-sm">Yahoo league<select className={control} value={leagueId} onChange={e=>setLeagueId(e.target.value)}>{leagues.map(l=><option key={l.leagueKey} value={l.leagueKey}>{l.name} ({l.season}–{String(l.season+1).slice(-2)})</option>)}</select></label>}</>:<>
        <label className="mt-3 block text-sm">ESPN league link or ID<input className={control} value={leagueId} onChange={e=>setLeagueId(e.target.value)} maxLength={300}/></label>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={privateLeague} onChange={e=>setPrivateLeague(e.target.checked)}/>Private league</label>
        {privateLeague&&<fieldset className="mt-3"><legend className="text-sm">ESPN web connection</legend><p className="text-xs">Connection values stay in memory for this open tab and are not saved. Do not share them in chat. You may instead use manual tracking; you do not need to make your league public.</p><label className="mt-2 block text-sm">espn_s2<input type="password" autoComplete="off" className={control} value={espnS2} onChange={e=>setEspnS2(e.target.value)} maxLength={4000}/></label><label className="mt-2 block text-sm">SWID<input type="password" autoComplete="off" className={control} value={swid} onChange={e=>setSwid(e.target.value)} maxLength={38}/></label></fieldset>}
      </>}
      <p className="mt-3 text-xs">Season: {season}–{String(season+1).slice(-2)}. Points leagues only. Your source settings must be fully supported.</p>
      <button className={`${button} mt-3`} disabled={busy||!leagueId} onClick={connect}>Open draft companion</button>
    </>}
    {error&&<p role="alert" className="mt-3 text-sm">{error}</p>}
  </section>;
}

function ExternalSession({source,disconnect}:{source:Source;disconnect:()=>void}){
  const [prepared,setPrepared]=useState<Reply|null>(null),[snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [error,setError]=useState(''),[health,setHealth]=useState('Loading source draft…'),[attempt,setAttempt]=useState(0);
  const [stale,setStale]=useState(true),[sequence,setSequence]=useState(0);
  const [confirmDisconnect,setConfirmDisconnect]=useState(false);
  const sourceLabel=source.platform==='yahoo'?'Yahoo':'ESPN';
  // Return to the league without copying session-bearing draft-room URLs.
  // The host owns entry into its live room and the actual pick submission.
  const hostLeagueUrl=source.platform==='espn'
    ? `https://fantasy.espn.com/hockey/league?leagueId=${encodeURIComponent(source.leagueId)}&seasonId=${source.season+1}`
    : `https://hockey.fantasysports.yahoo.com/hockey/${encodeURIComponent(source.leagueId.split('.l.')[1])}`;
  const fileRef=useRef<DeskFile|null>(null);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,running=false,lastReceipt=0;
    const watchdog=setInterval(()=>{if(lastReceipt&&Date.now()-lastReceipt>30000){setStale(true);setHealth('No recent source response. Availability may be stale.');}},5000);
    const isCurrent=(s:Snapshot)=>s.platform===source.platform&&s.leagueId===source.leagueId&&s.season===source.season&&/^[a-f0-9]{64}$/.test(s.revision)&&Array.isArray(s.unavailableIds)&&s.unavailableIds.every(id=>/^[1-9]\d{0,9}$/.test(id));
    async function poll(){
      if(controller.signal.aborted||running)return;
      if(document.hidden){setStale(true);setHealth('Updates paused while this tab is hidden.');return;}
      running=true;
      try{
        if(!fileRef.current){
          const result=await apiClient.post<Reply>('/api/draft-kit/external/open',source,{signal:controller.signal,retries:0,timeoutMs:55000});
          if(controller.signal.aborted)return;
          if(!result.data||!isCurrent(result.data.snapshot)||!result.data.snapshot.complete)throw Error('The source draft could not be verified.');
          const file=readDeskFile(JSON.stringify(result.data.file));
          fileRef.current=file;setPrepared({...result.data,file});setSnapshot(result.data.snapshot);
        }else{
          const result=await apiClient.post<Snapshot>('/api/draft-kit/external/snapshot',source,{signal:controller.signal,retries:0,timeoutMs:45000});
          if(controller.signal.aborted)return;
          if(!result.data||!isCurrent(result.data))throw Error('The source draft could not be verified.');
          if(!result.data.complete)throw Error('Some player identities could not be matched. Previous availability is retained.');
          if(JSON.stringify(result.data.weights)!==JSON.stringify(fileRef.current.kit.weights))throw Error('League scoring changed. Disconnect and reopen to refresh your rankings.');
          setSnapshot(result.data);
        }
        lastReceipt=Date.now();setSequence(v=>v+1);setStale(document.hidden);setError('');setHealth(document.hidden?'Updates paused while this tab is hidden.':'Latest available provider snapshot received. This is not a guaranteed real-time feed.');
      }catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Source unavailable.');setStale(true);setHealth('Source update failed. Previous availability may be stale.');}}
      finally{running=false;if(!controller.signal.aborted&&!document.hidden)timer=setTimeout(()=>void poll(),15000);}
    }
    const visibility=()=>{clearTimeout(timer);setStale(true);if(document.hidden)setHealth('Updates paused while this tab is hidden.');else void poll();};
    document.addEventListener('visibilitychange',visibility);void poll();
    return()=>{controller.abort();clearTimeout(timer);clearInterval(watchdog);document.removeEventListener('visibilitychange',visibility);};
  },[source,attempt]);
  const live:DeskLiveState={sourceLabel,sequence,unavailableIds:new Set(snapshot?.unavailableIds??[]),status:stale?'disconnected':snapshot?.status==='finished'?'finished':snapshot?.status==='in_progress'?'live':'waiting'};
  return <div className="mt-4">
    <a className={`${button} mb-3 inline-flex`} href={hostLeagueUrl} target="_blank" rel="noopener noreferrer">Open {sourceLabel} league ↗</a>
    <p className="mb-3 text-xs">Enter the draft from your host league. Citrus targets are a separate shortlist, not your host’s autopick queue.</p>
    <p role="status" className="text-sm">{health}</p>
    {snapshot&&<p className="mt-1 text-xs">Last receipt: {new Date(snapshot.receivedAt).toLocaleTimeString()}. {snapshot.unavailableIds.length} players drafted or kept.</p>}
    {error&&<p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
    <div className="my-3 flex flex-wrap gap-2"><button className={button} onClick={()=>setAttempt(n=>n+1)}>Retry connection</button><button className={button} onClick={()=>setConfirmDisconnect(true)}>Disconnect companion</button></div>
    {confirmDisconnect&&<div role="alert" className="my-3 rounded-lg border border-orange-400 p-3 text-sm"><p>Download a progress backup from Desk options before disconnecting. External-draft notes and targets are not saved to your account.</p><button className={`${button} mt-2`} onClick={disconnect}>Disconnect and clear this tab</button><button className={`${button} ml-2 mt-2`} onClick={()=>setConfirmDisconnect(false)}>Keep working</button></div>}
    {prepared?.warning&&<p role="status" className="mb-3 text-sm">{prepared.warning}</p>}
    {prepared&&<DraftDeskPanel initialFile={prepared.file} live={live} scoring={prepared.file.kit.weights as unknown as ScoringSettings} scoringReady/>}
  </div>;
}

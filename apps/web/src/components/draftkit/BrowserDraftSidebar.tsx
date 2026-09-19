import {useEffect,useRef,useState} from 'react';
import type {ScoringSettings} from '@citrus/shared';
import {DraftDeskPanel,type DeskLiveState} from './DraftDeskPanel';
import {browserAvailability,readBrowserBundle,type BrowserBundle,type BrowserSnapshot} from './browserCompanion';
import {reviewBrowserLeagueSettings} from '../league/browserLeagueSettings';

export type CompanionSend=(message:Record<string,unknown>)=>Promise<any>;
/** Packaged in the extension. No auth tokens, provider APIs or draft mutations. */
export function BrowserDraftSidebar({send}:{send:CompanionSend}) {
  const [bundle,setBundle]=useState<BrowserBundle|null>(null),[snapshot,setSnapshot]=useState<BrowserSnapshot|null>(null);
  const [live,setLive]=useState<DeskLiveState>({status:'waiting',unavailableIds:new Set(),sequence:null});
  const [error,setError]=useState(''),[saving,setSaving]=useState('Saved'),[setup,setSetup]=useState(false);
  const [leagueReview,setLeagueReview]=useState<ReturnType<typeof reviewBrowserLeagueSettings>|null>(null);
  const [confirmDisconnect,setConfirmDisconnect]=useState(false);
  const identity=useRef<string>(),receipt=useRef(0),bundleRef=useRef<BrowserBundle|null>(null);
  const saveQueue=useRef(Promise.resolve());
  useEffect(()=>{
    let stopped=false,pending=false;
    async function poll(){
      if(stopped||pending)return;pending=true;
      try {
        const result=await send({type:'PANEL_READ'});if(stopped)return;
        if(!result?.ok)throw Error(result?.message??'Waiting for your source draft.');
        if(result.snapshot?.kind==='league-settings'){setLeagueReview(reviewBrowserLeagueSettings(result.snapshot));setError('');return;}
        if(!result.bundle){setSnapshot(result.snapshot);setError('');return;}
        const next=readBrowserBundle(result.bundle);
        if(bundleRef.current&&bundleRef.current.file.kit.fingerprint!==next.file.kit.fingerprint)throw Error('The board edition changed. Reopen the sidebar before continuing.');
        const available=browserAvailability(next,result.snapshot,result.receivedAt,identity.current);
        identity.current=available.identity;receipt.current=result.receivedAt;
        if(!bundleRef.current){bundleRef.current=next;setBundle(next);}
        setSnapshot(result.snapshot);setLive({status:result.snapshot.status==='finished'?'finished':'live',transport:'browser',sourceLabel:next.platform==='espn'?'ESPN':'Yahoo',unavailableIds:available.unavailableIds,sequence:result.snapshot.picks.length});
        setError('');
      }catch(e){if(!stopped){setError(e instanceof Error?e.message:'Draft connection interrupted.');setLive(old=>({...old,status:old.sequence===null?'waiting':'disconnected'}));}}
      finally{pending=false;}
    }
    void poll();const timer=window.setInterval(()=>{
      if(receipt.current&&Date.now()-receipt.current>6000)setLive(old=>({...old,status:'disconnected'}));
      void poll();
    },2000);
    return()=>{stopped=true;clearInterval(timer);};
  },[send]);
  function edit(key:string,patch:{note?:string;target?:boolean}){
    setSaving('Saving…');
    const operation=async()=>{
      for(let attempt=0;attempt<3;attempt++){
        const result=await send({type:'SAVE_NOTE',key,patch,fingerprint:bundleRef.current?.file.kit.fingerprint});
        if(result?.ok)return;
        if(attempt===2)throw Error('Notes are not saved. Keep this panel open and download a backup.');
        await new Promise(r=>setTimeout(r,400));
      }
    };
    const queued=saveQueue.current.catch(()=>{}).then(operation);saveQueue.current=queued;
    void queued.then(()=>{if(saveQueue.current===queued)setSaving('Saved');}).catch(e=>setSaving(e.message));
  }
  async function prepare(){
    setSetup(true);try{const r=await send({type:leagueReview?'PREPARE_IMPORT':'PREPARE_KIT'});if(!r?.ok)throw Error(r?.message??'Could not open setup.');}
    catch(e){setError(e instanceof Error?e.message:'Could not open kit setup.');}finally{setSetup(false);}
  }
  async function disconnect(){
    await send({type:'DISCONNECT'});
    setConfirmDisconnect(false);setError('Disconnected. Your source draft has not changed. Download your notebook before closing this panel.');
    setLive(old=>({...old,status:'disconnected'}));
  }
  return <main className="citrus-browser-sidebar">
    <div className="bridge-source"><strong>{(snapshot?.platform??leagueReview?.capture.platform)==='yahoo'?'Yahoo':(snapshot?.platform??leagueReview?.capture.platform)==='espn'?'ESPN':'Citrus'} companion</strong><span>Read-only</span></div>
    {error&&<p role="alert" className="bridge-warning">{error}</p>}
    {confirmDisconnect&&<section className="bridge-warning" aria-label="Disconnect confirmation"><p>Download your notebook from Desk options before disconnecting. Your saved sidebar session will be removed. ESPN and Yahoo are not changed.</p><button onClick={()=>void disconnect()}>Disconnect this sidebar</button><button onClick={()=>setConfirmDisconnect(false)}>Keep connected</button></section>}
    {leagueReview?<section className="bridge-setup"><p className="bridge-eyebrow">READ-ONLY SETTINGS CAPTURE</p><h1>{leagueReview.capture.name}</h1><p>{leagueReview.capture.teamCount} teams · {leagueReview.capture.scoringType}</p><p>{leagueReview.notice}</p><h2 className="mt-4 font-bold">Roster positions</h2><p>{leagueReview.capture.roster.filter(r=>r.count).map(r=>`${r.label} × ${r.count}`).join(' · ')}</p><h2 className="mt-4 font-bold">Scoring</h2><dl>{leagueReview.capture.scoring.map(r=><div className="flex justify-between gap-3 text-sm" key={r.group+r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>{leagueReview.issues.length>0&&<div className="bridge-warning"><strong>Needs review before import</strong><ul>{leagueReview.issues.map(v=><li key={v}>{v}</li>)}</ul></div>}<button disabled={setup} onClick={()=>void prepare()}>Review settings on Citrus</button><p className="bridge-small">No settings or leagues have been changed on either platform.</p></section>:!bundle?<section className="bridge-setup"><p className="bridge-eyebrow">YOUR NEXT PICK, IN FOCUS</p><h1>Your draft stays right here.</h1><p>Bring your purchased Citrus board into this sidebar for rankings, projections, a shortlist, notes and player comparisons.</p><button disabled={!snapshot||setup} onClick={()=>void prepare()}>Connect my Citrus kit</button><p className="bridge-small">One-time setup opens Citrus to verify your kit. During the draft, make picks in ESPN or Yahoo while your tools stay beside it. No provider password or cookies needed.</p></section>:
      <DraftDeskPanel initialFile={bundle.file} live={live} scoring={bundle.file.kit.weights as unknown as ScoringSettings} scoringReady={bundle.scoringVerified} cloud={{scope:'browser',status:saving,onEdit:edit}}/>}
    {snapshot?.platform==='yahoo'&&<p className="bridge-small">Keep Yahoo’s Picks panel open while browsing Players. If history is incomplete after a reload, open Results → Round by Round to recover it.</p>}
    {snapshot?.status==='paused'&&<p className="bridge-small">The provider draft is paused.</p>}
    {(bundle||leagueReview)&&<button className="bridge-small underline" onClick={()=>setConfirmDisconnect(true)}>Disconnect…</button>}
  </main>;
}

import {useState} from 'react';
import {isNativeShell} from '@/lib/nativeAuth';
import {browserHandoffHash} from '@/lib/browserHandoff';
import {reviewBrowserLeagueSettings,type LeagueSettingsPrefill} from './browserLeagueSettings';
export function BrowserLeagueSettingsHandoff({onApply}:{onApply:(s:LeagueSettingsPrefill)=>void}){
  const [review,setReview]=useState<ReturnType<typeof reviewBrowserLeagueSettings>|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  if(import.meta.env.VITE_NATIVE==='1'||isNativeShell())return null;
  const hash=browserHandoffHash('/create-league',location.hash);
  const match=/^#citrus-bridge=([a-p]{32})\.(.+)$/.exec(hash);if(!match)return null;
  async function read(){
    setBusy(true);setMessage('');setReview(null);
    try{
      const runtime=(window as any).chrome?.runtime;if(!runtime)throw Error('Open this page from the Citrus sidebar.');
      const response:any=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('The extension did not respond.')),8000);runtime.sendMessage(match![1],{type:'LEAGUE_SETTINGS',nonce:match![2]},(r:any)=>{clearTimeout(timer);runtime.lastError?reject(Error('Extension connection unavailable.')):resolve(r);});});
      if(!response?.ok)throw Error(response?.message??'No league settings returned.');setReview(reviewBrowserLeagueSettings(response.settings));
    }catch(e){setMessage(e instanceof Error?e.message:'Could not review settings.');}finally{setBusy(false);}
  }
  return <section className="mb-6 rounded-xl border border-pastel-orange/40 bg-[#f8f5ec] p-5 text-[#10291f]" aria-label="Review browser league settings"><h2 className="text-xl font-bold">Bring your settings from ESPN or Yahoo</h2><p className="mt-2 text-sm">Read the captured settings, review any differences, then apply them to the form. Nothing is created until you submit the normal Create League form.</p><button className="my-3 rounded-lg bg-[#ff6b1a] px-4 py-2 font-bold" disabled={busy} onClick={()=>void read()}>Review captured settings</button>{review&&<><h3 className="font-bold">{review.capture.name} · {review.capture.teamCount} teams</h3><p className="mt-2 text-sm">{review.notice}</p><dl className="my-3 text-sm"><dt className="font-bold">Roster</dt><dd>{review.capture.roster.filter(r=>r.count).map(r=>`${r.label} × ${r.count}`).join(' · ')}</dd><dt className="mt-2 font-bold">Scoring</dt><dd>{review.capture.scoring.map(r=>`${r.label}: ${r.value}`).join(' · ')}</dd></dl>{review.issues.length?<ul role="alert" className="my-3 list-inside list-disc text-sm">{review.issues.map(v=><li key={v}>{v}</li>)}</ul>:<button className="rounded-lg bg-[#10291f] px-4 py-2 font-bold text-white" onClick={()=>{onApply(review.prefill!);setMessage('Supported settings applied. Review the remaining form before creating your league.');}}>Apply reviewed settings to form</button>}</>}{message&&<p role="status" className="mt-3 text-sm">{message}</p>}</section>;
}

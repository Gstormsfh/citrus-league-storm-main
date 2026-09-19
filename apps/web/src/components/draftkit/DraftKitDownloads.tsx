import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { apiClient } from '@/api/client';
import { readSettings,scoringProblem,SETTINGS_KEY } from './savedSettings';
import { purchaseDate } from './purchaseDates';
import ExternalDraftCompanion from './ExternalDraftCompanion';

type Offer = { available:boolean; deliveryReady:boolean; accessUntil:string|null; updatesUntil:string|null; termsUrl:string|null };
type Access = { active:boolean; accessUntil:string|null };
type Configuration = { weights:Record<string,Record<string,number>>; projectionDate:string; revision:string; downloadOrigin?:string };
const labels:Record<string,string>={goals:'Goals',assists:'Assists',shots_on_goal:'Shots on goal',power_play_points:'Power-play points',short_handed_points:'Short-handed points',hits:'Hits',blocks:'Blocks',penalty_minutes:'Penalty minutes',plus_minus:'Plus/minus',wins:'Wins',saves:'Saves',shutouts:'Shutouts',goals_against:'Goals against'};
const formats = [['pdf','Full draft kit'],['desk','Offline draft desk'],['cheatsheet','Compact cheat sheet'],['tracker','Clickable draft checklist'],['csv','Rankings CSV']] as const;

/** A payment return URL is never an entitlement. The server verifies every download. */
export function DraftKitDownloads() {
  if (import.meta.env.VITE_NATIVE === '1' || Capacitor.isNativePlatform()) return null;
  return <WebDraftKitDownloads />;
}

function WebDraftKitDownloads() {
  const [offer,setOffer]=useState<Offer|null>(null),[access,setAccess]=useState<Access|null>(null);
  const [config,setConfig]=useState<Configuration|null>(null);
  const [weights,setWeights]=useState<Record<string,Record<string,string>>>({});
  const [league,setLeague]=useState('My league'),[busy,setBusy]=useState(false);
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[needsLogin,setNeedsLogin]=useState(false);
  const hydrated=useRef(false);
  const checkoutAttempt=useRef(crypto.randomUUID());
  const refresh=useCallback(async()=>{
    setError('');setBusy(true);
    try {
      const result=await apiClient.get<Offer>('/api/draft-kit/pdf/offer',{retries:0});
      if(!result.data)throw Error('Could not load the offer.');
      setOffer({...result.data,available:false});
      if(!result.data.deliveryReady){setAccess(null);setConfig(null);return;}
      // A checkout outage must not prevent an existing buyer from downloading.
      const checkoutOffer=await apiClient.get<Omit<Offer,'deliveryReady'>>('/api/draft-kit/checkout/offer',{retries:0}).catch(()=>null);
      if(checkoutOffer?.data)setOffer({...checkoutOffer.data,deliveryReady:true});
      const own=await apiClient.get<Access>('/api/draft-kit/pdf/access',{retries:0});
      setAccess(own.data??null);setNeedsLogin(false);
      if(own.data?.active){
        const settings=await apiClient.get<Configuration>('/api/draft-kit/pdf/configuration',{retries:0});
        if(!settings.data)throw Error('Could not load scoring settings.');
        setConfig(settings.data);
        if(!hydrated.current){
          let saved=null;try{saved=readSettings(window.localStorage,settings.data.weights);}catch{/* Storage can be disabled. */}
          setWeights(saved?.weights??Object.fromEntries(Object.entries(settings.data.weights).map(([group,values])=>[group,Object.fromEntries(Object.entries(values).map(([key,value])=>[key,String(value)]))])));
          if(saved)setLeague(saved.league);
          hydrated.current=true;
        }
        setMessage('Your draft kit is ready. Set your scoring and choose a download.');
      } else {setConfig(null);setMessage('Already paid? Refresh access after payment confirmation. You do not need to buy again.');}
    } catch(e) {
      if(e && typeof e==='object' && 'status' in e && e.status===401){setNeedsLogin(true);setAccess(null);setConfig(null);}
      else setError(e instanceof Error?e.message:'Could not check access. Please retry.');
    } finally {setBusy(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  async function checkout(){
    setBusy(true);setError('');
    try {
      const result=await apiClient.post<{url:string}>('/api/draft-kit/checkout/session',{}, {retries:0,headers:{'x-checkout-attempt':checkoutAttempt.current}});
      if(!result.data?.url || new URL(result.data.url).origin!=='https://checkout.stripe.com')throw Error('The payment page is unavailable.');
      window.location.assign(result.data.url);
    } catch(e){setError(e instanceof Error?e.message:'Could not open checkout.');}
    finally{setBusy(false);}
  }
  const scoringError=config?scoringProblem(weights):null;
  const valid=!!config && !!league.trim() && !scoringError;
  function saveSettings(){
    try{window.localStorage.setItem(SETTINGS_KEY,JSON.stringify({version:1,league:league.trim(),weights}));setMessage('Settings saved on this browser. This is not cloud sync or proof of purchase.');}
    catch{setError('This browser cannot save settings. You can still download your kit.');}
  }
  function resetSettings(){
    if(!config)return;
    setWeights(Object.fromEntries(Object.entries(config.weights).map(([g,values])=>[g,Object.fromEntries(Object.entries(values).map(([k,v])=>[k,String(v)]))])));
    setMessage('Citrus default weights restored. Your saved settings have not been overwritten.');
  }
  async function download(format:string){
    if(!valid)return;setBusy(true);setError('');setMessage('Building your download. Large editions can take a couple of minutes.');
    try {
      const numeric=Object.fromEntries(Object.entries(weights).map(([group,values])=>[group,Object.fromEntries(Object.entries(values).map(([key,value])=>[key,Number(value)]))]));
      const result=await apiClient.post<{base64:string;mime:string;filename:string}>('/api/draft-kit/pdf/download',{format,league:league.trim(),weights:numeric},{retries:0,timeoutMs:200000,...(config.downloadOrigin?{endpointOrigin:config.downloadOrigin}:{})});
      if(!result.data)throw Error('The download response was empty.');
      const bytes=Uint8Array.from(atob(result.data.base64),c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:result.data.mime}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=result.data.filename;anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);
      setMessage(format==='desk'?'Offline desk downloaded. Open the HTML for manual pick tracking and save your progress. On the Citrus website, your purchased Draft Desk opens automatically in the browser draft room. It uses published projections, which may differ from this dated download.':format==='csv'?'CSV downloaded. Blank stats mean unavailable or not applicable, not zero.':'Download ready. Save your copy before editing or printing.');
    }catch(e){setError(e instanceof Error?e.message:'Could not generate your download. Please retry.');}
    finally{setBusy(false);}
  }
  return <section aria-label="Your draft-kit downloads" className="mt-6 rounded-xl border border-white/15 p-5 text-pastel-cream">
    <h3 className="text-xl font-bold">Your draft-kit downloads</h3>
    {offer && !offer.available && !access?.active && <p className="mt-2 text-sm text-white/70">Purchases are not open yet. No payment is collected.</p>}
    {offer?.available && !access?.active && <>
      <p className="mt-2 text-sm">$7.99 CAD, one-time purchase. Applicable taxes are shown at checkout. No automatic renewal.</p>
      <p className="mt-2 text-sm text-white/70">Revised editions through {purchaseDate(offer.updatesUntil)}. Re-downloads through {purchaseDate(offer.accessUntil)}.</p>
      {offer.termsUrl && <a className="mt-2 inline-block underline" href={offer.termsUrl}>Read the purchase terms</a>}
      {needsLogin?<a href="/auth?redirect=%2Fdraft-kit%3Ftab%3Dpricing" className="mt-4 inline-block rounded-lg bg-[#f8f5ec] px-5 py-3 font-bold text-[#10291f]">Sign in or create an account</a>:<button type="button" disabled={busy} onClick={()=>void checkout()} className="mt-4 block rounded-lg bg-[#ff6b1a] px-5 py-3 font-bold text-[#10291f] disabled:opacity-50">Buy the kit for $7.99 CAD</button>}
    </>}
    {access?.active && config && <>
      <ExternalDraftCompanion />
      <div className="mt-4 rounded-lg bg-[#f8f5ec] p-4 text-[#10291f]"><strong>Drafting on the Citrus website? You’re ready.</strong><p className="mt-1 text-sm">Open your league’s browser draft room. Your purchased kit appears in Draft Desk automatically, with your league’s scoring. No download or upload needed. Draft Desk is not available in the iPhone or Android app.</p></div>
      <p className="mt-2 text-sm text-white/70">Access through {purchaseDate(access.accessUntil)}. Download edition projection date: {config.projectionDate}.</p>
      <p className="mt-3 text-sm text-white/75">Enter your league's points per stat, not its category totals. A negative weight deducts points. Set every goalie weight to zero for a skater-only board.</p>
      <label className="mt-5 block text-sm font-bold">League name<input value={league} maxLength={64} disabled={busy} onChange={e=>setLeague(e.target.value)} className="mt-2 block w-full rounded border border-white/25 bg-[#10291f] p-3" /></label>
      <div className="mt-5 grid gap-6 sm:grid-cols-2">{Object.entries(weights).map(([group,values])=><fieldset key={group} disabled={busy}><legend className="mb-3 font-bold">{group==='skater'?'Skaters':'Goalies'}</legend>{Object.entries(values).map(([key,value])=><label key={key} className="mb-2 flex items-center justify-between gap-4 text-sm">{labels[key]??key}<input aria-label={`${group} ${labels[key]??key}`} type="number" step="any" min="-10000" max="10000" value={value} onChange={e=>setWeights(old=>({...old,[group]:{...old[group],[key]:e.target.value}}))} className="w-24 rounded border border-white/25 bg-[#10291f] p-2" /></label>)}</fieldset>)}</div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{formats.map(([format,label])=><button key={format} type="button" disabled={busy||!valid} onClick={()=>void download(format)} className="rounded-lg bg-[#f8f5ec] px-4 py-3 text-sm font-bold text-[#10291f] disabled:opacity-50">{label}</button>)}</div>
      {scoringError&&<p role="alert" className="mt-3 text-sm text-orange-200">{scoringError}</p>}
      <div className="mt-4 flex flex-wrap gap-4 text-sm"><button type="button" disabled={busy||!valid} onClick={saveSettings} className="underline disabled:opacity-50">Save settings on this browser</button><button type="button" disabled={busy} onClick={resetSettings} className="underline">Reset to Citrus defaults</button></div>
    </>}
    {message&&<p role="status" className="mt-3 text-sm text-white/75">{message}</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-orange-200">{error}</p>}
    {(offer?.deliveryReady||error)&&<button type="button" disabled={busy} onClick={()=>void refresh()} className="mt-3 text-sm underline disabled:opacity-50">Refresh purchase access</button>}
  </section>;
}

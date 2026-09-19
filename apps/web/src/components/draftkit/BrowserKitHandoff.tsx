import {useState} from 'react';
import {apiClient} from '@/api/client';
import {readBrowserBundle,type BrowserBundle} from './browserCompanion';
import {isNativeShell} from '@/lib/nativeAuth';
type BrowserRuntime={sendMessage:(id:string,message:unknown,callback:(reply:any)=>void)=>void;lastError?:unknown};
export function BrowserKitHandoff({league,weights,disabled}:{league:string;weights:Record<string,Record<string,string>>;disabled:boolean}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  if(import.meta.env.VITE_NATIVE==='1'||isNativeShell())return null;
  const match=/^#citrus-bridge=([a-p]{32})\.([0-9a-f-]{36})$/.exec(window.location.hash);
  if(!match)return null;
  async function transfer(){
    if(!match)return;
    setBusy(true);setMessage('Preparing your sidebar board…');
    const runtime=(window as unknown as {chrome?:{runtime?:BrowserRuntime}}).chrome?.runtime;
    const send=(type:string,extra={})=>new Promise<any>((resolve,reject)=>{
      if(!runtime){reject(Error('Open kit setup from the Citrus extension.'));return;}
      const timer=setTimeout(()=>reject(Error('The extension did not respond. Reopen setup from your sidebar.')),8000);
      runtime.sendMessage(match[1],{type,nonce:match[2],...extra},result=>{clearTimeout(timer);runtime.lastError?reject(Error('The extension connection is unavailable.')):resolve(result);});
    });
    try{
      const source=await send('SNAPSHOT');if(!source?.ok)throw Error(source?.message??'The source draft is unavailable.');
      const numeric=Object.fromEntries(Object.entries(weights).map(([g,values])=>[g,Object.fromEntries(Object.entries(values).map(([k,v])=>[k,Number(v)]))]));
      const result=await apiClient.post<{bundle:BrowserBundle;warning:string|null}>('/api/draft-kit/external/browser-kit',{platform:source.snapshot.platform,league:league.trim(),weights:numeric},{retries:0,timeoutMs:60000});
      if(!result.data)throw Error('No companion board was returned.');
      const bundle=readBrowserBundle(result.data.bundle);
      const installed=await send('INSTALL_KIT',{bundle});if(!installed?.ok)throw Error(installed?.message??'The board could not be attached.');
      setMessage('Your tools are ready in the draft sidebar. Return to your ESPN or Yahoo draft tab.'+(result.data.warning?' '+result.data.warning:''));
    }catch(e){setMessage(e instanceof Error?e.message:'Could not connect the kit.');}finally{setBusy(false);}
  }
  return <section className="mt-4 rounded-lg bg-[#f8f5ec] p-4 text-[#10291f]" aria-label="Connect kit to draft sidebar"><h4 className="font-bold">Your Citrus tools, beside your draft</h4><p className="mt-2 text-sm">Use the scoring settings below to prepare your board. This does not verify or change ESPN or Yahoo scoring. Rankings, research and comparisons stay in the sidebar; make picks in your provider’s draft room.</p><button disabled={disabled||busy} className="mt-3 rounded-lg bg-[#ff6b1a] px-4 py-3 font-bold disabled:opacity-50" onClick={()=>void transfer()}>Send my kit to the draft sidebar</button>{message&&<p role="status" className="mt-2 text-sm">{message}</p>}</section>;
}

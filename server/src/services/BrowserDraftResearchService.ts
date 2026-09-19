import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {ConnectedKit} from './PublishedDraftDeskService';

type Read={headline:string;body:string;date:string;kind:'history'|'season';sources:Array<{label:string;url:string}>};
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const https=(v:unknown)=>{try{const u=new URL(String(v));return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
/** Existing authored guide copy, unchanged. No generated fallback, forecasts or
 * deployment guesses. Each fact retains its date; season copy is revision-bound. */
export function attachBrowserResearch(kit:ConnectedKit,library:any,context:any,reviewHash:string,now=new Date()){
  const today=now.toISOString().slice(0,10),date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v<=today;
  const items=Array.isArray(library?.items)&&date(library.asOf)?library.items:[];
  const contexts=Array.isArray(context?.items)&&context.canonicalRevision===kit.revision&&context.deploymentSha256===reviewHash&&date(context.asOf)?context.items:[];
  const players=kit.players.map(p=>{
    const id=p.key.slice('canonical:'.length),research:Read[]=[];
    const matches=items.filter((s:any)=>String(s.playerId)===id&&s.name===p.name);
    if(matches.length===1){
      const s=matches[0];
      if(text(s.headline,180)&&text(s.body,5000)&&text(s.source,160)&&date(s.date)&&s.date<=library.asOf&&https(s.url)
        &&Number.isFinite(s.sourceWordLimit)&&(s.headline+' '+s.body).split(/\s+/).length<=s.sourceWordLimit)
        research.push({headline:s.headline,body:s.body,date:s.date,kind:'history',sources:[{label:s.source,url:s.url}]});
    }
    const current=contexts.filter((s:any)=>String(s.playerId)===id&&s.name===p.name&&s.team===p.team);
    if(current.length===1){
      const s=current[0],sources=Array.isArray(s.sources)?s.sources:[];
      if(text(s.headline,180)&&text(s.body,5000)&&sources.length>0&&sources.length<=8&&sources.every((v:any)=>v.kind==='canonical'||(date(v.date)&&v.date<=context.asOf&&https(v.url))))
        research.push({headline:s.headline,body:s.body,date:context.asOf,kind:'season',sources:sources.filter((v:any)=>v.kind!=='canonical').map((v:any)=>({label:String(v.label??v.source??v.title??new URL(v.url).hostname).slice(0,160),url:v.url}))});
    }
    return {...p,...(research.length?{research}:{})};
  });
  // This is the same forecast revision, with a distinct content fingerprint.
  const fingerprint=createHash('sha256').update(JSON.stringify({...kit,players,fingerprint:undefined})).digest('hex');
  return {...kit,players,fingerprint};
}
export class BrowserDraftResearchService {
  constructor(private root=process.env.DRAFT_KIT_EDITORIAL_ROOT||''){}
  async attach(kit:ConnectedKit){
    if(!this.root)return {kit,warning:'Authored guide research is not configured for this companion yet.'};
    try{
      const [library,context,deployment]=await Promise.all(['player-story-library.json','player-season-context.json','deployment-research.json'].map(name=>readFile(join(this.root,name),'utf8')));
      return {kit:attachBrowserResearch(kit,JSON.parse(library),JSON.parse(context),createHash('sha256').update(deployment).digest('hex')),warning:null};
    }catch{return {kit,warning:'Guide research is temporarily unavailable. Projections and draft tools are still available.'};}
  }
}

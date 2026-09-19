// Local UI acceptance harness only. Never copied into the extension package.
import {createRoot} from 'react-dom/client';
import {BrowserDraftSidebar} from '../web/src/components/draftkit/BrowserDraftSidebar';
import type {BrowserBundle} from '../web/src/components/draftkit/browserCompanion';
const bundle:BrowserBundle=await fetch('/review-bundle.json').then(r=>r.json());
let picks:Array<{externalPlayerId:string;overallPick:number}>=[],connected=true;
const send=async(message:Record<string,any>)=>{
 if(message.type==='SAVE_NOTE'){
  const old=bundle.file.progress.rows.find(r=>r.key===message.key);
  bundle.file.progress.rows=[...bundle.file.progress.rows.filter(r=>r.key!==message.key),{key:message.key,drafted:false,target:false,note:'',...old,...message.patch}];return{ok:true};
 }
 if(message.type==='DISCONNECT')connected=false;
 if(!connected)return{ok:false,message:'Simulated connection interrupted. Last confirmed board retained.'};
 return{ok:true,bundle,receivedAt:Date.now(),snapshot:{ok:true,version:1,platform:bundle.platform,leagueId:'123',season:2026,title:'Local interaction test',status:'in_progress',currentPick:picks.length+1,totalRounds:25,picks}};
};
document.getElementById('pick')!.onclick=()=>{const m=bundle.mappings[picks.length];if(m)picks.push({externalPlayerId:m.externalPlayerId,overallPick:picks.length+1});};
document.getElementById('undo')!.onclick=()=>{picks.pop();};
document.getElementById('connection')!.onclick=()=>{connected=!connected;};
createRoot(document.getElementById('root')!).render(<BrowserDraftSidebar send={send}/>);

// Follow only public gamecenter endpoints and their linked reports. No production writes.
const fs=require('fs'),crypto=require('crypto');
const out='scripts/proof/results/gamecenter-pass-sources-20260907';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(n,v)=>fs.writeFileSync(`${out}/${n}`,JSON.stringify(v,null,2),{flag:'wx'});
async function get(url,name){const r=await fetch(url,{signal:AbortSignal.timeout(20000)}),b=await r.text();fs.writeFileSync(`${out}/${name}.body`,b,{flag:'wx'});save(name+'.receipt.json',{url,status:r.status,sha256:sha(b),retrieved_at:new Date().toISOString()});if(!r.ok)throw Error(`${name}: ${r.status}`);return b;}
function paths(v,p='',s=new Set()){if(Array.isArray(v))for(const x of v)paths(x,p+'[]',s);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){s.add(p+'.'+k);paths(x,p+'.'+k,s);}return s;}
(async()=>{fs.mkdirSync(out);const game=2025030416;
const landing=JSON.parse(await get(`https://api-web.nhle.com/v1/gamecenter/${game}/landing`,'landing'));
const rail=JSON.parse(await get(`https://api-web.nhle.com/v1/gamecenter/${game}/right-rail`,'right-rail'));
save('api-paths.json',{landing:[...paths(landing)].sort(),right_rail:[...paths(rail)].sort()});
const reports=[];
for(const [key,url]of Object.entries(rail.gameReports??{})){
 if(!/playByPlay|shotSummary/i.test(key)||typeof url!=='string'||!url.startsWith('https://www.nhl.com/scores/htmlreports/'))continue;
 const b=await get(url,key),plain=b.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
 const mentions=[...plain.matchAll(/.{0,80}\b(?:pass|passing|assist|hand-pass)\b.{0,100}/gi)].map(m=>m[0]);
 reports.push({key,url,pass_word_contexts:mentions});
}
save('summary.json',{game,reports,game_video:rail.gameVideo,report_links:rail.gameReports,
 scope:'One inspected official gamecenter; report text matches are not pass labels',production_changed:false});
console.log(JSON.stringify({reports,video_keys:Object.keys(rail.gameVideo??{}),report_keys:Object.keys(rail.gameReports??{})}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});

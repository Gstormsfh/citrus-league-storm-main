'use strict';
const element=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
const video=element('video'),svg=element('rink');
let data,index=59,selected='1',offset=0,ready=false;
let bodyData=null;
function drawBodies(time){
 const layer=element('bodies');layer.replaceChildren();layer.setAttribute('viewBox','0 0 640 360');
 if(!bodyData)return;
 const nearest=bodyData.frames.reduce((best,f)=>!best||Math.abs(f.video_pts_seconds-time)<Math.abs(best.video_pts_seconds-time)?f:best,null);
 if(!nearest||Math.abs(nearest.video_pts_seconds-time)>.034){element('bodyStatus').textContent='No sampled image detection at this timestamp; possession from video: unknown.';return;}
 for(const b of nearest.bodies){const rect=document.createElementNS(NS,'rect');for(const[k,v]of Object.entries({x:b.x*640,y:b.y*360,width:b.width*640,height:b.height*360,class:'body-box'}))rect.setAttribute(k,v);layer.appendChild(rect);}
 element('bodyStatus').textContent=`${nearest.bodies.length} image-based human boxes · sampled PTS ${nearest.video_pts_seconds.toFixed(3)} s · video possession unknown`;
}
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const valid=a=>a&&finite(a.x)&&finite(a.y);
function node(type,attributes,text){const n=document.createElementNS(NS,type);for(const[k,v]of Object.entries(attributes))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;svg.appendChild(n);return n;}
function pause(){video.pause();element('play').textContent='Play sequence';}
function seek(){pause();const t=index*.1+offset;video.currentTime=Math.max(0,t);draw();if(t<0)element('phase').textContent='This tracking frame precedes the saved video; video is held at its start.';}
function draw(){
 if(!data)return;
 const f=data.frames[index],actors=Object.values(f.onIce),w=svg.clientWidth,h=svg.clientHeight,pad=28;
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();
 const bounds=data.bounds,s=Math.min((w-2*pad)/(bounds.maxX-bounds.minX),(h-2*pad)/(bounds.maxY-bounds.minY));
 const left=(w-(bounds.maxX-bounds.minX)*s)/2,top=(h-(bounds.maxY-bounds.minY)*s)/2;
 const x=v=>left+(v-bounds.minX)*s,y=v=>top+(v-bounds.minY)*s;
 node('rect',{x:left,y:top,width:(bounds.maxX-bounds.minX)*s,height:(bounds.maxY-bounds.minY)*s,fill:'none',stroke:'var(--line)'});
 const color=a=>a.teamId===12?'var(--a)':a.teamId===54?'var(--b)':'var(--fg)';
 for(const a of actors.filter(valid)){
  let points=[];for(let i=Math.max(0,index-12);i<=index;i++){const p=data.frames[i].onIce[String(a.id)];if(!valid(p)){if(points.length>1)node('polyline',{points:points.join(' '),fill:'none',stroke:color(a),'stroke-width':String(a.id)===selected?2:1,opacity:.45});points=[];}else points.push(`${x(p.x)},${y(p.y)}`);}
  if(points.length>1)node('polyline',{points:points.join(' '),fill:'none',stroke:color(a),'stroke-width':String(a.id)===selected?2:1,opacity:.45});
 }
 for(const a of actors.filter(valid)){
  const px=x(a.x),py=y(a.y),isPuck=a.id===1,isSelected=String(a.id)===selected;
  if(isPuck){node('circle',{cx:px,cy:py,r:isSelected?8:6,fill:'var(--panel)',stroke:'var(--fg)','stroke-width':2});node('path',{d:`M${px-10},${py}h20 M${px},${py-10}v20`,stroke:'var(--fg)',fill:'none'});}
  else{node('rect',{x:px-7,y:py-7,width:14,height:14,fill:'var(--panel)',stroke:color(a),'stroke-width':isSelected?3:1.5});if(w>460||isSelected)node('text',{x:Math.max(10,Math.min(w-20,px+10)),y:Math.max(14,Math.min(h-5,py-8)),fill:'var(--fg)','font-size':12},a.sweaterNumber);}
  const hit=node('circle',{cx:px,cy:py,r:15,fill:'transparent',cursor:'pointer'});hit.addEventListener('click',()=>{selected=String(a.id);element('player').value=selected;draw();});
 }
 element('frame').value=index;element('frameLabel').textContent=`${index} / ${data.frames.length-1}`;
 element('offsetLabel').textContent=offset.toFixed(3);element('videoTime').textContent=`${video.currentTime.toFixed(2)} s`;
 const phase=data.anchors.filter(a=>index>=a.replay_ticks[0]&&index<=a.replay_ticks[1]).map(a=>a.name.replaceAll('_',' '));
 element('phase').textContent=index*.1+offset<0?'This tracking frame precedes the saved video; video is held at its start.':phase.length?`Review interval: ${phase.join(', ')}`:'Between reviewed landmark intervals';
 const hypothesis=data.possession?.[index];
 const run=data.controlRuns.find(r=>index>=r.start&&index<=r.end);
 element('control').textContent=hypothesis?(hypothesis.player_id?`${data.names[String(hypothesis.player_id)]||hypothesis.player_id} · control candidate`:`${hypothesis.status}: ${hypothesis.reason.replaceAll('_',' ')}`):run?`${data.names[String(run.player_id)]||run.player_id} · candidate`:'Unknown / no stable control';
 const a=f.onIce[selected];element('selection').textContent=a&&valid(a)?`${a.id===1?'Puck':data.names[String(a.playerId)]||a.playerId} — x ${a.x.toFixed(1)}, y ${a.y.toFixed(1)} native units`:'Actor absent or invalid in this frame';
 const bad=actors.filter(a=>!valid(a)).length;
 element('availability').textContent=`${actors.length-bad} valid markers${bad?`; ${bad} invalid`:''}${!valid(f.onIce['1'])?'; PUCK MISSING':''}`;
}
element('frame').addEventListener('input',()=>{index=Number(element('frame').value);seek();});
element('offset').addEventListener('input',()=>{offset=Number(element('offset').value);seek();});
element('player').addEventListener('change',()=>{selected=element('player').value;draw();});
element('back').addEventListener('click',()=>{index=Math.max(0,index-1);seek();});
element('next').addEventListener('click',()=>{index=Math.min(data.frames.length-1,index+1);seek();});
element('play').addEventListener('click',async()=>{if(!video.paused){pause();return;}if(index>=data.frames.length-1){index=0;seek();}try{await video.play();element('play').textContent='Pause';}catch(e){element('error').textContent='Video playback failed: '+e.message;}});
function syncPlayback(time){if(!ready||video.paused)return;const position=(time-offset)/.1;const before=index;if(position>=data.frames.length-1){index=data.frames.length-1;pause();}else index=Math.max(0,Math.round(position));if(index!==before)draw();element('videoTime').textContent=`${time.toFixed(2)} s`;}
if('requestVideoFrameCallback' in video){const advance=(now,metadata)=>{syncPlayback(metadata.mediaTime);drawBodies(metadata.mediaTime);video.requestVideoFrameCallback(advance);};video.requestVideoFrameCallback(advance);}else video.addEventListener('timeupdate',()=>{syncPlayback(video.currentTime);drawBodies(video.currentTime);});
video.addEventListener('seeked',()=>{if(ready){draw();drawBodies(video.currentTime);}});
video.addEventListener('error',()=>{element('error').textContent='Local video could not be decoded. Tracking remains available.';});
element('export').addEventListener('click',()=>{syncPlayback(video.currentTime);pause();const record={schema_version:1,game_id:data.game,event_id:data.event,source_sha256:data.source_sha256,video_sha256:data.video_sha256,replay_frame:index,video_seconds:video.currentTime,view_offset_seconds:offset,selected_actor:selected,review_status:'unreviewed_view_position',production_eligible:false};const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`citrus-review-${data.game}-${index}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
new ResizeObserver(draw).observe(svg);
fetch('data.json').then(r=>{if(!r.ok)throw Error('Missing review data');return r.json();}).then(async d=>{
 data=d;const bounds=d.offset_interval;offset=(bounds[0]+bounds[1])/2;
 fetch('body-detections.json').then(r=>{if(!r.ok)throw Error('No saved detections');return r.json();}).then(b=>{if(b.video_sha256!==d.video_sha256)throw Error('Detection/video hash mismatch');bodyData=b;drawBodies(video.currentTime);}).catch(e=>{element('bodyStatus').textContent=e.message;});
 const slider=element('offset');slider.min=bounds[0];slider.max=bounds[1];slider.value=offset;offset=Number(slider.value);
 element('frame').max=d.frames.length-1;
 const actors=new Map(d.frames.flatMap(f=>Object.values(f.onIce)).map(a=>[a.id,a]));
 for(const a of actors.values()){if(a.id===1)continue;const option=document.createElement('option');option.value=a.id;option.textContent=`${a.teamAbbrev} #${a.sweaterNumber} · ${d.names[String(a.playerId)]||a.playerId}`;element('player').appendChild(option);}
 element('sources').textContent=`Replay SHA-256: ${d.source_sha256}\nVideo SHA-256: ${d.video_sha256}`;
 draw();
 // Load the local clip completely so precise seeking does not depend on a
 // development server implementing HTTP Range. No external media is fetched.
 const media=await fetch('highlight.mp4');if(!media.ok)throw Error('Missing local video');
 const mediaUrl=URL.createObjectURL(await media.blob());
 video.addEventListener('loadedmetadata',()=>{ready=true;for(const id of ['back','play','next','export','frame','offset','player'])element(id).disabled=false;seek();},{once:true});
 video.src=mediaUrl;
 window.addEventListener('pagehide',()=>URL.revokeObjectURL(mediaUrl),{once:true});
}).catch(e=>{element('error').textContent='Review view unavailable: '+e.message;});

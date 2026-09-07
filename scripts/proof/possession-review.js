'use strict';
// Human review must remain independent of the model's suggested owner.
const reviewPanel=document.createElement('section');
reviewPanel.className='panel';
reviewPanel.innerHTML=`<h2>Possession annotation</h2><p class="small">Review the video before revealing the suggestion. Export records a single-reviewer claim, not approved training truth. Uncertain contact or identity should stay uncertain.</p>
<label>Reviewer <input id="reviewerName" autocomplete="off"></label>
<label>Observed state <select id="reviewState"><option value="">Choose explicitly</option><option value="controlled">Selected player controls puck</option><option value="no_control">Puck is not controlled by any player</option><option value="uncertain">Uncertain / occluded / identity unclear</option></select></label>
<label>Visual evidence / uncertainty <input id="reviewNote" autocomplete="off"></label>
<div class="controls"><button id="saveLabel">Export frame annotation</button><button id="revealEvidence">Reveal model evidence</button></div><p id="reviewFeedback" role="status"></p><pre id="evidenceDetails" class="small" style="white-space:pre-wrap"></pre>`;
document.querySelector('main').appendChild(reviewPanel);
element('control').hidden=true;
let evidenceRevealed=false;
element('revealEvidence').addEventListener('click',()=>{
 pause();evidenceRevealed=true;element('control').hidden=false;
 const e=data.controlEvidence?.[index];
 element('evidenceDetails').textContent=e?`Frame ${index} · uncalibrated evidence, NOT a probability\n`+e.actors.slice(0,3).map(a=>`${data.names[String(a.player_id)]||a.player_id} [${a.actor_role||'unknown role'}]: score ${a.evidence_score===null?'not assessed':a.evidence_score.toFixed(3)}, distance ${a.distance_renderer_units.toFixed(1)}, relative motion ${a.relative_step_renderer_units?.toFixed(1)??'unknown'}, competitor margin ${a.nearest_competitor_margin?.toFixed(1)??'unknown'}`).join('\n'):'Evidence unavailable';
});
element('saveLabel').addEventListener('click',()=>{
 syncPlayback(video.currentTime);pause();
 const reviewer=element('reviewerName').value.trim(),state=element('reviewState').value,note=element('reviewNote').value.trim();
 const actor=data?.frames[index].onIce[selected];
 if(!ready||!reviewer||!state||!note||(state==='controlled'&&!actor?.playerId)){
  element('reviewFeedback').textContent='Enter reviewer, state and visual evidence; select a player for controlled labels.';return;
 }
 const mapped=index*.1+offset;
 if(mapped<0||mapped>video.duration||Math.abs(video.currentTime-mapped)>.05){element('reviewFeedback').textContent='Wait for frame alignment and use a frame covered by the saved video.';return;}
 const label={schema_version:1,game_id:data.game,event_id:data.event,replay_frame:index,
  video_seconds:video.currentTime,source_sha256:data.source_sha256,video_sha256:data.video_sha256,
  reviewer,state,player_id:state==='controlled'?actor.playerId:null,evidence_note:note,
  video_minus_replay_offset:offset,offset_interval:data.offset_interval,
  alignment_status:'provisional',model_suggestion_seen:evidenceRevealed,
  review_status:'single_reviewer_unadjudicated',training_eligible:false,production_eligible:false};
 const url=URL.createObjectURL(new Blob([JSON.stringify(label,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=`possession-label-${data.game}-${index}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 element('reviewFeedback').textContent='Exported unadjudicated annotation. No production or training data changed.';
});

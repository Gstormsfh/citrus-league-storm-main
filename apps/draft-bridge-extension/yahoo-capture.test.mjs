import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {captureYahooDraft} from './yahoo-capture.mjs';
const source='https://hockey.fantasysports.yahoo.com/draftclient/hockey/2294514/1';
function fixture(n=3,finished=false){
 let rows='';for(let round=2;round>=1;round--){rows+=`<tr><th>Round ${round}</th></tr>`;for(let pick=Math.min(n,round*2);pick>(round-1)*2;pick--)rows+=`<tr><td>${pick}</td><td><div class="ys-player" data-id="${100+pick}"><img title="Player ${pick}"></div></td><td>${pick%2?'Your Team':'Team 2'}</td></tr>`;}
 return new JSDOM(`<div id="main-0-DraftClientBootstrap-Proxy"><span>Yahoo Fantasy Hockey Draft</span><span>${finished?'Draft Complete':`Team 2's Pick • Round ${Math.ceil((n+1)/2)}, Pick ${n+1}`}</span><span>YOUR TEAM (1/2)</span><table><thead><tr><th>Pick</th><th>Player</th><th>Team</th></tr></thead><tbody>${rows}</tbody></table></div>`).window.document;
}
const read=(doc=fixture(),previous=null,href=source)=>captureYahooDraft(previous,doc,href);
test('Yahoo full ledger uses provider data-id and confirmed overall pick, not names',()=>{const r=read();assert.equal(r.ok,true);assert.equal(r.picks.length,3);assert.equal(r.picks[0].externalPlayerId,'101');assert.equal(r.picks[0].externalTeamId,'1');assert.equal(r.picks[1].externalTeamId,null);assert.equal(r.picks[1].ownerLabel,'Team 2');});
test('draft-room ID is never fabricated into league key or season',()=>{const r=read();assert.equal(r.roomId,'2294514');assert.equal(r.leagueId,null);assert.equal(r.season,null);assert.equal(r.contextVerified,false);});
test('complete draft requires full rounds and contiguous picks',()=>{const d=fixture(4,true);assert.equal(read(d).status,'finished');d.querySelector('tbody tr:has(td)').remove();assert.equal(read(d).code,'incomplete');});
test('first-round partial capture does not invent seat count',()=>{const r=read(fixture(1));assert.equal(r.ok,true);assert.equal(r.teamCount,null);});
test('missing results view pauses without clearing previous picks',()=>{const old=read(),d=fixture();d.querySelector('table').remove();assert.equal(read(d,old).code,'need_results');assert.equal(old.picks.length,3);});
for(const [name,change,code] of [
 ['missing player ID',d=>d.querySelector('.ys-player').removeAttribute('data-id'),'pick_identity'],
 ['duplicate player ID',d=>d.querySelectorAll('.ys-player')[1].setAttribute('data-id',d.querySelector('.ys-player').getAttribute('data-id')),'incomplete'],
 ['counter ahead of rows',d=>d.querySelectorAll('span')[1].textContent="Team 2's Pick • Round 2, Pick 5",'incomplete'],
 ['missing counter',d=>d.querySelectorAll('span')[1].textContent='Disconnected','clock'],
 ['missing owner label',d=>d.querySelector('tbody tr:has(td) td:last-child').textContent='','pick_identity'],
 ['duplicate first-round owner',d=>{for(const row of d.querySelectorAll('tbody tr:has(td)'))row.querySelector('td:last-child').textContent='Your Team';},'teams'],
 ])test(`rejects ${name}`,()=>{const d=fixture();change(d);assert.equal(read(d).code,code);});
test('rejects different room, viewer, host, sport and waiting-room URL',()=>{const old=read();for(const href of [source.replace('2294514','2294515'),source.replace('/1','/2')])assert.equal(read(fixture(),old,href).code,'changed_room');for(const href of ['invalid',source.replace('hockey.fantasysports.yahoo.com','evil.example'),source.replace('/draftclient/hockey/','/draftclient/football/'),'https://hockey.fantasysports.yahoo.com/hockey/4651/mock_waiting'])assert.equal(read(fixture(),null,href).code,'wrong_page');});
function settings(d,value='0'){d.body.insertAdjacentHTML('beforeend',`<dialog open><h1>League Settings</h1><div><span>Scoring Type</span><span>Head-to-Head</span></div><div><span><span>G</span> - Goals</span><span>${value}</span></div><div><span><span>GAA</span> - Goals Against Average</span><span>0</span></div></dialog>`);}
test('category zeros remain raw source values, never scoring weights',()=>{const d=fixture();settings(d);const r=read(d);assert.equal(r.rules.scoringType,'Head-to-Head');assert.equal(r.rules.scoring[0].sourceValue,0);assert.equal(r.rules.scoring[0].weight,null);});
test('scoring survives reload but a verified change pauses updates',()=>{let d=fixture();settings(d);const previous=read(d);assert.equal(read(fixture(),previous).rules.scoring.length,2);d=fixture();settings(d,'2');assert.equal(read(d,previous).code,'rules_changed');});
test('blank or nonnumeric category values are not silently zeroed',()=>{for(const raw of ['','NaN']){const d=fixture();settings(d,raw);assert.equal(read(d).code,'rules');}});

// Structure observed in Yahoo's visible Picks sidebar while Players remains
// selected: overall-pick span, owner span, and provider-owned player data-id.
function feedFixture(n=3,{teams=2,rounds=3,finished=false}={}){
 const owners=Array.from({length:teams},(_,i)=>i===0?'You':`Manager ${i+1}`);
 let cards='';for(let pick=n;pick>=1;pick--){const round=Math.floor((pick-1)/teams),slot=(pick-1)%teams,owner=owners[round%2?teams-1-slot:slot];
  cards+=`<div data-pick="${pick}"><span>${pick}</span><div><span>${owner}</span><div class="ys-player" data-id="${100+pick}"><img title="Player ${pick}"></div></div></div>`;
 }
 return new JSDOM(`<div id="main-0-DraftClientBootstrap-Proxy"><span>Yahoo Fantasy Hockey Draft</span><span>${finished?'Draft Complete':`Manager 2's Pick • Round ${Math.ceil((n+1)/teams)}, Pick ${n+1}`}</span><span>YOUR TEAM (1/${rounds})</span><button role="tab" aria-selected="true">Players</button><button role="tab" aria-selected="true">Picks</button><div id="feed">${cards}<div>Manager joined the draft.</div></div><table><tbody><tr><td><div class="ys-player" data-id="999"><img title="Not drafted"></div></td></tr></tbody></table><div><div>C</div><div class="ys-player" data-id="101"><img title="Roster duplicate"></div></div></div>`).window.document;
}
test('Picks panel captures confirmed identities without leaving Players',()=>{
 const r=read(feedFixture());assert.equal(r.ok,true);assert.equal(r.readerView,'picks-feed');assert.equal(r.teamCount,2);assert.equal(r.picks.length,3);
 assert.deepEqual(r.picks.map(p=>[p.overallPick,p.round,p.externalTeamId]),[[1,1,'1'],[2,1,null],[3,2,null]]);
});
test('Picks feed supports empty, partial first round and exact round boundary',()=>{
 for(const n of [0,1,7,8,9,16,17]){const r=read(feedFixture(n,{teams:8,rounds:16}));assert.equal(r.ok,true,`pick ${n}: ${r.code}`);assert.equal(r.teamCount,n<8?null:8);assert.equal(r.picks.length,n);}
});
test('Picks feed full completion and reload recover without previous state',()=>{
 const r=read(feedFixture(48,{teams:8,rounds:6,finished:true}));assert.equal(r.ok,true);assert.equal(r.status,'finished');assert.equal(r.currentPick,49);assert.equal(r.picks.length,48);
});
test('Picks feed reflects an undo from the new complete ledger',()=>{
 const old=read(feedFixture(4));const next=read(feedFixture(3),old);assert.equal(next.ok,true);assert.equal(next.picks.length,3);assert.equal(old.picks.length,4);
});
test('switching away from Picks pauses instead of clearing history',()=>{
 const old=read(feedFixture());const d=feedFixture();d.querySelectorAll('[role=tab]')[1].textContent='Queue';assert.equal(read(d,old).code,'need_results');assert.equal(old.picks.length,3);
});
test('Picks feed rejects missing history, reused IDs and changed ownership',()=>{
 for(const mutate of [d=>d.querySelector('[data-pick="1"]').remove(),d=>d.querySelector('[data-pick="3"] .ys-player').setAttribute('data-id','101'),d=>d.querySelector('[data-pick="3"] div > span').textContent='Unexpected manager']){
  const d=feedFixture(5);mutate(d);assert.equal(read(d).ok,false);
 }
});
test('Picks feed rejects conflicting containers and bad player identities',()=>{
 let d=feedFixture();const another=d.createElement('div');d.querySelector('#feed').after(another);another.append(d.querySelector('[data-pick="1"]'));assert.equal(read(d).code,'layout');
 d=feedFixture();d.querySelector('[data-pick="1"] .ys-player').removeAttribute('data-id');assert.equal(read(d).ok,false);
});
test('re-entry suffix requires a recovered overlapping ledger before returning to Players',()=>{
 const prior=read(feedFixture(12,{teams:8,rounds:16}));
 const d=feedFixture(14,{teams:8,rounds:16});for(let n=1;n<10;n++)d.querySelector(`[data-pick="${n}"]`).remove();
 assert.equal(read(d).code,'incomplete');
 const recovered=read(d,prior);assert.equal(recovered.ok,true);assert.equal(recovered.picks.length,14);assert.equal(recovered.picks[0].externalPlayerId,'101');
 // Results labels the local owner differently from the feed; both carry the
 // same verified viewer ID, while all other owner labels must match exactly.
 prior.picks.filter(p=>p.externalTeamId==='1').forEach(p=>p.ownerLabel='Your Team');
 assert.equal(read(d,prior).ok,true);
});
test('suffix recovery rejects gaps, replacements, rollback and changed owners',()=>{
 const prior=read(feedFixture(12,{teams:8,rounds:16}));
 for(const change of [d=>d.querySelector('[data-pick="12"]').remove(),d=>d.querySelector('[data-pick="10"] .ys-player').setAttribute('data-id','777'),d=>d.querySelector('[data-pick="10"] div > span').textContent='Someone else']){
  const d=feedFixture(14,{teams:8,rounds:16});for(let n=1;n<10;n++)d.querySelector(`[data-pick="${n}"]`).remove();change(d);assert.equal(read(d,prior).code,'incomplete');
 }
 const undo=feedFixture(10,{teams:8,rounds:16});for(let n=1;n<10;n++)undo.querySelector(`[data-pick="${n}"]`).remove();assert.equal(read(undo,prior).code,'incomplete');
 const gap=feedFixture(14,{teams:8,rounds:16});for(let n=1;n<14;n++)gap.querySelector(`[data-pick="${n}"]`).remove();assert.equal(read(gap,prior).code,'incomplete');
});

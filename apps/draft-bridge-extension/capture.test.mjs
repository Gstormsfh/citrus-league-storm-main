import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {captureEspnDraft} from './capture.mjs';

const source='https://fantasy.espn.com/hockey/draft?leagueId=123&seasonId=2027&teamId=1';
const table=(caption,rows)=>`<table><caption>${caption}</caption>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
// Minimal DOM contract observed in the real ESPN hockey practice room. No
// framework state, cookies or provider-response fixtures are needed.
function fixture(n=2){
 const picks=Array.from({length:n},(_,i)=>`<li class="pick-message__container"><div class="player-headshot"><img src="https://a.espncdn.com/combiner/i?img=/i/headshots/nhl/players/full/${100+i}.png"><img src="https://a.espncdn.com/combiner/i?img=/games/lm-static/fhl/images/nomug.png"></div><span class="playerinfo__playername">Player ${i+1}</span><div class="pick-info">R${Math.floor(i/2)+1}, P${i%2+1}<span> - Team ${i%2+1}</span></div></li>`).join('');
 return new JSDOM(`<main><h1>ESPN Fantasy Hockey Draft - Practice</h1><select><option value="1">Team 1</option><option value="2">Team 2</option></select><select aria-hidden="true"><option value="1">Team 1</option><option value="2">Team 2</option></select><div class="clock__label">RND 2 of 2</div><div data-testid="current-pick"><div class="on-the-clock">On the Clock: Pick ${n+1}</div></div>${table('Basic Settings',[['Scoring Type','Head to Head Points'],['Teams in League','2']])}${table('Roster',[['Forward (F)','1'],['Goalie (G)','1']])}${table('Scoring - Skater',[['Goals (G)','2']])}${table('Scoring - Goaltender',[['Goals Against (GA)','-2'],['Overtime Losses (OTL)','1']])}<ul>${picks}</ul></main>`).window.document;
}
const read=(doc=fixture(),previous=null,href=source)=>captureEspnDraft(previous,doc,href);
function addHistory(d){const entries=[...d.querySelectorAll('.pick-message__container')];d.querySelector('main').insertAdjacentHTML('beforeend',`<div class="pick-history-table"><div role="grid"><div role="row"><div role="columnheader">Pick</div><div role="columnheader">Player</div><div role="columnheader">Team</div></div>${entries.map((e,i)=>`<div role="row"><div role="gridcell">${i+1}</div><div role="gridcell">${e.querySelector('.player-headshot').outerHTML}${e.querySelector('.playerinfo__playername').outerHTML}</div><div role="gridcell">Team ${i%2+1}</div></div>`).join('')}</div></div>`);}
test('recovers from actual Pick History when the message feed is empty after reload',()=>{const d=fixture();addHistory(d);d.querySelector('ul').remove();assert.equal(read(d).picks.length,2);});
test('merges matching visible history and message cards without double counting',()=>{const d=fixture();addHistory(d);assert.equal(read(d).picks.length,2);});
test('does not trust conflicting history or a filtered incomplete ledger',()=>{const d=fixture();addHistory(d);d.querySelector('.pick-history-table img').src='https://a.espncdn.com/combiner/i?img=/i/headshots/nhl/players/full/999.png';assert.equal(read(d).code,'conflicting_history');d.querySelector('ul').remove();d.querySelector('.pick-history-table [role="row"]:last-child').remove();assert.equal(read(d).code,'incomplete');});
test('reads complete confirmed picks, stable provider IDs and every visible scoring field',()=>{
 const r=read();assert.equal(r.ok,true);assert.equal(r.season,2026);assert.equal(r.picks.length,2);
 assert.deepEqual(r.picks[1],{externalPlayerId:'101',externalTeamId:'2',overallPick:2,name:'Player 2'});
 assert.deepEqual(r.rules.scoring.at(-1),{group:'goalie',label:'Overtime Losses (OTL)',weight:1});
});
test('retains rules when user returns to Players',()=>{const first=read(),d=fixture();d.querySelectorAll('table').forEach(t=>t.remove());assert.equal(read(d,first).ok,true);assert.equal(read(d).code,'need_rules');});
test('serialized object key order does not change scoring identity',()=>{const first=read();first.rules={roster:first.rules.roster,scoring:first.rules.scoring,scoringType:first.rules.scoringType};assert.equal(read(fixture(),first).ok,true);});
test('accepts a confirmed undo while paused',()=>{const old=read(),d=fixture(1);d.querySelector('main').insertAdjacentHTML('beforeend','<h3>The draft has been paused by the League Manager.</h3>');const r=read(d,old);assert.equal(r.ok,true);assert.equal(r.status,'paused');assert.equal(r.picks.length,1);});
test('real ESPN undo keeps an explicitly rolled-back history card',()=>{const old=read(),d=fixture(2);d.querySelector('.on-the-clock').textContent='On the Clock: Pick 2';const last=d.querySelectorAll('.pick-message__container')[1];last.classList.add('is-rolled-back');last.append(' Rolled back');assert.equal(read(d,old).picks.length,1);last.classList.remove('is-rolled-back');assert.equal(read(d,old).code,'incomplete');});
test('a replacement pick can coexist with its rolled-back predecessor',()=>{const old=read(),d=fixture(2);const removed=d.querySelectorAll('.pick-message__container')[1].cloneNode(true);removed.classList.add('is-rolled-back');removed.append(' Rolled back');d.querySelector('ul').append(removed);assert.equal(read(d,old).picks.length,2);});
test('accepts completion only with all rounds present',()=>{const old=read(),d=fixture(4);d.querySelector('main').insertAdjacentHTML('beforeend','<h3>Your draft is complete!</h3>');d.querySelector('[data-testid="current-pick"]').remove();const r=read(d,old);assert.equal(r.ok,true);assert.equal(r.status,'finished');d.querySelector('.pick-message__container').remove();assert.equal(read(d,old).code,'incomplete');});
for(const [label,change,code] of [
 ['missing history',d=>d.querySelector('.pick-message__container').remove(),'incomplete'],
 ['missing player image',d=>d.querySelector('.player-headshot img').remove(),'pick_identity'],
 ['untrusted image host',d=>d.querySelector('.player-headshot img').src='https://evil.example/i/headshots/nhl/players/full/100.png','pick_identity'],
 ['duplicate player',d=>d.querySelectorAll('.player-headshot img')[2].src=d.querySelector('.player-headshot img').src,'incomplete'],
 ['unmapped team',d=>d.querySelector('.pick-info').textContent='R1, P1 - Unknown','pick_identity'],
 ['bad pick slot',d=>d.querySelector('.pick-info').textContent='R1, P3 - Team 1','pick_slot'],
 ['missing clock',d=>d.querySelector('[data-testid="current-pick"]').remove(),'clock'],
 ['duplicate team name',d=>d.querySelectorAll('select')[0].options[1].textContent='Team 1','teams'],
 ['partial rules',d=>d.querySelector('table').remove(),'rules_partial'],
 ['nonnumeric scoring',d=>d.querySelectorAll('table')[2].querySelectorAll('td')[1].textContent='NaN','rules'],
])test(`rejects ${label} without publishing partial availability`,()=>{const d=fixture();change(d);assert.equal(read(d).code,code);});
test('rejects different league or season after pairing',()=>{const first=read();assert.equal(read(fixture(),first,source.replace('123','456')).code,'changed_room');assert.equal(read(fixture(),first,source.replace('2027','2028')).code,'changed_room');});
test('rejects changed scoring, teams and round count',()=>{const first=read();let d=fixture();d.querySelectorAll('table')[2].querySelectorAll('td')[1].textContent='3';assert.equal(read(d,first).code,'rules_changed');d=fixture();d.querySelector('select').options[0].textContent='Changed';assert.equal(read(d,first).code,'teams_changed');d=fixture();d.querySelector('.clock__label').textContent='RND 2 of 3';assert.equal(read(d,first).code,'rounds_changed');});
test('rejects wrong host, sport, season and invalid URL',()=>{for(const href of ['not a URL',source.replace('fantasy.espn.com','evil.example'),source.replace('/hockey/','/football/'),source.replace('2027','1900')])assert.equal(read(fixture(),null,href).ok,false);});

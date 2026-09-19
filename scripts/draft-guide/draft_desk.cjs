(function () {
  'use strict';
  function validateProgress(value, kit) {
    if (!value || value.version !== 1 || value.fingerprint !== kit.fingerprint || !Array.isArray(value.rows) || value.rows.length > 300)
      throw Error('This progress file belongs to a different league, scoring or edition. Keep it with its original draft desk.');
    const ids = new Set(kit.players.map(p => p.key)), seen = new Set();
    const rows = value.rows.map(r => {
      if (!r || !ids.has(r.key) || seen.has(r.key) || typeof r.drafted !== 'boolean' || typeof r.target !== 'boolean' || typeof r.note !== 'string' || r.note.length > 500)
        throw Error('This progress file contains invalid or duplicate player entries. Your current progress has not changed.');
      seen.add(r.key); return {key:r.key,drafted:r.drafted,target:r.target,note:r.note};
    });
    return {version:1,fingerprint:kit.fingerprint,rows};
  }
  function filterPlayers(players, state, filters) {
    const normalize=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
    const query=normalize(filters.search.trim());
    return players.filter(p => (!filters.position || p.position===filters.position)
      && (!filters.hide || !state.get(p.key)?.drafted) && (!filters.targets || state.get(p.key)?.target)
      && (!query || normalize(p.name+' '+p.team).includes(query)));
  }
  function connectionFile(kit, progress) {
    return {kind:'citrus-connected-desk',version:1,kit,progress:validateProgress(progress,kit)};
  }
  const compareLabels={goals:'Goals',assists:'Assists',shots_on_goal:'Shots',power_play_points:'Power-play points',short_handed_points:'Short-handed points',hits:'Hits',blocks:'Blocks',penalty_minutes:'Penalty minutes',plus_minus:'Plus/minus',wins:'Wins',saves:'Saves',goals_against:'Goals against',shutouts:'Shutouts'};
  function comparisonRows(players,weights,impact) {
    const finite=v=>typeof v==='number'&&Number.isFinite(v);
    return Object.entries(compareLabels).flatMap(([key,label])=>{
      const group=['wins','saves','goals_against','shutouts'].includes(key)?'goalie':'skater';
      if(!players.some(p=>(p.goalie?'goalie':'skater')===group))return [];
      const weight=weights[group]?.[key]??0;
      const values=players.map(p=>(p.goalie?'goalie':'skater')===group&&finite(p.totals[key])?p.totals[key]:null);
      const contributions=values.map(v=>v===null?null:v*weight);
      const comparable=contributions.filter(finite);
      const best=comparable.length>1&&new Set(comparable).size>1?Math.max(...comparable):null;
      return [{key,label,weight,values:impact?contributions:values,edges:contributions.map(v=>best!==null&&v===best)}];
    });
  }
  if (typeof module !== 'undefined') module.exports={validateProgress,filterPlayers,connectionFile,comparisonRows};
  if (typeof document === 'undefined') return;
  const kit=JSON.parse(document.getElementById('kit-data').textContent), $=id=>document.getElementById(id);
  const storeKey='citrus-draft-desk:'+kit.fingerprint;
  let state=new Map(),last=null,selected=null,storageAvailable=true;
  let compareIds=[];
  const labels={goals:'G',assists:'A',shots_on_goal:'SOG',power_play_points:'PPP',short_handed_points:'SHP',hits:'HIT',blocks:'BLK',penalty_minutes:'PIM',plus_minus:'+/-',wins:'W',saves:'SV',goals_against:'GA',shutouts:'SO'};
  const number=n=>n==null?'N/A':Number(n).toLocaleString('en-CA',{maximumFractionDigits:1});
  const empty=key=>({key,drafted:false,target:false,note:''});
  const snapshot=()=>({version:1,fingerprint:kit.fingerprint,rows:[...state.values()]});
  const status=(message,error=false)=>{$('status').textContent=message;$('status').className=error?'error':'';};
  function save() {
    try {localStorage.setItem(storeKey,JSON.stringify(snapshot()));storageAvailable=true;}
    catch {storageAvailable=false;status('Browser storage is unavailable. Use Save progress file before closing.',true);}
  }
  function remember(){last=JSON.stringify(snapshot());$('undo').disabled=false;}
  function change(key,patch){
    const label=document.activeElement?.getAttribute('aria-label');
    remember();state.set(key,{...(state.get(key)||empty(key)),...patch});save();render();
    const control=[...$('rows').querySelectorAll('[aria-label]')].find(n=>n.getAttribute('aria-label')===label);
    (control||$('rows').querySelector('input')||$('search')).focus({preventScroll:true});
  }
  function node(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
  function render() {
    renderComparison();
    const visible=filterPlayers(kit.players,state,{search:$('search').value,position:$('position').value,hide:$('hide').checked,targets:$('targets-only').checked});
    $('rows').replaceChildren();
    for(const p of visible){
      const item=state.get(p.key)||empty(p.key),tr=node('tr');tr.className=[item.drafted?'drafted':'',p.key===selected?'selected':''].join(' ');
      const check=node('input');check.type='checkbox';check.checked=item.drafted;check.setAttribute('aria-label','Drafted: '+p.name);check.onchange=()=>change(p.key,{drafted:check.checked});
      const cell=node('td');cell.append(check);tr.append(cell,node('td',p.rank));
      const name=node('button',p.name,'player');name.onclick=()=>{selected=p.key;render();showDetails(p);};
      name.setAttribute('aria-label','Details: '+p.name);const sub=node('span',p.position,'sub');sub.append(node('span',' / '+p.team,'mobile-team'));name.append(sub);
      const playerCell=node('td');playerCell.append(name);tr.append(playerCell,node('td',p.team,'team'),node('td',number(p.points),'points'));
      const star=node('button',item.target?'★':'☆','target');star.setAttribute('aria-label','Target: '+p.name);star.setAttribute('aria-pressed',String(item.target));star.onclick=()=>change(p.key,{target:!item.target});
      const targetCell=node('td');targetCell.append(star);tr.append(targetCell);$('rows').append(tr);
    }
    if(!visible.length){const tr=node('tr'),td=node('td','No players match. Try clearing your filters.','empty');td.colSpan=6;tr.append(td);$('rows').append(tr);}
    const drafted=[...state.values()].filter(p=>p.drafted).length;
    $('drafted').textContent=drafted;$('remaining').textContent=kit.players.length-drafted;
    $('targets').textContent=[...state.values()].filter(p=>p.target&&!p.drafted).length;
    if(storageAvailable)status(visible.length+' players shown. Original ranks stay fixed as picks are marked.');
  }
  function renderComparison() {
    if(!$('compare'))return;
    const players=compareIds.map(id=>kit.players.find(p=>p.key===id)).filter(Boolean);
    const results=filterPlayers(kit.players,new Map(),{search:$('compare-search').value,hide:false,targets:false}).filter(p=>!compareIds.includes(p.key)).slice(0,8);
    $('compare-results').replaceChildren();$('compare-search').disabled=players.length>=4;
    if(players.length<4)for(const p of results){
      const add=node('button',p.name+' · '+p.team);add.setAttribute('aria-label','Compare '+p.name);
      add.onclick=()=>{if(compareIds.length>=4||compareIds.includes(p.key))return;compareIds.push(p.key);$('compare-search').value='';renderComparison();$('compare-search').focus();};
      $('compare-results').append(add);
    }
    $('compare-status').textContent=players.length>=4?'Four players selected. Remove one to add another.':players.length<2?'Choose at least two players.':players.length+' players selected.';
    const wrap=$('compare-table');wrap.replaceChildren();if(!players.length)return;
    const table=node('table'),head=node('thead'),tr=node('tr');tr.append(node('th','Season projections'));
    for(const p of players){const th=node('th');th.style.minWidth='145px';th.scope='col';
      th.append(node('div',p.name),node('div',p.team+' / '+p.position+' / #'+p.rank),node('div',state.get(p.key)?.drafted?'Drafted':'Available'));
      const remove=node('button','Remove');remove.setAttribute('aria-label','Remove '+p.name+' from comparison');remove.onclick=()=>{compareIds=compareIds.filter(id=>id!==p.key);renderComparison();$('compare-search').focus();};th.append(remove);tr.append(th);}
    head.append(tr);table.append(head);const body=node('tbody');
    const facts=[{label:'Projected FPTS',values:players.map(p=>p.points),orange:true},{label:'Games / goalie starts',values:players.map(p=>p.games)},
      {label:'FPTS / game or start',values:players.map(p=>p.games>0?p.points/p.games:null)},...comparisonRows(players,kit.weights,$('compare-impact').checked)];
    for(const row of facts){const tr=node('tr'),th=node('th',row.label+(row.weight!==undefined?' ('+row.weight+' FPTS each)':''));th.scope='row';th.style.minWidth='140px';tr.append(th);
      row.values.forEach((v,i)=>{const td=node('td',number(v));if(row.orange){td.style.background='#ffead7';td.style.color='#a83c00';td.style.fontSize='23px';td.style.fontWeight='800';}
        if(row.edges?.[i]){td.style.background='#e0e9d8';td.append(node('span','Scoring edge','sub'));}tr.append(td);});body.append(tr);}
    table.append(body);wrap.append(table);
  }
  function showDetails(p) {
    const panel=$('detail');panel.replaceChildren(node('h2',p.name.toUpperCase()),node('p','#'+p.rank+' / '+p.team+' / '+p.position+' / '+number(p.points)+' FPTS'));
    const facts=node('div',null,'facts');
    const keys=p.goalie?['wins','saves','goals_against','shutouts']:['goals','assists','shots_on_goal','power_play_points','hits','blocks','penalty_minutes','short_handed_points'];
    for(const [key,value] of [[p.goalie?'STARTS':'GP',p.games],...keys.map(k=>[labels[k],p.totals[k]])]){
      const cell=node('div');cell.append(node('span',key),node('strong',number(value)));facts.append(cell);
    }
    panel.append(facts,node('p','Projected season totals. Changing scoring does not change these hockey forecasts.'));
    const label=node('label','Your draft note (500 characters maximum)'),note=node('textarea');note.maxLength=500;note.value=state.get(p.key)?.note||'';note.setAttribute('aria-label','Note for '+p.name);
    note.oninput=()=>{remember();state.set(p.key,{...(state.get(p.key)||empty(p.key)),note:note.value});save();};
    label.append(note);panel.append(label);
  }
  function download(name,content){const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  $('league').textContent=kit.league+' / Projections '+kit.projectionDate;
  $('edition').textContent='Projection date: '+kit.projectionDate+'. Revision '+kit.revision.slice(0,12)+'.';
  for(const pos of [...new Set(kit.players.map(p=>p.position))].sort()){$('position').append(new Option(pos,pos));}
  for(const [group,weights] of Object.entries(kit.weights))for(const [key,value] of Object.entries(weights))$('scoring').append(node('div',(group==='goalie'?'Goalies':'Skaters')+' / '+(labels[key]||key)+': '+value));
  try {const saved=localStorage.getItem(storeKey);if(saved)state=new Map(validateProgress(JSON.parse(saved),kit).rows.map(r=>[r.key,r]));}
  catch {storageAvailable=false;status('Saved browser progress could not be loaded. Restore a progress file or start marking picks.',true);}
  for(const id of ['search','position','hide','targets-only'])$(id).addEventListener(id==='search'?'input':'change',render);
  $('clear-filters').onclick=()=>{$('search').value='';$('position').value='';$('targets-only').checked=false;$('hide').checked=true;render();};
  $('backup').onclick=()=>{download('Citrus-Draft-Progress-'+kit.fingerprint.slice(0,8)+'.json',JSON.stringify(snapshot(),null,2));status('Progress file prepared. Keep it with this HTML file.');};
  $('connect-citrus').onclick=()=>{download('Citrus-Connected-Desk.json',JSON.stringify(connectionFile(kit,snapshot())));status('Open your Citrus draft room, choose Draft Desk, and load this JSON. Your notes and targets transfer; confirmed Citrus picks replace manual checkmarks.');};
  $('restore').onclick=()=>$('restore-file').click();
  $('restore-file').onchange=async()=>{
    try {const file=$('restore-file').files[0];if(!file)return;if(file.size>300000)throw Error('Progress file is too large.');
      const restored=validateProgress(JSON.parse(await file.text()),kit);
      if(!window.confirm('Replace the current draft progress with this file? You can undo this change.'))return;
      remember();state=new Map(restored.rows.map(r=>[r.key,r]));save();render();if(selected)showDetails(kit.players.find(p=>p.key===selected));status('Progress restored.');
    }catch(e){status(e.message||'Could not restore progress. Current picks are unchanged.',true);}finally{$('restore-file').value='';}
  };
  $('undo').onclick=()=>{if(!last)return;state=new Map(validateProgress(JSON.parse(last),kit).rows.map(r=>[r.key,r]));last=null;$('undo').disabled=true;save();render();if(selected)showDetails(kit.players.find(p=>p.key===selected));};
  $('print').onclick=()=>window.print();
  if($('compare')){
    $('compare-search').oninput=renderComparison;$('compare-impact').onchange=renderComparison;
    $('compare-clear').onclick=()=>{compareIds=[];renderComparison();};
  }
  render();
})();

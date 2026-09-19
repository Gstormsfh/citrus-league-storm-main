/** Read rendered ESPN hockey draft DOM only. Self-contained for executeScript.
 * Never read cookies, storage, framework state, sockets or provider API payloads.
 * A missing row is an error, not evidence that a player became available.
 */
export function captureEspnDraft(previous = null, doc = document, href = location.href) {
  const fail = (code, message) => ({ ok: false, code, message });
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const positive = value => /^[1-9]\d{0,11}$/.test(String(value));
  let url;
  try { url = new URL(href); } catch { return fail('wrong_page', 'Open an ESPN hockey draft room first.'); }
  if (url.origin !== 'https://fantasy.espn.com' || url.pathname !== '/hockey/draft')
    return fail('wrong_page', 'Open an ESPN hockey draft room first.');
  const leagueId = url.searchParams.get('leagueId'), seasonId = Number(url.searchParams.get('seasonId'));
  if (!positive(leagueId) || !Number.isInteger(seasonId) || seasonId < 2001 || seasonId > 2101)
    return fail('identity', 'The draft room identity could not be verified.');
  const identity = { platform: 'espn', leagueId, season: seasonId - 1 };
  if (previous && (previous.leagueId !== leagueId || previous.season !== identity.season))
    return fail('changed_room', 'The source changed leagues. Connect the new room explicitly.');
  const main = doc.querySelector('main');
  if (!main || !clean(main.querySelector('h1')?.textContent).startsWith('ESPN Fantasy Hockey Draft - '))
    return fail('loading', 'Waiting for the ESPN hockey draft room to render.');
  const title = clean(main.querySelector('h1').textContent).replace('ESPN Fantasy Hockey Draft - ', '').slice(0,128);
  // The roster selector has only positive numeric team IDs. Exclude hidden
  // sizing selects and round/time/filter selectors by their options and labels.
  const teamSelects = [...main.querySelectorAll('select')].filter(el => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const opts = [...el.options];
    return opts.length >= 2 && opts.length <= 32 && opts.every(o => positive(o.value))
      && !opts.some(o => /^(?:Round \d+|\d+ (?:seconds|minutes|hours|minute|hour))$/.test(clean(o.textContent)));
  });
  if (teamSelects.length !== 1) return fail('teams', 'The complete team list is not visible.');
  const teams = [...teamSelects[0].options].map(o => ({ id: o.value, name: clean(o.textContent) }));
  if (new Set(teams.map(t=>t.id)).size !== teams.length || new Set(teams.map(t=>t.name)).size !== teams.length
    || teams.some(t=>!t.name || t.name.length > 128))
    return fail('teams', 'Team names or identities are ambiguous. Availability has not changed.');
  if (previous && JSON.stringify(previous.teams) !== JSON.stringify(teams))
    return fail('teams_changed', 'The source team list changed. Reconnect to verify it.');
  const rulesTables = [...main.querySelectorAll('table')];
  const tableRows = caption => {
    const matches = rulesTables.filter(t => clean(t.querySelector('caption')?.textContent) === caption);
    if (matches.length !== 1) return null;
    return [...matches[0].querySelectorAll('tr')].map(row=>[...row.querySelectorAll('td')].map(c=>clean(c.textContent))).filter(r=>r.length);
  };
  let rules = previous?.rules ?? null;
  const basic = tableRows('Basic Settings'), roster = tableRows('Roster');
  const skaters = tableRows('Scoring - Skater'), goalies = tableRows('Scoring - Goaltender');
  if (basic || roster || skaters || goalies) {
    if (!basic || !roster || !skaters || !goalies) return fail('rules_partial', 'Open Rules so every scoring group can be checked.');
    const scoringType = basic.find(r=>r[0]==='Scoring Type')?.[1];
    const reportedTeams = Number(basic.find(r=>r[0]==='Teams in League')?.[1]);
    if (!scoringType || reportedTeams !== teams.length) return fail('rules', 'The league rules do not match the team list.');
    const scoring = [...skaters.map(r=>['skater', ...r]), ...goalies.map(r=>['goalie', ...r])];
    if (scoring.length > 60 || scoring.some(r=>r.length!==3 || !r[1] || r[1].length>100 || r[2]==='' || !Number.isFinite(Number(r[2])) || Math.abs(Number(r[2]))>10000)
      || roster.some(r=>r.length!==2 || !/^\d+$/.test(r[1]) || Number(r[1])>100))
      return fail('rules', 'Some scoring or roster fields could not be read safely.');
    rules = { scoringType, roster:roster.map(([label,n])=>({label,count:Number(n)})), scoring:scoring.map(([group,label,value])=>({group,label,weight:Number(value)})) };
    if (new Set(rules.scoring.map(s=>s.group+':'+s.label)).size !== rules.scoring.length)
      return fail('rules', 'Duplicate scoring fields were returned.');
    const rulesKey = r => JSON.stringify([r.scoringType,
      r.roster.map(v=>[v.label,v.count]).sort((a,b)=>a[0].localeCompare(b[0])),
      r.scoring.map(v=>[v.group,v.label,v.weight]).sort((a,b)=>(a[0]+a[1]).localeCompare(b[0]+b[1]))]);
    if (previous && rulesKey(previous.rules) !== rulesKey(rules))
      return fail('rules_changed', 'The league rules changed. Reconnect before using these rankings.');
  }
  if (!rules) return fail('need_rules', 'Open the ESPN Rules tab, then connect. Scoring is read once and rechecked whenever Rules is visible.');
  const clockLabel = clean(main.querySelector('.clock__label')?.textContent);
  const roundMatch = /^RND (\d+) of (\d+)$/.exec(clockLabel);
  const totalRounds = roundMatch ? Number(roundMatch[2]) : previous?.totalRounds;
  if (!Number.isInteger(totalRounds) || totalRounds<1 || totalRounds>100)
    return fail('need_started_draft', 'Wait for the draft to start before connecting this preview.');
  if (previous && previous.totalRounds !== totalRounds) return fail('rounds_changed', 'The draft size changed. Reconnect to verify it.');
  const headlines = [...main.querySelectorAll('h1,h2,h3')].map(h=>clean(h.textContent));
  const finished = headlines.some(t=>/^Your draft is complete!?$/i.test(t));
  const paused = headlines.some(t=>t==='The draft has been paused by the League Manager.');
  const clockMatch = /^On the Clock: Pick (\d+)$/.exec(clean(main.querySelector('[data-testid="current-pick"] .on-the-clock')?.textContent));
  const currentPick = finished ? teams.length*totalRounds+1 : clockMatch ? Number(clockMatch[1]) : null;
  if (!currentPick || currentPick > teams.length*totalRounds+1)
    return fail('clock', 'The confirmed pick counter is not available. Previous picks are retained.');
  const nodes = [...main.querySelectorAll('.pick-message__container')].map(el=>({el,history:false}));
  // The Picks feed is empty after a page reload. The actual Pick History UI
  // supplies the recoverable ledger. Do not use League Manager's similar grid.
  for (const grid of main.querySelectorAll('.pick-history-table [role="grid"]')) {
    const headers=[...grid.querySelectorAll('[role="columnheader"]')].map(e=>clean(e.textContent));
    if (headers[0]!=='Pick'||headers[1]!=='Player'||headers[2]!=='Team')
      return fail('history_layout','The pick-history columns changed. Previous picks are retained.');
    for (const el of grid.querySelectorAll('[role="row"]'))
      if(el.querySelector('[role="gridcell"]'))nodes.push({el,history:true});
  }
  const picks = [];
  for (const {el,history} of nodes) {
    // ESPN keeps undone picks in the history, visibly labelled "Rolled back".
    // Require both the observed class and label before excluding that entry.
    if (el.classList.contains('is-rolled-back') && /\bRolled back$/.test(clean(el.textContent))) continue;
    const name = clean(el.querySelector('.playerinfo__playername')?.textContent);
    const cells=history?[...el.querySelectorAll('[role="gridcell"]')]:[];
    const info = el.querySelector('.pick-info');
    const pickInfo = history?null:/^R(\d+), P(\d+) - (.+)$/.exec(clean(info?.textContent));
    const ids = [...el.querySelectorAll('.player-headshot img')].flatMap(img=>{
      try {
        const src=new URL(img.getAttribute('src'),url.origin);
        if (src.origin!=='https://a.espncdn.com' || src.pathname!=='/combiner/i') return [];
        const match=/^\/i\/headshots\/nhl\/players\/full\/([1-9]\d{0,11})\.png$/.exec(src.searchParams.get('img')??'');
        return match ? [match[1]] : [];
      } catch { return []; }
    });
    const team = teams.find(t=>t.name===(history?clean(cells[2]?.textContent):pickInfo?.[3]));
    if (!name || name.length>120 || (!history&&!pickInfo) || !team || ids.length!==1)
      return fail('pick_identity', 'A pick is missing a reliable player or team identity. Previous availability is retained.');
    let overallPick;
    if(history){const raw=clean(cells[0]?.textContent);if(!positive(raw))return fail('pick_slot','A history pick is invalid.');overallPick=Number(raw);}
    else{
      const round=Number(pickInfo[1]),roundPick=Number(pickInfo[2]);
      if(round<1||round>totalRounds||roundPick<1||roundPick>teams.length)return fail('pick_slot','A pick is outside the draft bounds.');
      overallPick=(round-1)*teams.length+roundPick;
    }
    if(overallPick>teams.length*totalRounds)return fail('pick_slot','A pick is outside the draft bounds.');
    const existing=picks.find(p=>p.overallPick===overallPick);
    if(existing){
      if(existing.externalPlayerId!==ids[0]||existing.externalTeamId!==team.id||existing.name!==name)
        return fail('conflicting_history','The displayed pick sources disagree. Previous picks are retained.');
      if(!history)return fail('incomplete','Duplicate pick messages cannot be reconciled safely.');
    }else picks.push({externalPlayerId:ids[0],externalTeamId:team.id,overallPick,name});
  }
  picks.sort((a,b)=>a.overallPick-b.overallPick);
  if (picks.length!==currentPick-1 || picks.some((p,i)=>p.overallPick!==i+1)
    || new Set(picks.map(p=>p.externalPlayerId)).size!==picks.length)
    return fail('incomplete', 'Open ESPN Pick History and select All Rounds to restore the full ledger. Previous availability is retained.');
  return {ok:true,version:1,transport:'rendered-draft-room',...identity,title,
    status:finished?'finished':paused?'paused':'in_progress',currentPick,totalRounds,teams,rules,picks};
}

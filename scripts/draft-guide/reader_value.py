"""Draft-day decision aids derived from the existing Citrus forecasts only."""
from customer_data import raw_totals
import json
from pathlib import Path
from datetime import date

def player_spotlights(players, root=Path(__file__).parent):
    bundle=json.loads((Path(root)/'player-spotlights.json').read_text())
    old={n['playerId']:n for n in watchlist_notes(players,root)['items']}
    by_id={str(p['playerId']):p for p in players}
    seen=set();items=[]
    for item in bundle['items']:
        note={**old.get(item['playerId'],{}),**item}
        pid=note['playerId'];p=by_id.get(pid)
        if pid in seen or not p or p['name']!=note['name']:raise ValueError('Spotlight identity mismatch: '+note['name'])
        seen.add(pid)
        if date.fromisoformat(note['date'])>date.fromisoformat(bundle['asOf']):raise ValueError('Future spotlight reporting')
        if not note['url'].startswith('https://') or not note['source']:raise ValueError('Unsourced spotlight')
        for key in ('fact','read','risk','watch','headline','theme'):
            if not note.get(key) or '\u2014' in note[key]:raise ValueError('Invalid spotlight copy: '+key)
        items.append(note)
    return dict(asOf=bundle['asOf'],items=items)

def watchlist_notes(players, root=Path(__file__).parent):
    bundle=json.loads((Path(root)/'draft-watchlist.json').read_text())
    by_id={str(p['playerId']):p for p in players}
    for note in bundle['items']:
        p=by_id.get(note['playerId'])
        if not p or p['name']!=note['name']:raise ValueError('Watchlist identity mismatch: '+note['name'])
        if date.fromisoformat(note['date'])>date.fromisoformat(bundle['asOf']):raise ValueError('Future watchlist report')
        if not note['url'].startswith('https://') or not note['source']:raise ValueError('Unsourced watchlist report')
    return bundle

def category_shortlists(players,weights):
    cards=[]
    for group,goalie,limit in [('skater',False,4),('goalie',True,2)]:
        cohort=[p for p in players if p['isGoalie']==goalie]
        pool=[p for p in cohort if p['overallRank']>50]
        beyond=bool(pool);pool=pool or cohort
        candidates=[]
        for key,weight in weights[group].items():
            if weight<=0:continue
            rows=[dict(player=p,raw=raw_totals(p)[key],contribution=raw_totals(p)[key]*weight)
                  for p in pool if raw_totals(p).get(key,0)>0]
            rows.sort(key=lambda r:(-r['contribution'],r['player']['overallRank']))
            if rows:candidates.append(dict(category=key,weight=weight,group=group,beyond50=beyond,
                                           rows=rows[:3],total=sum(r['contribution'] for r in rows)))
        candidates.sort(key=lambda c:(-c['total'],c['category']))
        cards.extend(candidates[:limit])
    return cards

def projection_drivers(player,weights):
    """Explain the existing forecast using the configured signed contributions."""
    raw=raw_totals(player);group='goalie' if player['isGoalie'] else 'skater'
    rows=[dict(category=k,raw=raw[k],weight=w,points=raw[k]*w)
          for k,w in weights[group].items() if k in raw and w!=0 and raw[k]*w!=0]
    credits=sorted([r for r in rows if r['points']>0],key=lambda r:(-r['points'],r['category']))
    costs=sorted([r for r in rows if r['points']<0],key=lambda r:(r['points'],r['category']))
    return credits[:2]+costs[:1]

def goalie_cost_note(weights):
    save=weights['goalie'].get('saves',0);ga=weights['goalie'].get('goals_against',0)
    if save>0 and ga<0:
        return f'In your scoring, {-ga/save:g} saves offset the cost of one goal against. Compare workload and goals against together before chasing save volume.'
    return 'Use the full fantasy-points total alongside each category. A category leader is not automatically the best overall pick.'

"""Explain rejected candidate handoffs without changing detector acceptance rules."""
import json,math
from pathlib import Path

DIR=Path(__file__).resolve().parents[2]/'scripts/proof/results/linked-replay-pilot-20260907'


def run():
    analysis=json.loads((DIR/'transfer-analysis.json').read_bytes());out=[]
    for r in analysis['results']:
        frames=json.loads((DIR/f"{r['game']}-{r['event']}.json").read_bytes())
        possible=[]
        for radius in (36,60,84):
            runs=r['outputs'][str(radius)]['stable_contacts']
            for a,b in zip(runs,runs[1:]):
                if a['team_id']!=b['team_id'] or a['player_id']==b['player_id'] or b['start']-a['end']>20:continue
                first,last=frames[a['end']]['onIce']['1'],frames[b['start']]['onIce']['1']
                competing=[]
                for i in range(a['end']+1,b['start']):
                    puck=frames[i]['onIce'].get('1')
                    if not puck:continue
                    nearest=sorted((math.hypot(v['x']-puck['x'],v['y']-puck['y']),v['playerId'],v['teamId']) for v in frames[i]['onIce'].values() if v.get('playerId'))
                    if nearest and nearest[0][0]<=radius and (len(nearest)==1 or nearest[1][0]-nearest[0][0]>=12) and nearest[0][1] not in (a['player_id'],b['player_id']):
                        competing.append({'frame':i,'player_id':nearest[0][1],'team_id':nearest[0][2],'distance_renderer_units':nearest[0][0]})
                possible.append({'radius':radius,'from_player_id':a['player_id'],'to_player_id':b['player_id'],
                    'start_frame':a['end'],'end_frame':b['start'],'elapsed_playback_seconds':(b['start']-a['end'])*.1,
                    'lateral_renderer_units':abs(last['y']-first['y']),'longitudinal_renderer_units':abs(last['x']-first['x']),
                    'competing_contacts':competing,'accepted_as_pass':False,
                    'matches_credited_primary_assist_pair_retrospectively':a['player_id']==r['goal_metadata_for_retrospective_comparison_only']['assist1PlayerId'] and b['player_id']==r['goal_metadata_for_retrospective_comparison_only']['scoringPlayerId']})
        out.append({'game':r['game'],'event':r['event'],'rejected_same_team_handoffs':possible})
    with (DIR/'rejected-handoff-review.json').open('x') as f:json.dump({'results':out,'purpose':'Retrospective ambiguity diagnosis, not threshold fitting or pass confirmation'},f,allow_nan=False)
    print(out)


if __name__=='__main__':run()

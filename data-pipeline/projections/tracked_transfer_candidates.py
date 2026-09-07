"""Conservative proximity-transfer candidates, not observed possession/pass labels.

Coordinates stay in NHL renderer units. No outcomes or assists used in detection.
"""
import math


def extract(frames,*,goalie_ids=(),radius=60.,separation_margin=12.,minimum_hold=2,max_gap_frames=20):
    if not frames or not 0<radius<200 or separation_margin<0 or minimum_hold<2 or max_gap_frames<1:
        raise ValueError('Bounded candidate parameters required')
    owners=[];last=None
    for frame in frames:
        stamp=frame.get('timeStamp')
        if not isinstance(stamp,(int,float)) or not math.isfinite(stamp) or (last is not None and stamp!=last+1):
            raise ValueError('Contiguous ordered replay timestamps required; do not bridge gaps')
        last=stamp;actors=frame.get('onIce',{});puck=actors.get('1');near=[]
        if puck:
            for p in actors.values():
                if p.get('playerId') in goalie_ids or not p.get('playerId') or not p.get('teamId'):continue
                values=[p.get('x'),p.get('y'),puck.get('x'),puck.get('y')]
                if not all(type(v) in (int,float) and math.isfinite(v) for v in values):continue
                d=math.hypot(p['x']-puck['x'],p['y']-puck['y']);near.append((d,p['playerId'],p['teamId']))
        near.sort()
        owners.append((near[0][1],near[0][2]) if near and near[0][0]<=radius and (len(near)==1 or near[1][0]-near[0][0]>=separation_margin) else None)
    runs=[];start=0
    while start<len(owners):
        end=start+1
        while end<len(owners) and owners[end]==owners[start]:end+=1
        if owners[start] is not None and end-start>=minimum_hold:runs.append({'start':start,'end':end-1,'player_id':owners[start][0],'team_id':owners[start][1]})
        start=end
    candidates=[]
    for a,b in zip(runs,runs[1:]):
        if a['player_id']==b['player_id'] or a['team_id']!=b['team_id'] or b['start']-a['end']>max_gap_frames:continue
        # Reject any observed intervening competing owner, even a single-frame touch.
        between=owners[a['end']+1:b['start']]
        if any(v is not None and v[0] not in (a['player_id'],b['player_id']) for v in between):continue
        segment=frames[a['end']:b['start']+1]
        if any(not f.get('onIce',{}).get('1') for f in segment):continue
        points=[f['onIce']['1'] for f in segment]
        if any(not all(type(p.get(k)) in (int,float) and math.isfinite(p[k]) for k in ('x','y')) for p in points):continue
        first,final=points[0],points[-1];ticks=b['start']-a['end']
        candidates.append({'from_player_id':a['player_id'],'to_player_id':b['player_id'],'team_id':a['team_id'],
            'start_frame':a['end'],'end_frame':b['start'],'elapsed_seconds':ticks*.1,
            'lateral_renderer_units':abs(final['y']-first['y']),'longitudinal_renderer_units':abs(final['x']-first['x']),
            'puck_path_renderer_units':sum(math.hypot(q['x']-p['x'],q['y']-p['y']) for p,q in zip(points,points[1:])),
            'classification':'same-team proximity transfer candidate','confirmed_pass':False})
    return {'candidates':candidates,'stable_contacts':runs,'radius_renderer_units':radius,
        'unknown_frames':sum(v is None for v in owners),'frames':len(frames),
        'limitation':'Not a possession classifier; rebounds, deflections and loose-puck recoveries remain possible', 'publishable':False}

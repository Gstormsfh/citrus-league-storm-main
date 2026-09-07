"""Outcome-independent recorded-event sequence maps, not tracked passes/goalies."""
from projections import pre_shot_history as history
from projections.pre_shot_movement import measure
from projections.analytics_publication import fingerprint

VERSION='citrus-recorded-sequence-map-v1'


def project(events,*,home,away,max_prior=4,horizon_seconds=10):
    if type(max_prior) is not int or not 1<=max_prior<=10 or not 0<horizon_seconds<=30:
        raise ValueError('Bounded history required')
    contexts=history.project(events,home=home,away=away)
    index={e['eventId']:e for e in events};result={}
    def clock(e):return int(e['timeInPeriod'][:2])*60+int(e['timeInPeriod'][3:])
    for current in events:
        # Selection only; type/outcome never enters this event's feature payload.
        if current.get('typeCode') not in (505,506,507):continue
        eid=current['eventId'];owner=current.get('details',{}).get('eventOwnerTeamId')
        if owner not in (home,away) or current['periodDescriptor']['periodType']=='SO':continue
        side=current.get('homeTeamDefendingSide')
        orientation=(1 if (owner==home)==(side=='left') else -1) if owner in (home,away) and side in ('left','right') else None
        chain=[];prior_id=contexts[eid]['immediate_recorded_live_event']['prior_event_id']
        while prior_id is not None and len(chain)<max_prior:
            previous=index[prior_id]
            if clock(current)-clock(previous)>horizon_seconds:break
            chain.append(previous)
            prior_id=contexts[prior_id]['immediate_recorded_live_event']['prior_event_id']
        sequence=list(reversed(chain))+[current];nodes=[];edges=[]
        for e in sequence:
            details=e.get('details',{});point=history._point(details)
            xy=[orientation*v for v in point] if point is not None and orientation is not None and e.get('homeTeamDefendingSide')==side else None
            nodes.append({'event_id':e['eventId'],'kind':'shot_attempt' if e is current else e.get('typeDescKey',str(e.get('typeCode'))),
                'team_relation':'same_team' if details.get('eventOwnerTeamId')==owner else 'opponent',
                'seconds_before_shot':clock(current)-clock(e),'xy_attacking_ft':xy})
        for a,b in zip(nodes,nodes[1:]):
            measured=measure(prior_xy=a['xy_attacking_ft'],shot_xy=b['xy_attacking_ft'],
                elapsed_seconds=a['seconds_before_shot']-b['seconds_before_shot'],orientation=1 if orientation else None)
            edges.append({'from_event_id':a['event_id'],'to_event_id':b['event_id'],
                'relation':'same_recorded_team' if a['team_relation']==b['team_relation'] else 'recorded_team_change',
                'values':measured['values'],'geometry_status':measured['geometry_status']})
        anchors=[]
        for a in nodes[:-1]:
            m=measure(prior_xy=a['xy_attacking_ft'],shot_xy=nodes[-1]['xy_attacking_ft'],elapsed_seconds=a['seconds_before_shot'],orientation=1 if orientation else None)
            anchors.append({'prior_event_id':a['event_id'],'values':m['values'],'team_relation':a['team_relation']})
        features={'version':VERSION,'shot_event_id':eid,'nodes':nodes,'edges':edges,'prior_to_shot':anchors,
            'history_limit':max_prior,'horizon_seconds':horizon_seconds,'orientation':orientation,
            'interpretation':'Recorded event locations; connections are not verified passes, possession or goalie movement'}
        complete=bool(edges) and all(n['xy_attacking_ft'] is not None for n in nodes)
        directions=[b['xy_attacking_ft'][1]-a['xy_attacking_ft'][1] for a,b in zip(nodes,nodes[1:])] if complete else []
        nonzero=[v for v in directions if v!=0]
        features['summary']={'recorded_prior_events':len(chain),
            'sequence_elapsed_seconds':nodes[0]['seconds_before_shot'] if chain else None,
            'path_lateral_ft':sum(abs(v) for v in directions) if complete else None,
            'net_lateral_ft':abs(sum(directions)) if complete else None,
            'lateral_direction_reversals':sum(a*b<0 for a,b in zip(nonzero,nonzero[1:])) if complete else None,
            'centerline_crossings':sum(e['values']['event_crossed_centerline'] for e in edges) if complete else None,
            'recorded_team_changes':sum(e['relation']=='recorded_team_change' for e in edges)}
        result[eid]={'features':features,'feature_sha256':fingerprint(features),'publishable':False}
    return result

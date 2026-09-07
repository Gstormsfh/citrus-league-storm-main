"""Exploratory co-motion transfers, never confirmed passes or xG features.

Thresholds use native renderer units per replay tick. No physical-unit claim.
Only trajectories and roster goalie IDs enter extraction; no goal/assist labels.
"""
import math
from projections.tracked_transfer_candidates import extract as validate_frames


def extract(frames, *, goalie_ids=(), radius=84., relative_step_limit=24., minimum_hold=2, max_gap_frames=20):
    validate_frames(frames, goalie_ids=goalie_ids, radius=radius,
                    minimum_hold=minimum_hold, max_gap_frames=max_gap_frames)
    if not math.isfinite(relative_step_limit) or relative_step_limit <= 0:
        raise ValueError('Positive finite relative-motion threshold required')
    owners = [None] * len(frames)
    def valid(p):
        return p and all(type(p.get(k)) in (int, float) and math.isfinite(p[k]) for k in ('x', 'y'))
    for i in range(1, len(frames)):
        now, before = frames[i]['onIce'], frames[i-1]['onIce']
        puck, old_puck = now.get('1'), before.get('1')
        if not valid(puck) or not valid(old_puck):
            continue
        previous = {a.get('playerId'): a for a in before.values() if a.get('playerId')}
        near = []
        for a in now.values():
            pid, team = a.get('playerId'), a.get('teamId')
            if not pid or not team or pid in goalie_ids or not valid(a):
                continue
            distance = math.hypot(a['x']-puck['x'], a['y']-puck['y'])
            near.append((distance, pid, team, a))
        near.sort(key=lambda v: v[:3])
        if not near or near[0][0] > radius or (len(near)>1 and near[1][0]-near[0][0]<12):
            continue
        _, pid, team, a = near[0]
        prev = previous.get(pid)
        if not valid(prev):
            continue
        relative = math.hypot(puck['x']-old_puck['x']-(a['x']-prev['x']),
                              puck['y']-old_puck['y']-(a['y']-prev['y']))
        if relative <= relative_step_limit:
            owners[i] = (pid, team)
    runs=[]
    i=0
    while i<len(owners):
        end=i+1
        while end<len(owners) and owners[end]==owners[i]:
            end+=1
        if owners[i] is not None and end-i>=minimum_hold:
            runs.append(dict(start=i,end=end-1,player_id=owners[i][0],team_id=owners[i][1]))
        i=end
    candidates=[]
    for a,b in zip(runs,runs[1:]):
        if a['player_id']==b['player_id'] or a['team_id']!=b['team_id'] or b['start']-a['end']>max_gap_frames:
            continue
        if any(o is not None and o[0] not in (a['player_id'],b['player_id']) for o in owners[a['end']+1:b['start']]):
            continue
        segment=[f['onIce'].get('1') for f in frames[a['end']:b['start']+1]]
        if not all(valid(p) for p in segment):
            continue
        first,last=segment[0],segment[-1]
        candidates.append(dict(from_player_id=a['player_id'],to_player_id=b['player_id'],
            team_id=a['team_id'],start_frame=a['end'],end_frame=b['start'],
            elapsed_playback_seconds=(b['start']-a['end'])*.1,
            lateral_renderer_units=abs(last['y']-first['y']),
            longitudinal_renderer_units=abs(last['x']-first['x']),
            classification='same-team co-motion transfer candidate',confirmed_pass=False))
    return dict(candidates=candidates,stable_contacts=runs,
                relative_step_limit=relative_step_limit,radius=radius,publishable=False,
                limitation='Unvalidated control proxy; deflections, rebounds and loose-puck recoveries remain possible')


def extract_before_shot(frames, *, shot_frame, **kwargs):
    """Caller must independently establish shot release; never infer it from clip end.

    The shot frame and all subsequent frames are excluded BEFORE contact runs
    are constructed. Reception cannot borrow post-shot evidence to qualify.
    """
    if type(shot_frame) is not int or not 1 <= shot_frame < len(frames):
        raise ValueError('An independently identified in-clip shot frame is required')
    result = extract(frames[:shot_frame], **kwargs)
    result['shot_frame_exclusive'] = shot_frame
    result['shot_alignment_verified_by_extractor'] = False
    return result

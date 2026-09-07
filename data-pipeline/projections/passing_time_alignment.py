"""Interval reconciliation for independently observed video/replay landmarks.

Assumes an uninterrupted, normal-speed video segment. Slow motion and cuts must
be split out; agreement does not independently establish landmark correctness.
"""
import math
from decimal import Decimal


def interval(value):
    if (not isinstance(value,(list,tuple)) or len(value)!=2
            or not all(type(v) in (int,float) and math.isfinite(v) for v in value)
            or value[0]>value[1]):
        raise ValueError('Ordered finite interval required')
    return value


def reconcile(anchors, *, seconds_per_tick):
    if (type(seconds_per_tick) not in (int,float)
            or not math.isfinite(seconds_per_tick) or seconds_per_tick<=0):
        raise ValueError('Positive tick duration required')
    if len(anchors)<3:
        raise ValueError('At least three independently identified landmarks required')
    bounds=[];names=set()
    for anchor in anchors:
        name=anchor.get('name')
        if not isinstance(name,str) or not name.strip() or name in names:
            raise ValueError('Distinct named landmarks required')
        names.add(name)
        if not isinstance(anchor.get('evidence_reference'),str) or not anchor['evidence_reference'].strip():
            raise ValueError('Independent landmark evidence required')
        v=interval(anchor['video_seconds']);r=interval(anchor['replay_ticks'])
        # Decimal arithmetic avoids manufacturing contradictory zero-width
        # intervals from float roundoff, especially with epoch-sized ticks.
        d=lambda x:Decimal(str(x))
        bounds.append([d(v[0])-d(r[1])*d(seconds_per_tick),d(v[1])-d(r[0])*d(seconds_per_tick)])
    low=max(b[0] for b in bounds);high=min(b[1] for b in bounds)
    return {'consistent':low<=high,'video_minus_replay_seconds': [float(low),float(high)] if low<=high else None,
            'landmark_offset_intervals':[[float(x) for x in b] for b in bounds],
            'independently_verified_by_code':False}


def duration_bounds(*, release, reception, shot, seconds_per_tick):
    release,reception,shot=map(interval,(release,reception,shot))
    if not release[1]<reception[0] or not reception[1]<shot[0]:
        raise ValueError('Ambiguous or overlapping endpoint order; do not invent precise timing')
    if type(seconds_per_tick) not in (int,float) or not math.isfinite(seconds_per_tick) or seconds_per_tick<=0:
        raise ValueError('Positive tick duration required')
    def gap(a,b):return [(b[0]-a[1])*seconds_per_tick,(b[1]-a[0])*seconds_per_tick]
    return {'flight_seconds_interval':gap(release,reception),
            'reception_to_shot_seconds_interval':gap(reception,shot),
            'intervals_are_not_statistical_confidence_intervals':True}


def assess_video_coverage(*, replay_ticks, offset_seconds, seconds_per_tick, segments):
    """Require the entire uncertain mapped window inside ONE reviewed segment.

    A camera cut, replay speed change, or missing coverage cannot be bridged.
    Segment review and landmark correctness remain external assertions.
    """
    ticks=interval(replay_ticks);offset=interval(offset_seconds)
    if type(seconds_per_tick) not in (int,float) or not math.isfinite(seconds_per_tick) or seconds_per_tick<=0:
        raise ValueError('Positive tick duration required')
    d=lambda x:Decimal(str(x))
    mapped=[float(d(ticks[0])*d(seconds_per_tick)+d(offset[0])),
            float(d(ticks[1])*d(seconds_per_tick)+d(offset[1]))]
    matched=[]
    for segment in segments:
        start,end=interval(segment['video_seconds'])
        if not segment.get('evidence_reference'):
            raise ValueError('Reviewed segment evidence required')
        if segment.get('normal_speed') is True and start<=mapped[0]<=mapped[1]<=end:
            matched.append(segment['evidence_reference'])
    return dict(mapped_video_seconds=mapped,fully_within_reviewed_segment=bool(matched),
                matching_segment_evidence=matched,independently_verified_by_code=False,
                reason='contained' if matched else 'outside_or_crosses_reviewed_segment')

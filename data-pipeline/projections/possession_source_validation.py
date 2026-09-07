"""Fail closed before interpreting per-tick replay motion."""
import math


def validate(frames):
    previous = None
    for frame in frames:
        stamp = frame.get('timeStamp')
        if type(stamp) not in (int, float) or not math.isfinite(stamp):
            raise ValueError('Finite replay timestamps required')
        if previous is not None and stamp != previous+1:
            raise ValueError('Contiguous ordered replay timestamps required')
        actors = frame.get('onIce')
        if not isinstance(actors, dict) or any(not isinstance(a, dict) for a in actors.values()):
            raise ValueError('Actor mapping required')
        ids = [a['playerId'] for a in actors.values() if a.get('playerId')]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate player identity in one frame')
        previous = stamp

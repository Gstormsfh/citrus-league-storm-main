"""Refuse legacy coordinate-key writes that would duplicate/collapse NHL events.

This is a fail-closed preflight, not an atomic replacement protocol. Concurrent
writers still require the versioned publication path before foundation acceptance.
"""
from collections import defaultdict

KEY = ('game_id', 'player_id', 'shot_x', 'shot_y', 'shot_type_code')
SEMANTICS = ('player_id', 'period', 'is_goal')


def assert_safe_replay(incoming, existing):
    old = defaultdict(list)
    keys = {}
    for row in existing:
        old[(row.get('game_id'), row.get('event_id'))].append(row)
        keys[tuple(row.get(k) for k in KEY)] = row.get('event_id')
    seen = set()
    incoming_keys = set()
    for row in incoming:
        identity = (row.get('game_id'), row.get('event_id'))
        key = tuple(row.get(k) for k in KEY)
        if None in identity or identity in seen:
            raise ValueError(f'Shot replay quarantined: missing/duplicate identity {identity}')
        if key in incoming_keys or (key in keys and keys[key] != identity[1]):
            raise ValueError(f'Shot replay quarantined: coordinate key collapses events {identity}')
        seen.add(identity)
        incoming_keys.add(key)
        matches = old.get(identity, [])
        if len(matches) > 1:
            raise ValueError(f'Shot replay quarantined: ambiguous stored event {identity}')
        if matches and (tuple(matches[0].get(k) for k in KEY) != key or
                        any(matches[0].get(k) != row.get(k) for k in SEMANTICS)):
            raise ValueError(f'Shot replay quarantined: source revision needs versioned repair {identity}')
    if set(old) - seen:
        raise ValueError('Shot replay quarantined: removed events need versioned repair')


def preflight_raw_shot_replay(db, records):
    for game in sorted({r['game_id'] for r in records}):
        existing = db.select('raw_shots', select='id,game_id,event_id,player_id,shot_x,shot_y,shot_type_code,period,is_goal',
                             filters=[('game_id', 'eq', game)], order='id.asc')
        assert_safe_replay([r for r in records if r['game_id'] == game], existing)

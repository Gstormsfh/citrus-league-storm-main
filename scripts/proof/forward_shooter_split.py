"""Deterministic whole-date forward split; no fitting or outcome-based selection."""
from datetime import date
import hashlib
import json


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def partition(records):
    if not isinstance(records, list) or not 2 <= len(records) <= 150000:
        raise ValueError('Bounded calibration records required')
    seen, games = set(), {}
    for r in records:
        gid, eid, day = r['game_id'], r['event_id'], r['game_date']
        if type(gid) is not int or gid <= 0 or type(eid) is not int or eid < 0 or (gid,eid) in seen:
            raise ValueError('Unique strict integer event identity required')
        if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
            raise ValueError('Canonical date required')
        if gid in games and games[gid] != day:
            raise ValueError('One date per game required')
        seen.add((gid,eid)); games[gid] = day
    ordered_games = sorted(games, key=lambda g: (games[g], g))
    if len(ordered_games) < 2:
        raise ValueError('At least two games required')
    cutoff = games[ordered_games[len(ordered_games)//2]]
    ordered = sorted(records, key=lambda r: (r['game_date'],r['game_id'],r['event_id']))
    earlier = [dict(r) for r in ordered if r['game_date'] < cutoff]
    later = [dict(r) for r in ordered if r['game_date'] >= cutoff]
    if not earlier or not later:
        raise ValueError('Split requires two nonempty disjoint date ranges')
    def receipt(rows):
        return {'events': len(rows), 'games': len({r['game_id'] for r in rows}),
                'start': rows[0]['game_date'], 'end': rows[-1]['game_date'],
                'event_keys_sha256': digest([[r['game_id'],r['event_id']] for r in rows]),
                'game_ids': sorted({r['game_id'] for r in rows})}
    return earlier, later, {'rule': 'floor_half_games_cut_moved_to_start_of_selected_date',
                           'cutoff_date': cutoff, 'earlier_map': receipt(earlier),
                           'later_identity': receipt(later), 'publishable': False}

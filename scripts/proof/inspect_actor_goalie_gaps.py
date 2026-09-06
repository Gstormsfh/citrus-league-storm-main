"""Describe special-state goalie gaps without revising source, model or attribution.

Same-clock PS markers are source context, not approval to reinterpret every
special situation code. Missing/different drawn players are distinguished.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
import signal
import sys

from archive_development_checkpoint import REPO, safe, persist
sys.path.insert(0, str(REPO / 'data-pipeline'))
from projections.analytics_publication import fingerprint

RUN = 'scripts/proof/results/official-actor-attribution-20260906'
REVIEW = 'scripts/proof/results/actor-attribution-review-20260906/review.json'
PIN = 'c2a6d3c7310ca5d38a41132df34f868c84b7afdeed92150f9ea82da0e802e8be'
OUTPUT = 'scripts/proof/results/actor-attribution-verification-20260906/goalie-gap-context.json'


def same_clock_context(payload, event_id):
    plays = payload['plays']
    positions = [i for i, p in enumerate(plays) if p['eventId'] == event_id]
    if len(positions) != 1: raise ValueError('Exact source event required')
    index = positions[0]; event = plays[index]; before = []
    def clock(p): return p['periodDescriptor']['number'], p['periodDescriptor']['periodType'], p['timeInPeriod']
    for prior in reversed(plays[:index]):
        if clock(prior) != clock(event): break
        before.insert(0, prior)
    markers = [p for p in before if p['typeCode'] == 509 and p.get('details', {}).get('typeCode') == 'PS']
    shooter = event['details'].get('scoringPlayerId' if event['typeCode'] == 505 else 'shootingPlayerId')
    owner = event['details'].get('eventOwnerTeamId')
    home, away = payload['homeTeam']['id'], payload['awayTeam']['id']
    other = away if owner == home else home if owner == away else None
    marker = markers[0] if len(markers) == 1 else None
    if not markers: category = 'no_same_clock_ps_marker'
    elif len(markers) != 1: category = 'multiple_same_clock_ps_markers'
    elif other is None or marker['details'].get('eventOwnerTeamId') != other: category = 'ps_marker_team_conflict'
    elif marker['details'].get('drawnByPlayerId') is None: category = 'same_clock_ps_missing_drawn_player'
    elif marker['details']['drawnByPlayerId'] != shooter: category = 'same_clock_ps_different_drawn_player'
    else: category = 'same_clock_ps_matching_drawn_player'
    return {'game_id': payload['id'], 'event_id': event_id, 'category': category,
        'situation_code': event.get('situationCode'), 'raw_event': event,
        'same_clock_prior_events': before, 'ps_marker_ids': [p['eventId'] for p in markers],
        'intervening_event_types': [p['typeCode'] for p in before[before.index(marker) + 1:]] if marker else None,
        'event_source_sha256': fingerprint(event), 'context_sha256': fingerprint(before),
        'source_or_model_changed': False, 'attribution_reassigned': False, 'publishable': False}


def main():
    checked = {}
    def read(name, pin=None):
        body = safe(REPO, name).read_bytes(); digest = hashlib.sha256(body).hexdigest()
        if (pin is not None and digest != pin) or (name in checked and checked[name] != digest): raise ValueError('Context evidence drift')
        checked[name] = digest; return json.loads(body)
    review = read(REVIEW, PIN); events = []; counts = Counter(); codes = Counter()
    for fold in ('fold1', 'fold2'):
        aggregate = read(RUN + f'/{fold}/actor-diagnostics.json', review['bound_file_sha256'][RUN + f'/{fold}/actor-diagnostics.json'])
        for gid in aggregate['game_ids']:
            name = RUN + f'/{fold}/games/{gid}.json'
            game = read(name, review['bound_file_sha256'][name])
            gaps = [e for e in game['events'] if e['defending_goalie']['status'] == 'unavailable']
            if not gaps: continue
            name = f'scripts/proof/results/historical-official-freeze-20260906/{gid // 1_000_000}/pbp/{gid}.body.json'
            payload = read(name, review['bound_file_sha256'][name])
            for gap in gaps:
                context = same_clock_context(payload, gap['event_id'])
                events.append({'fold': fold, **context}); counts[context['category']] += 1; codes[context['situation_code']] += 1
    for name, digest in checked.items():
        if hashlib.sha256(safe(REPO, name).read_bytes()).hexdigest() != digest: raise ValueError('End context drift')
    result = {'contract': 'citrus-goalie-gap-context-review-v1', 'status': 'context-inspected-not-reassigned',
        'publishable': False, 'source_model_and_attribution_unchanged': True, 'events': events,
        'counts': dict(sorted(counts.items())), 'codes': dict(sorted(codes.items())), 'bound_file_sha256': checked,
        'code_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'limitations': ['Source-context association, not revised features, accepted penalty-shot classification or repaired attribution.',
            'The three without a same-clock PS marker need independent source adjudication; special code alone is insufficient.']}
    path = REPO / OUTPUT
    if any(p.is_symlink() for p in (path, *path.parents)): raise ValueError('Nonsymlink output required')
    persist(path.parent, path.name, result)
    print(json.dumps({'status': result['status'], 'events': len(events), 'counts': result['counts'], 'codes': result['codes']}))


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Goalie context review interrupted')
    previous = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        main()
    except BaseException as error:
        path = REPO / OUTPUT
        if not path.exists():
            persist(path.parent, 'goalie-gap-context-failure.json', {'status': 'failed-goalie-context-review',
                'error_type': type(error).__name__, 'publishable': False})
        raise
    finally:
        for s, handler in previous.items(): signal.signal(s, handler)

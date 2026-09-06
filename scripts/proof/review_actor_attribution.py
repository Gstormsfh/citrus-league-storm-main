"""Independent ledger review and create-only preservation of actor diagnostics.

Checks every selected raw event and rebuilds actor/stint sums without calling the
attribution implementation. Hash-bound inference receipts are reviewed, not refit.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import signal
import subprocess
import sys
import tarfile

from archive_development_checkpoint import REPO, SOURCE_ROOTS, safe, snapshot, persist, verify_archive
from record_local_model_publication_checkpoint import members
sys.path.insert(0, str(REPO / 'data-pipeline'))
from projections.analytics_publication import fingerprint, timestamp

RUN = 'scripts/proof/results/official-actor-attribution-20260906'
REVIEW = 'scripts/proof/results/actor-attribution-review-20260906'
VERIFY = 'scripts/proof/results/actor-attribution-verification-20260906'
FREEZE = 'scripts/proof/results/historical-official-freeze-20260906'
STATUS = 'complete-source-model-actor-diagnostic-not-accepted'
ROLES = ('shooter', 'defending_goalie')
SOURCES = [*SOURCE_ROOTS, 'data-pipeline/utils', 'data-pipeline/requirements.txt',
           'package.json', 'package-lock.json', 'server/package.json', 'packages/shared/package.json']


def check_actor_totals(games, aggregate):
    """Independent complete roster-member and stint ledger reconstruction."""
    ledger = defaultdict(lambda: {'game_ids': set(), 'incomplete': set(), 'probabilities': [], 'goals': 0})
    partitions = {role: defaultdict(list) for role in ROLES}
    seen = set()
    for game in games:
        gid = game['game_id']
        if gid in seen or game['roster_reason'] is not None:
            raise ValueError('Unique valid captured game roster required for this completed review')
        seen.add(gid)
        for role in ROLES:
            unresolved = {e[role]['team_id'] for e in game['events'] if e[role]['status'] == 'unavailable'}
            by_actor = defaultdict(list)
            for event in game['events']:
                partitions[role][event[role]['status']].append(event)
                if event[role]['status'] == 'attributed': by_actor[event[role]['player_id']].append(event)
            for actor in game['roster']:
                if role == 'defending_goalie' and actor['position'] != 'G': continue
                for team in (None, actor['team_id']):
                    key = game['season'], game['game_type'], role, actor['player_id'], team
                    value = ledger[key]; value['game_ids'].add(gid)
                    if None in unresolved or actor['team_id'] in unresolved: value['incomplete'].add(gid)
                    value['probabilities'].extend(e['probability'] for e in by_actor[actor['player_id']])
                    value['goals'] += sum(e['is_goal'] for e in by_actor[actor['player_id']])
    expected = {k for k in ledger if k[-1] is None}
    keys = [(r['season'], r['game_type'], r['role'], r['player_id'], None) for r in aggregate['rows']]
    if (any(aggregate[k] is not False for k in ('publishable', 'model_accepted', 'foundation_accepted'))
            or set(keys) != expected or len(keys) != len(expected) or aggregate['game_ids'] != sorted(seen)
            or aggregate['unknown_roster_game_ids'] or aggregate['complete_roster_population'] is not True):
        raise ValueError('Exact complete actor population required')
    def check(row, key):
        expected_row = ledger[key]; complete = not expected_row['incomplete']
        p = math.fsum(expected_row['probabilities']); n = len(expected_row['probabilities']); g = expected_row['goals']
        if (row['availability'] != ('available' if complete else 'unavailable')
                or row['eligible_event_count'] != (n if complete else None)
                or row['eligible_event_goals'] != (g if complete else None)
                or row['eligible_event_xg'] != (p if complete else None)
                or row['attributed_xg_subtotal'] != p or row['attributed_event_subtotal'] != n
                or row['attributed_goal_subtotal'] != g
                or row['roster_listed_game_ids'] != sorted(expected_row['game_ids'])
                or row['incomplete_game_ids'] != sorted(expected_row['incomplete'])
                or any(row[k] is not None for k in ('appearance_games', 'toi_seconds', 'xg_per60'))):
            raise ValueError('Actor subtotal/availability/exposure mismatch')
    for row, key in zip(aggregate['rows'], keys):
        check(row, key)
        teams = {k[-1] for k in ledger if k[:-1] == key[:-1] and k[-1] is not None}
        stints = row['team_stints']
        if {s['team_id'] for s in stints} != teams or len(stints) != len(teams):
            raise ValueError('Exact unique team stints required')
        for stint in stints: check(stint, (*key[:-1], stint['team_id']))
    return {role: {status: {'events': len(events), 'xg': math.fsum(e['probability'] for e in events),
                          'goals': sum(e['is_goal'] for e in events)}
                   for status, events in sorted(parts.items())} for role, parts in partitions.items()}


def verify_raw_actors(game, body):
    """Reconcile receipts to actual source actors, teams, goalie state and event bytes."""
    payload = json.loads(body)
    if (any(game[k] is not False for k in ('publishable', 'model_accepted', 'foundation_accepted'))
            or game['source_body_sha256'] != hashlib.sha256(body).hexdigest() or payload['id'] != game['game_id']
            or game['receipt_sha256'] != fingerprint({k: v for k, v in game.items() if k != 'receipt_sha256'})):
        raise ValueError('Detached source/game receipt')
    roster = {r['playerId']: {'player_id': r['playerId'], 'team_id': r['teamId'], 'position': r['positionCode']}
              for r in payload['rosterSpots']}
    if sorted(roster.values(), key=lambda r: r['player_id']) != game['roster']:
        raise ValueError('Detached game roster')
    plays = {e['eventId']: e for e in payload['plays']}
    seen = set()
    for event in game['events']:
        if event['event_id'] in seen: raise ValueError('Duplicate attributed event')
        seen.add(event['event_id']); raw = plays[event['event_id']]; d = raw['details']
        if (fingerprint(raw) != event['source_event_sha256'] or raw['typeCode'] not in (505, 506, 507)
                or raw['periodDescriptor']['periodType'] == 'SO' or event['is_goal'] is not (raw['typeCode'] == 505)):
            raise ValueError('Detached event population or outcome')
        own = d['eventOwnerTeamId']; other = payload['awayTeam']['id'] if own == payload['homeTeam']['id'] else payload['homeTeam']['id']
        sid = d['scoringPlayerId' if raw['typeCode'] == 505 else 'shootingPlayerId']
        shooter = event['shooter']; goalie = event['defending_goalie']
        if (shooter['status'] != 'attributed' or shooter['player_id'] != sid or shooter['source_player_id'] != sid
                or shooter['team_id'] != own or roster[sid]['team_id'] != own):
            raise ValueError('Real shooter attribution differs from raw source')
        if goalie['source_player_id'] != d.get('goalieInNetId') or goalie['team_id'] != other:
            raise ValueError('Detached original defending actor')
        code = raw.get('situationCode')
        valid = (isinstance(code, str) and re.fullmatch('[01][3-6][3-6][01]', code) is not None
                 and int(code[0]) + int(code[1]) <= 6 and int(code[2]) + int(code[3]) <= 6)
        present = (code[0] if own == payload['homeTeam']['id'] else code[3]) == '1' if valid else None
        if present is None:
            if goalie['status'] != 'unavailable' or goalie['reason'] != 'unknown_goalie_presence' or goalie['player_id'] is not None:
                raise ValueError('Unknown goalie state must remain unavailable')
        elif not present:
            if goalie['status'] != 'not_applicable' or goalie['reason'] != 'verified_empty_net' or d.get('goalieInNetId') is not None or goalie['player_id'] is not None:
                raise ValueError('Empty net incorrectly attributed')
        else:
            pid = d['goalieInNetId']
            if goalie['status'] != 'attributed' or goalie['player_id'] != pid or roster[pid]['team_id'] != other or roster[pid]['position'] != 'G':
                raise ValueError('Real goalie attribution differs from raw source')


def review(pin):
    checked = {}
    def read(name, expected=None, parse=True):
        raw = safe(REPO, name).read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if (expected is not None and digest != expected) or (name in checked and checked[name] != digest):
            raise ValueError('Review input drift')
        checked[name] = digest
        return json.loads(raw) if parse else raw
    if not isinstance(pin, str) or re.fullmatch('[0-9a-f]{64}', pin) is None: raise ValueError('Explicit completed health pin required')
    health = read(RUN + '/health.json', pin)
    if (health['status'] != STATUS or health['completed_folds'] != ['fold1', 'fold2']
            or health['publishable'] is not False or health['production_changed'] is not False
            or members(REPO, RUN) != set(health['files']) | {'health.json'} or 'failure.json' in health['files']):
        raise ValueError('Exact completed nonpublishing evidence inventory required')
    for name, digest in health['files'].items(): read(RUN + '/' + name, digest, parse=False)
    for name, digest in read(RUN + '/consumed-file-sha256.json').items(): read(name, digest, parse=False)
    result = read(RUN + '/result.json')
    if result['status'] != STATUS or any(result[k] is not False for k in ('publishable', 'model_accepted', 'foundation_accepted', 'production_changed', 'new_model_fit')):
        raise ValueError('Nonpromoting unfitted diagnostic result required')
    summaries = {}
    for fold in ('fold1', 'fold2'):
        aggregate = read(RUN + '/' + fold + '/actor-diagnostics.json')
        if aggregate['aggregate_sha256'] != fingerprint({k: v for k, v in aggregate.items() if k != 'aggregate_sha256'}):
            raise ValueError('Aggregate semantic hash differs')
        games = []; goalie_shots = 0
        for gid in aggregate['game_ids']:
            game = read(RUN + f'/{fold}/games/{gid}.json')
            body = read(FREEZE + f'/{gid // 1_000_000}/pbp/{gid}.body.json', parse=False)
            receipt = read(FREEZE + f'/{gid // 1_000_000}/pbp/{gid}.receipt.json')
            if game['source_observed_at'] != timestamp(receipt['observed_at']): raise ValueError('Source age was changed')
            verify_raw_actors(game, body); games.append(game)
            positions = {r['player_id']: r['position'] for r in game['roster']}
            goalie_shots += sum(positions[e['shooter']['player_id']] == 'G' for e in game['events'])
        partitions = check_actor_totals(games, aggregate)
        inference = read(RUN + '/' + fold + '/inference.json')
        if inference['raw_max_abs_error'] != 0 or inference['calibrated_max_abs_error'] != 0 or inference['contexts_and_labels_exact'] is not True:
            raise ValueError('Exact completed source/model inference required for this checkpoint')
        summaries[fold] = {'summary': read(RUN + '/' + fold + '/summary.json'), 'accounting_partitions': partitions,
            'goalie_as_shooter_events': goalie_shots, 'source_actor_events_independently_verified': sum(len(g['events']) for g in games),
            'all_actor_stint_totals_and_nulls_independently_verified': True, 'inference': inference}
    for name, digest in checked.items():
        if snapshot(REPO, [name])[name]['sha256'] != digest: raise ValueError('End review drift')
    return {'contract': 'citrus-independent-actor-ledger-review-v1', 'status': 'reviewed-source-model-actor-diagnostic-not-accepted',
        'publishable': False, 'production_changed': False, 'health_sha256': pin, 'folds': summaries,
        'bound_file_sha256': checked,
        'limitations': ['Raw actor joins and ledger arithmetic independently checked; model inference receipt not independently refit.',
            'Eligible-event population only, not official actuals, appearance, TOI, full-season completeness or fantasy.',
            'Calibration, source and operational weaknesses remain; no model/foundation/FPAR acceptance.']}


def archive(output, pin):
    output = Path(output).absolute()
    if (output.parent != REPO / 'scripts/proof/results' or not output.name.startswith('analytics-actor-checkpoint-')
            or any(p.is_symlink() for p in (output, *output.parents))): raise ValueError('Scoped new archive output required')
    output.mkdir(exist_ok=False)
    try:
        persist(output, 'attempt-started.json', {'publishable': False})
        if json.loads(safe(REPO, REVIEW + '/review.json').read_bytes()) != review(pin): raise ValueError('Retained review drift')
        def git(*args): return subprocess.check_output(['git', *args], cwd=REPO).decode()
        commit = git('rev-parse', 'HEAD').strip()
        if git('status', '--porcelain', '--untracked-files=all', '--', *SOURCES): raise ValueError('Commit selected source before archive')
        source = snapshot(REPO, git('ls-tree', '-r', '--name-only', '-z', commit, '--', *SOURCES).rstrip('\0').split('\0'))
        roots = [RUN, REVIEW, VERIFY]
        evidence = snapshot(REPO, [folder + '/' + name for folder in roots for name in members(REPO, folder)])
        sp = output / 'source-head.tar.gz'
        with sp.open('xb') as stream: subprocess.run(['git', 'archive', '--format=tar.gz', commit, '--', *SOURCES], cwd=REPO, stdout=stream, check=True)
        source_proof = verify_archive(REPO, sp, source)
        ep = output / 'evidence.tar.gz'
        with ep.open('xb') as stream, tarfile.open(fileobj=stream, mode='w|gz') as bundle:
            for name in sorted(evidence): bundle.add(safe(REPO, name), arcname=name, recursive=False)
        evidence_proof = verify_archive(REPO, ep, evidence)
        if snapshot(REPO, source) != source or snapshot(REPO, evidence) != evidence: raise ValueError('Archive input drift')
        receipt = {'contract': 'citrus-local-actor-checkpoint-v1', 'status': 'complete-verified-local-duplicate',
            'verified_at': datetime.now(timezone.utc).isoformat(), 'source_commit': commit, 'source_roots': SOURCES,
            'evidence_roots': roots, 'archives': [source_proof, evidence_proof], 'health_sha256': pin,
            'review_sha256': evidence[REVIEW + '/review.json']['sha256'], 'originals_removed': False,
            'publishable': False, 'production_changed': False, 'limitations': ['Local duplicate, not off-machine backup or complete runtime environment.',
                'Prior archives, source captures and prospective reservations remain separately preserved.']}
        persist(output, 'receipt.json', receipt); return receipt
    except BaseException as error:
        persist(output, 'failure.json', {'status': 'failed-actor-preservation', 'error_type': type(error).__name__, 'publishable': False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--health-sha256', required=True)
    group = parser.add_mutually_exclusive_group(required=True); group.add_argument('--review', action='store_true'); group.add_argument('--archive-output')
    args = parser.parse_args()
    def stop(signum, frame): raise KeyboardInterrupt('Actor review interrupted')
    previous = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        if args.review:
            folder = REPO / REVIEW
            if any(p.is_symlink() for p in (folder, *folder.parents)): raise ValueError('Nonsymlink output required')
            result = review(args.health_sha256); folder.mkdir(exist_ok=False); persist(folder, 'review.json', result)
            print(json.dumps({'status': result['status'], 'bound_files': len(result['bound_file_sha256'])}))
        else: print(json.dumps(archive(args.archive_output, args.health_sha256)))
    finally:
        for s, handler in previous.items(): signal.signal(s, handler)


if __name__ == '__main__': main()

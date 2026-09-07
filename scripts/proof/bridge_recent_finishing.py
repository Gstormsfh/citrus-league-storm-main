"""Offline recent-candidate finishing; preserve separately reviewed non-shot credits.

Reuses hash-certified original actor rows, never treats this partial population as
complete season actuals. Does not estimate persistent talent or publish anything.
"""
import argparse
from collections import defaultdict
from pathlib import Path
import math
import re
from compose_player_finishing import aggregate
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint
from collect_development_sog_reports import module

RUNS = {
    'candidate': ('recent-candidate-replay-20260907-full', '9105778a28608d4993d7817730dfc80320205b4bbf1c69d635addab927670f99', 'complete-recent-candidate-full-vector-replay'),
    'actors': ('composed-player-finishing-20260907-full', 'debe080c52507e884231a72ad3c4abf0251ac282b9f148d3564f112e1eef6dc0', 'complete-source-bound-descriptive-finishing'),
    'partition': ('reviewed-goal-credit-partition-20260907-full', '939dd885644ff900afd86d582b9ec1c136c7c22d3177859a6f8b42e1ed9184d1', 'complete-reviewed-goal-credit-partition'),
}


def attach(rows, predictions, bindings):
    """Exact actor/event population and dated base-plus-sidecar identity."""
    expected = {(r['game_id'], r['event_id']) for r in rows}
    if len(expected) != len(rows) or expected != set(predictions):
        raise ValueError('Exact unique event population required')
    result = []
    for row in rows:
        p = predictions[row['game_id'], row['event_id']]
        key = p['bundle_fingerprint'], p['recent_sidecar_fingerprint']
        if key not in bindings or p.get('publishable') is not False:
            raise ValueError('Certified offline base and sidecar pair required')
        start, end = bindings[key]
        if not start <= row['game_date'] <= end:
            raise ValueError('Dated candidate binding mismatch')
        if 'neutral_xg' in row and row['neutral_xg'] != p['baseline_neutral_xg']:
            raise ValueError('Original baseline changed before candidate attachment')
        result.append({**row, 'neutral_xg': p['neutral_xg'],
                       'bundle_fingerprint': key[0], 'recent_sidecar_fingerprint': key[1]})
    return result


def recover(payload, partition, body_sha):
    if payload['id'] != partition['game_id'] or partition['publishable'] is not False:
        raise ValueError('Exact offline partition required')
    raw = {p['eventId']: p for p in payload['plays']}
    if len(raw) != len(payload['plays']) or len(partition['events']) != len(raw):
        raise ValueError('Complete unique raw population required')
    rows = []; credits = []; seen = set()
    roster = {(r['teamId'], r['playerId']) for r in payload['rosterSpots']}
    for event in partition['events']:
        eid = event['event_id']
        if eid in seen or eid not in raw or fingerprint(raw[eid]) != event['source_event_sha256']:
            raise ValueError('Exact source event required')
        seen.add(eid)
        if not (event['statistical_shot_attempt'] or event.get('reviewed_non_shot_goal')):
            continue
        play = raw[eid]; d = play['details']; goal = play['typeCode'] == 505
        actor = d['eventOwnerTeamId'], d['scoringPlayerId' if goal else 'shootingPlayerId']
        if (actor != (event['team_id'], event['player_id']) or actor not in roster
                or play['periodDescriptor']['periodType'] == 'SO' or payload['gameType'] not in (2, 3)):
            raise ValueError('Source actor and population required')
        row = {'game_id': payload['id'], 'event_id': eid, 'game_date': payload['gameDate'],
               'season': payload['id']//1000000, 'game_type': 'regular' if payload['gameType'] == 2 else 'playoff',
               'team_id': actor[0], 'player_id': actor[1], 'source_body_sha256': body_sha,
               'source_event_sha256': event['source_event_sha256']}
        if event.get('reviewed_non_shot_goal'):
            if (not goal or event['statistical_shot_attempt'] or event['shot_event_goal'] != 0
                    or event['official_goal_credit'] != 1 or event['recorded_sog'] != 0
                    or event['model_probability'] is not None):
                raise ValueError('Non-shot credit must not become a modeled attempt')
            credits.append({**row, 'goal_credit': 1, 'model_probability': None, 'publishable': False})
        else:
            kind = {505: 'goal', 506: 'shot-on-goal', 507: 'missed-shot'}[play['typeCode']]
            if event['shot_event_goal'] != int(goal) or event['recorded_sog'] != int(play['typeCode'] != 507):
                raise ValueError('Shot exposure mismatch')
            rows.append({**row, 'event_type': kind, 'is_goal': goal})
    return rows, credits


def credit_totals(rows, credits):
    """Keep credit-only players and historical teams without fabricating exposure."""
    out = defaultdict(lambda: {'shot_event_goals': 0, 'non_shot_goal_credits': 0})
    seen = set()
    for source, field in ((rows, 'shot_event_goals'), (credits, 'non_shot_goal_credits')):
        for r in source:
            eid = r['game_id'], r['event_id']
            if eid in seen: raise ValueError('Credits and attempts must be disjoint and unique')
            seen.add(eid)
            key = r['season'], r['game_type'], r['player_id'], r['team_id']
            out[key][field] += int(r['is_goal']) if field == 'shot_event_goals' else r['goal_credit']
    return [{'season': k[0], 'game_type': k[1], 'player_id': k[2], 'team_id': k[3], **v,
             'captured_goal_credits': sum(v.values()), 'population': 'selected_verified_games_only',
             'complete_season_actuals': False, 'publishable': False} for k, v in sorted(out.items())]


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT); writer = module('collect_goal_sog_evidence')
    paths = {}; healths = {}
    for key, (name, sha, status) in RUNS.items():
        paths[key] = 'scripts/proof/results/'+name
        healths[key] = pin_run(closure, paths[key], sha, status)
        closure.mapping(closure.read(paths[key]+'/consumed-file-sha256.json'))
    for name in ('bridge_recent_finishing.py', 'test_bridge_recent_finishing.py'):
        path = 'scripts/proof/'+name; closure.pin(path, file_sha(ROOT/path))
    manifest = closure.read(paths['candidate']+'/manifest.json'); baseline = fingerprint(manifest)
    bindings = {}
    for item in manifest['sidecars']:
        closure.pin(item['base_bundle'], item['base_sha256'])
        side_path = paths['candidate']+'/'+item['sidecar']; closure.pin(side_path, item['sidecar_sha256'])
        base = closure.read(item['base_bundle']); side = closure.read(side_path)
        if side['base_fingerprint'] != fingerprint(base) or side['fit']['month'] != item['month']:
            raise ValueError('Detached manifest binding')
        bindings[fingerprint(base), fingerprint(side)] = base['valid_from'], base['valid_to']
    recovered = {}; nonshot = {}
    for name in healths['partition']['files']:
        if not re.fullmatch(r'\d{10}\.json', name): continue
        part = closure.read(paths['partition']+'/'+name); gid = part['game_id']
        raw_path = f'scripts/proof/results/historical-official-freeze-20260906/{gid//1000000}/pbp/{gid}.body.json'
        # The previously certified partition closure already authenticates this body.
        if raw_path not in closure.checked: raise ValueError('Missing prior source authentication')
        recovered[gid], nonshot[gid] = recover(closure.read(raw_path), part, closure.checked[raw_path])
    print('Candidate, original actors and recovered source closures verified', flush=True)
    summaries = {}; used_recovered = set()
    for fold in ('fold1', 'fold2'):
        rows = closure.read(f"{paths['actors']}/{fold}/events.json")
        original_count = len(rows); original_games = {r['game_id'] for r in rows}
        pred_list = closure.read(f"{paths['candidate']}/{fold}-predictions.json")
        predictions = {(p['game_id'], p['event_id']): p for p in pred_list}
        if len(predictions) != len(pred_list): raise ValueError('Duplicate predictions')
        extra = {p['game_id'] for p in pred_list} - original_games
        if extra & used_recovered or not extra <= set(recovered): raise ValueError('Unexpected recovered population')
        used_recovered.update(extra); credits = []
        for gid in sorted(extra): rows.extend(recovered[gid]); credits.extend(nonshot[gid])
        rows = attach(rows, predictions, bindings)
        players = aggregate(rows, baseline); counts = credit_totals(rows, credits)
        if players != aggregate(rows[::-1], baseline): raise ValueError('Order dependence')
        if sum(p['eligible_event_attempts'] for p in players) != len(rows): raise ValueError('Attempt conservation')
        if sum(c['captured_goal_credits'] for c in counts) != sum(r['is_goal'] for r in rows)+len(credits):
            raise ValueError('Goal credit conservation')
        for suffix, value in (('events', rows), ('players', players), ('non-shot-credits', credits), ('goal-credit-totals', counts)):
            writer.write_new(output/f'{fold}-{suffix}.json', value)
        summaries[fold] = {'events': len(rows), 'original_events': original_count, 'recovered_events': len(rows)-original_count,
            'shot_event_goals': sum(r['is_goal'] for r in rows), 'non_shot_goal_credits': len(credits),
            'sog': sum(r['event_type'] != 'missed-shot' for r in rows),
            'neutral_xg': math.fsum(r['neutral_xg'] for r in rows), 'player_population_rows': len(players)}
        print(f'{fold}: {summaries[fold]}', flush=True)
    if used_recovered != set(recovered): raise ValueError('All recovered games required')
    closure.verify()
    writer.write_new(output/'consumed-file-sha256.json', closure.checked)
    writer.write_new(output/'summary.json', {'folds': summaries, 'baseline_sha256': baseline,
        'publishable': False, 'model_accepted': False, 'production_changed': False, 'official_actuals_replaced': False,
        'complete_season_actuals': False, 'estimated_talent': None, 'appearance_games': None, 'toi_seconds': None})
    writer.write_new(output/'health.json', {'status': 'complete-recent-candidate-descriptive-finishing',
        'publishable': False, 'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True); run(parser.parse_args().output)

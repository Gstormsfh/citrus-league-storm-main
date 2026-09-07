"""Every-event raw predecessor fidelity and saved point accounting; no fitting."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import signal
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
from projections.verified_movement_reuse_v2 import Closure
from projections.analytics_publication import fingerprint
from projections.verified_export_experiment import file_sha
from decompose_forward_shooter import pin_run
from prior_sog_fidelity import classify

SOURCE = 'scripts/proof/results/official-calibration-transfer-20260906-full'
SOURCE_SHA = '6cf9060710823e8a251518a6c5383cf56fc6b53ecaca89b6d6e45db536e4e44b'
FREEZE = 'scripts/proof/results/historical-official-freeze-20260906'
PLAN = 'docs/analytics-prior-sog-fidelity-plan-20260906.md'
PLAN_SHA = '323b2c1e886605255ac0e66eae87bd34fbf4e248b933292c35a2b7de754803a7'
CODE = ('scripts/proof/audit_prior_sog_fidelity.py', 'scripts/proof/test_audit_prior_sog_fidelity.py',
        'scripts/proof/prior_sog_fidelity.py', 'scripts/proof/test_prior_sog_fidelity.py',
        'scripts/proof/test_prior_sog_fidelity_review.py',
        'data-pipeline/projections/development_feature_export.py', 'data-pipeline/projections/causal_feature_contract.py',
        'scripts/proof/decompose_forward_shooter.py', 'data-pipeline/projections/verified_movement_reuse_v2.py',
        'data-pipeline/projections/verified_export_experiment.py', 'data-pipeline/projections/analytics_publication.py')
NAMES = ('fixed', 'expanding')
GROUPS = {None: None, '0': 'not_prior_same_team_sog', '1': 'prior_same_team_sog'}
EPSILON = 1e-12


def key(row):
    k = row.get('game_id'), row.get('event_id')
    if type(k[0]) is not int or not 0 < k[0] < 10**10 or type(k[1]) is not int or not 0 <= k[1] < 10**9:
        raise ValueError('Strict bounded integer event identity required')
    return k


def index(rows):
    if not isinstance(rows, list) or not 0 < len(rows) <= 1_000_000:
        raise ValueError('Bounded nonempty event list required')
    result = {key(r): r for r in rows}
    if len(result) != len(rows): raise ValueError('Duplicate event identity')
    return result


def probability(p):
    try:
        if type(p) not in (int, float) or not math.isfinite(p) or not 0 < p < 1:
            raise ValueError('Finite interior probability required')
    except OverflowError:
        raise ValueError('Representable probability required') from None
    return p


def join_saved(source, predictions):
    before, after = index(source), index(predictions)
    if before.keys() != after.keys(): raise ValueError('Exact saved source/prediction membership required')
    result = []
    for k in sorted(before):
        a, b = before[k], after[k]
        if (type(a.get('target')) is not int or a['target'] not in (0, 1)
                or type(b.get('target')) is not int or b['target'] != a['target']):
            raise ValueError('Exact binary saved target required')
        if not isinstance(a.get('groups'), dict) or a['groups'] != b.get('groups'):
            raise ValueError('Exact saved groups required')
        context = a.get('context')
        if not isinstance(context, dict) or 'prior_sog_same_team' not in context or context['prior_sog_same_team'] not in GROUPS:
            raise ValueError('Explicit prior-SOG context required')
        if 'prior_sog_same_team' not in a['groups'] or a['groups']['prior_sog_same_team'] != GROUPS[context['prior_sog_same_team']]:
            raise ValueError('Context/group representation mismatch')
        if not isinstance(b.get('predictions'), dict) or set(b['predictions']) != set(NAMES):
            raise ValueError('Exact two saved models required')
        for p in b['predictions'].values(): probability(p)
        result.append({**a, 'predictions': dict(b['predictions'])})
    return result


def audit_game(body, selected, body_sha, classifier=classify):
    wanted = index(selected)
    if not isinstance(body_sha, str) or len(body_sha) != 64 or any(c not in '0123456789abcdef' for c in body_sha):
        raise ValueError('Exact raw-body SHA required')
    gid = body.get('id')
    if type(gid) is not int or any(k[0] != gid for k in wanted): raise ValueError('Source game identity mismatch')
    game_date = body.get('gameDate')
    if not isinstance(game_date, str) or any(r.get('game_date') != game_date for r in selected):
        raise ValueError('Source/saved game date mismatch')
    home, away = body['homeTeam']['id'], body['awayTeam']['id']
    if type(home) is not int or type(away) is not int or home <= 0 or away <= 0 or home == away:
        raise ValueError('Distinct positive source teams required')
    plays = body.get('plays')
    if not isinstance(plays, list) or not 0 < len(plays) <= 100_000: raise ValueError('Bounded raw plays list required')
    seen, out, previous, prior_order, prior_time = set(), [], None, None, None
    period_types = {}
    for position, current in enumerate(plays):
        if not isinstance(current, dict): raise ValueError('Raw event object required')
        eid = current.get('eventId')
        if type(eid) is not int or not 0 <= eid < 10**9 or eid in seen: raise ValueError('Unique strict raw event IDs required')
        seen.add(eid)
        order, descriptor, clock = current.get('sortOrder'), current.get('periodDescriptor'), current.get('timeInPeriod')
        if type(order) is not int or order < 0 or prior_order is not None and order <= prior_order:
            raise ValueError('Strict increasing raw sort order required')
        if (not isinstance(descriptor, dict) or type(descriptor.get('number')) is not int or descriptor['number'] <= 0
                or descriptor.get('periodType') not in ('REG', 'OT', 'SO') or not isinstance(clock, str)
                or re.fullmatch(r'\d{2}:\d{2}', clock) is None or int(clock[3:]) >= 60):
            raise ValueError('Canonical raw period and clock required')
        period = descriptor['number']; stamp = (period, int(clock[:2])*60+int(clock[3:]))
        if prior_time is not None and stamp < prior_time: raise ValueError('Raw chronological order reversal')
        if period in period_types and period_types[period] != descriptor['periodType']: raise ValueError('Conflicting raw period type')
        period_types[period] = descriptor['periodType']; prior_order, prior_time = order, stamp
        if (gid, eid) in wanted:
            saved = wanted[gid, eid]
            classification = classifier(current, previous, home, away)
            if type(saved.get('target')) is not int or saved['target'] not in (0, 1):
                raise ValueError('Strict saved binary target required')
            if descriptor['periodType'] == 'SO': raise ValueError('Shootout outside original scored population')
            if type(current.get('typeCode')) is not int or current['typeCode'] not in (505, 506, 507):
                raise ValueError('Saved scored event must be official unblocked attempt')
            if int(current['typeCode'] == 505) != saved['target']: raise ValueError('Raw goal/shot target mismatch')
            if classification['expected_state'] != saved['context']['prior_sog_same_team']:
                raise ValueError(f'Raw predecessor/context disagreement at {gid}/{eid}')
            if saved['groups']['prior_sog_same_team'] != GROUPS[classification['expected_state']]:
                raise ValueError('Raw predecessor/group disagreement')
            out.append({'game_id': gid, 'event_id': eid, 'source_body_sha256': body_sha,
                'raw_play_index': position, 'predecessor_event_id': None if previous is None else previous['eventId'],
                'classification': classification, 'target': saved['target'], 'predictions': saved['predictions']})
        previous = current  # No filtering/skipping: immediate raw list predecessor.
    if set(index(out)) != set(wanted): raise ValueError('Every selected source event must be found exactly once')
    return out


def aggregate(rows):
    index(rows)
    for r in rows:
        if type(r['target']) is not int or r['target'] not in (0, 1): raise ValueError('Binary accounting targets required')
        if set(r['predictions']) != set(NAMES): raise ValueError('Exact accounting models required')
        for p in r['predictions'].values(): probability(p)
        c = r['classification']
        if c['expected_state'] not in GROUPS or not isinstance(c['reason'], str) or not c['reason'] or not isinstance(c['gap_band'], str) or not c['gap_band']:
            raise ValueError('Explicit accounting categories required')
    def summary(part):
        n = len(part); goals = sum(r['target'] for r in part)
        models = {}
        for name in NAMES:
            ps = [r['predictions'][name] for r in part]; expected = math.fsum(ps)
            brier = math.fsum((p-r['target'])**2 for p,r in zip(ps, part))/n
            clipped = [max(EPSILON, min(1-EPSILON, p)) for p in ps]
            ll = -math.fsum(math.log(p) if r['target'] else math.log1p(-p) for p,r in zip(clipped, part))/n
            models[name] = {'expected_goals': expected, 'observed_minus_expected_rate': (goals-expected)/n,
                            'brier': brier, 'log_loss_clipped': ll}
        delta = {metric: models['expanding'][metric]-models['fixed'][metric] for metric in ('brier', 'log_loss_clipped')}
        return {'events': n, 'games': len({r['game_id'] for r in part}), 'goals': goals,
            'support': 'sparse' if n < 100 or len({r['game_id'] for r in part}) < 30 else 'supported_exploratory',
            'models': models, 'expanding_minus_fixed': delta,
            'weighted_contributions': {m: v*n/len(rows) for m,v in delta.items()}}
    overall = summary(rows); rollups = {}
    for name, fields in [('state', ('expected_state',)), ('reason', ('reason',)), ('gap_band', ('gap_band',)),
                         ('state_reason_gap_band', ('expected_state', 'reason', 'gap_band'))]:
        cells = defaultdict(list)
        for r in rows: cells[tuple(r['classification'][f] for f in fields)].append(r)
        result = [{'cell': list(k), **summary(cells[k])} for k in sorted(cells, key=lambda k: json.dumps(k))]
        if sum(c['events'] for c in result) != len(rows) or sum(c['goals'] for c in result) != overall['goals']:
            raise ValueError('Count conservation failed')
        for metric in ('brier', 'log_loss_clipped'):
            if not math.isclose(math.fsum(c['weighted_contributions'][metric] for c in result), overall['expanding_minus_fixed'][metric], rel_tol=0, abs_tol=1e-12):
                raise ValueError('Loss contribution conservation failed')
        for model in NAMES:
            if not math.isclose(math.fsum(c['models'][model]['expected_goals'] for c in result), overall['models'][model]['expected_goals'], rel_tol=0, abs_tol=1e-9):
                raise ValueError('Expected goal conservation failed')
            for metric in ('brier', 'log_loss_clipped'):
                if not math.isclose(math.fsum(c['models'][model][metric]*c['events']/len(rows) for c in result), overall['models'][model][metric], rel_tol=0, abs_tol=1e-12):
                    raise ValueError('Absolute loss conservation failed')
        rollups[name] = result
    return {'overall': overall, 'rollups': rollups, 'publishable': False, 'point_accounting_only': True}


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or not output.name.startswith('prior-sog-fidelity-')
            or '..' in output.parts or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped create-only nonsymlink output required')
    output.mkdir(exist_ok=False); files = {}; closure = Closure(ROOT)
    def save(name, value):
        body = (json.dumps(value, sort_keys=True, allow_nan=False)+'\n').encode()
        with (output/name).open('xb') as stream: stream.write(body)
        files[name] = hashlib.sha256(body).hexdigest()
    try:
        save('attempt-started.json', {'started_at': datetime.now(timezone.utc).isoformat(), 'publishable': False})
        closure.pin(PLAN, PLAN_SHA)
        for name in CODE: closure.pin(name, file_sha(closure.safe(name)))
        pin_run(closure, SOURCE, SOURCE_SHA, 'complete-calibration-transfer-development-not-accepted')
        declaration = closure.read(SOURCE+'/declaration.json')
        closure.mapping(declaration['code_and_reference_sha256'])
        closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
        manifest = closure.read(SOURCE+'/source-reuse.json')
        if fingerprint(manifest) != declaration['source_manifest_sha256']: raise ValueError('Certified manifest fingerprint changed')
        closure.mapping(manifest['checked'])
        for folder, names in manifest['inventories'].items(): closure.inventory(folder, names)
        save('declaration.json', {'source': SOURCE, 'source_health_sha256': SOURCE_SHA, 'specification': PLAN,
            'specification_sha256': PLAN_SHA, 'code_and_sources_sha256': dict(closure.checked),
            'runtime': {'python': platform.python_version(), 'platform': platform.platform()},
            'publishable': False, 'fits': False, 'bootstrap': False, 'point_accounting_only': True})
        summaries = {}
        for fold in ('fold1', 'fold2'):
            selected = join_saved(closure.read(f'{SOURCE}/{fold}/source-validation.json'), closure.read(f'{SOURCE}/{fold}/predictions.json'))
            games = defaultdict(list)
            for r in selected: games[r['game_id']].append(r)
            output_rows = []
            for number, (gid, rows) in enumerate(sorted(games.items()), 1):
                name = f'{FREEZE}/{gid//1000000}/pbp/{gid}.body.json'
                receipt_name = name.replace('.body.json', '.receipt.json')
                if name not in manifest['checked'] or receipt_name not in manifest['checked']:
                    raise ValueError('Raw body and receipt must both be certified source members')
                receipt = closure.read(receipt_name)
                if (receipt.get('game_id') != gid or type(receipt.get('game_id')) is not int
                        or receipt.get('body_sha256') != manifest['checked'][name] or receipt.get('status') != 'verified'):
                    raise ValueError('Raw body/receipt linkage mismatch')
                body = closure.read(name)
                output_rows.extend(audit_game(body, rows, manifest['checked'][name]))
                if number % 100 == 0 or number == len(games):
                    print(json.dumps({'event': 'prior_sog_fidelity.progress', 'fold': fold, 'games': number, 'total_games': len(games)}, sort_keys=True), flush=True)
            output_rows.sort(key=key)
            if set(index(output_rows)) != set(index(selected)): raise ValueError('Complete fold membership required')
            save(f'{fold}-rows.json', output_rows); summaries[fold] = aggregate(output_rows); save(f'{fold}-accounting.json', summaries[fold])
        closure.verify(); save('checked-file-sha256.json', dict(closure.checked))
        save('result.json', {'folds': summaries, 'publishable': False, 'production_changed': False,
            'model_accepted': False, 'point_accounting_only': True,
            'limitations': ['Recorded immediate event context, not true rebound opportunities or causal attribution.',
                'Already inspected retrospective cohorts; no fit, bootstrap, statistical selection or acceptance.']})
        for name, sha in files.items():
            if file_sha(output/name) != sha: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-prior-sog-fidelity-no-fit-audit', 'publishable': False, 'files': dict(files)})
        return summaries
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'error': str(error), 'publishable': False}); raise


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Preserve interrupted no-fit audit')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True)
    run(parser.parse_args().output)

"""Bounded create-only retained-source pilot; no downloads or model fitting."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections.pl_onice_membership import build


def safe(path):
    path = Path(path).absolute()
    if '..' in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Nonsymlink canonical evidence required')
    return path


def run(output):
    output = safe(output)
    if output.parent != ROOT / 'scripts/proof/results' or not output.name.startswith('pl-onice-pilot-'):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False)
    checked, files = {}, {}

    def raw(path, expected=None):
        path = safe(path); body = path.read_bytes(); digest = hashlib.sha256(body).hexdigest()
        if expected is not None and digest != expected: raise ValueError('Parent-bound source hash mismatch')
        checked[str(path)] = digest
        return body

    def save(name, value):
        body = json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
        with (output / name).open('xb') as stream: stream.write(body)
        files[name] = hashlib.sha256(body).hexdigest()

    reports = ROOT / 'scripts/proof/results/historical-feature-reports-20260906'
    parent = json.loads(raw(reports / 'health.json'))
    inventory = json.loads(raw(reports / 'request-inventory.json', parent['request_inventory_sha256']))
    source_freeze = safe(parent['source_freeze'])
    raw(source_freeze / 'schedule-manifest.json', inventory['schedule_manifest_sha256'])
    expected = {r['game_id']: r for r in inventory['games']}
    successful = sorted(r['game_id'] for r in parent['games'] if r['status'] == 'captured_header_verified')
    parent_games = {r['game_id']: r for r in parent['games']}
    selected = [successful[round(i * (len(successful)-1) / 44)] for i in range(45)]
    if len(set(selected)) != 45: raise ValueError('45 distinct successful retained reports required')
    for name in ('data-pipeline/projections/pl_onice_membership.py', 'data-pipeline/projections/report_feature_source.py',
                 'data-pipeline/projections/report_feature_source_v2.py', 'scripts/proof/pilot_pl_onice_membership.py'):
        raw(ROOT / name)
    save('declaration.json', {'selected_games': selected, 'selection': '45 evenly spaced sorted parent-header-verified games',
                             'parent_status': parent['status'], 'checked_sha256': dict(checked), 'publishable': False})
    counts, games = Counter(), []
    for gid in selected:
        receipt = json.loads(raw(reports / f'{gid}.receipt.json'))
        source = expected[gid]
        if (receipt['game_id'] != gid or receipt['status'] != 'captured_header_verified'
                or receipt['body_sha256'] != parent_games[gid]['body_sha256']
                or receipt['pbp_body_sha256'] != source['pbp_body_sha256']
                or receipt['pbp_receipt_bytes_sha256'] != source['pbp_receipt_bytes_sha256']):
            raise ValueError('Receipt/parent inventory disagreement')
        html = raw(reports / f'{gid}-PL.HTM', parent_games[gid]['body_sha256'])
        folder = source_freeze / str(gid // 1000000) / 'pbp'
        pbp_receipt = json.loads(raw(folder / f'{gid}.receipt.json', source['pbp_receipt_bytes_sha256']))
        if pbp_receipt['body_sha256'] != source['pbp_body_sha256']: raise ValueError('PBP receipt mismatch')
        pbp = json.loads(raw(folder / f'{gid}.body.json', source['pbp_body_sha256']))
        try:
            result = build(html, pbp)
            local = Counter({'report_rows': len(result['report_rows']), 'shots': len(result['shots'])})
            for shot in result['shots']:
                local[shot['status']] += 1
                for side in ('away', 'home'):
                    if shot[side] is not None:
                        local[side + ':' + shot[side]['status']] += 1
                        for reason in shot[side]['reasons']: local['reason:' + reason] += 1
            save(f'{gid}.json', result)
            counts.update(local)
            games.append({'game_id': gid, 'status': 'parsed_retrospective', 'counts': dict(local)})
        except (ValueError, KeyError, TypeError) as error:
            evidence = {'game_id': gid, 'status': 'withheld_parse_failure', 'error_type': type(error).__name__,
                        'reason': str(error), 'publishable': False}
            save(f'{gid}.json', evidence); games.append(evidence); counts['withheld_parse_failure'] += 1
    for path, digest in checked.items():
        if hashlib.sha256(safe(path).read_bytes()).hexdigest() != digest: raise ValueError('Consumed source drift')
    save('report.json', {'status': 'complete-bounded-pilot-not-model-acceptance', 'publishable': False,
                        'prediction_eligible': False, 'games': games, 'counts': dict(counts),
                        'checked_sha256': checked, 'limitations': ['Only parent-header-verified retained reports sampled; not all seasons or failed bodies.',
                        'Membership is retrospective recorded annotation; no continuous shifts or causal timing established.']})
    save('health.json', {'status': 'complete-bounded-pilot-not-model-acceptance', 'files': dict(files), 'publishable': False})
    print(json.dumps({'games': len(games), 'counts': dict(counts)}))


if __name__ == '__main__': run(sys.argv[1])

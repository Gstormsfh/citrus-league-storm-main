"""Create-only sampled source/vector review, independent of runner flattening.

Uses the frozen selector/arithmetic themselves, so this checks delivery parity,
not an independently implemented physical model or selector correctness proof.
"""
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections.pre_shot_history import project
from projections.pre_shot_movement import NAMES

CONTEXTS = ('immediate_recorded_live_event', 'prior_same_team_unblocked_attempt')
RELATIONS = {None: None, 'same_team': 1, 'opponent': 0}


def run(destination):
    destination = Path(destination).absolute()
    if destination.parent != ROOT / 'scripts/proof/results' or not destination.name.startswith('movement-vector-review-'):
        raise ValueError('New scoped destination required')
    destination.mkdir(exist_ok=False)
    checked = {}

    def read(path, expected=None):
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and digest != expected:
            raise ValueError('Hash mismatch: ' + str(path))
        checked[str(path)] = digest
        return json.loads(raw)

    candidate = ROOT / 'scripts/proof/results/official-movement-20260906-full'
    declaration = read(candidate / 'declaration.json')
    for name in ('data-pipeline/projections/pre_shot_history.py', 'data-pipeline/projections/pre_shot_movement.py'):
        expected = declaration['code_and_reference_sha256'][name]
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError('Frozen projector changed')
        checked[str(ROOT / name)] = actual
    audit = read(candidate / 'feature-audit.json')
    names = audit['names']
    expected_names = [context + '__' + name for context in CONTEXTS for name in (*NAMES, 'same_team_indicator')]
    if names != expected_names:
        raise ValueError('Exact ordered semantic schema required')
    per_game = defaultdict(list)
    seen = set()
    for row in audit['vectors']:
        key = row['game_id'], row['event_id']
        if key in seen:
            raise ValueError('Duplicate saved vector')
        seen.add(key)
        per_game[row['game_id']].append(row)
    seasons = defaultdict(list)
    for gid in sorted(per_game):
        seasons[gid // 1000000].append(gid)
    selected = []
    for season, gids in sorted(seasons.items()):
        selected.extend(gids[i] for i in sorted({round(j * (len(gids) - 1) / 8) for j in range(9)}))
    if len(selected) < 45:
        raise ValueError('At least 45 distinct development games required')
    manifest = read(ROOT / declaration['plan']['export_dir'] / 'manifest.json')
    comparisons, games = 0, []
    for gid in selected:
        path = ROOT / declaration['plan']['freeze_dir'] / str(gid // 1000000) / 'pbp' / f'{gid}.body.json'
        payload = read(path, manifest['evidence_file_sha256'][str(path)])
        projected = project(payload['plays'], home=payload['homeTeam']['id'], away=payload['awayTeam']['id'])
        for saved in per_game[gid]:
            record = projected[saved['event_id']]
            semantic = {}
            for context in CONTEXTS:
                pair = record[context]
                semantic.update({context + '__' + key: value for key, value in pair['values'].items()})
                semantic[context + '__same_team_indicator'] = RELATIONS[pair['prior_owner_relation']]
            if set(semantic) != set(names) or [semantic[name] for name in names] != saved['values']:
                raise ValueError('Independent source/vector mismatch')
            comparisons += len(names)
        games.append({'game_id': gid, 'compared_selected_rows': len(per_game[gid])})
    checked[str(Path(__file__).absolute())] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    for path, expected in checked.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != expected:
            raise ValueError('Consumed source drift')
    report = {'status': 'exact-sampled-source-vector-match', 'publishable': False,
              'games': games, 'compared_selected_rows': sum(g['compared_selected_rows'] for g in games),
              'exact_value_comparisons': comparisons, 'checked_sha256': checked,
              'selection': 'Nine evenly spaced sorted candidate game IDs per season, all saved selected rows per sampled game.',
              'limitations': ['Uses the frozen production-independent selector/arithmetic implementation; not independent mathematical verification.',
                              'Does not verify model fitting, calibrators, losses, or full-corpus row eligibility.']}
    with (destination / 'report.json').open('x') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print(json.dumps({k: report[k] for k in ('status', 'compared_selected_rows', 'exact_value_comparisons')}))


if __name__ == '__main__':
    run(sys.argv[1])

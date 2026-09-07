"""Full frozen-development source replay and movement availability; no fitting."""
import hashlib
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections.development_replay import Replay
from projections.pre_shot_history import project
from projections.pre_shot_movement import NAMES


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT / 'scripts/proof/results' or not output.name.startswith('movement-coverage-'):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False)
    def save(name, obj):
        with (output / name).open('x') as stream:
            json.dump(obj, stream, allow_nan=False, sort_keys=True)
            stream.write('\n')
    sources = [Path(__file__), ROOT / 'data-pipeline/projections/pre_shot_history.py',
               ROOT / 'data-pipeline/projections/pre_shot_movement.py']
    hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    save('started.json', {'started_at': datetime.now(timezone.utc).isoformat(), 'code_sha256': hashes, 'publishable': False})
    try:
        replay = Replay(ROOT / 'scripts/proof/results/historical-official-freeze-20260906',
                        ROOT / 'scripts/proof/results/official-development-features-20260906',
                        ROOT / 'docs/analytics-development-ablation-plan-20260906.json')
        folds, _ = replay.replay()
        selected = {}
        for parts in folds.values():
            for part in parts.values():
                for row in part['rows']:
                    selected.setdefault(row['game_id'], set()).add(row['event_id'])
        stats, count = {}, 0
        digest = hashlib.sha256()
        for i, (gid, eids) in enumerate(sorted(selected.items())):
            path, _ = replay.paths(gid)
            payload = json.loads(replay.read(path))
            projected = project(payload['plays'], home=payload['homeTeam']['id'], away=payload['awayTeam']['id'])
            for eid in sorted(eids):
                row = projected[eid]
                digest.update(json.dumps([gid, eid, row], sort_keys=True, allow_nan=False).encode())
                count += 1
                for context in ('immediate_recorded_live_event', 'prior_same_team_unblocked_attempt'):
                    for name in NAMES:
                        value = row[context]['values'][name]
                        key = f'{gid // 1000000}:{context}:{name}'
                        entry = stats.setdefault(key, {'available': 0, 'missing': 0, 'nonzero': 0})
                        entry['missing' if value is None else 'available'] += 1
                        entry['nonzero'] += value is not None and value != 0
            if (i + 1) % 1000 == 0:
                print(json.dumps({'stage': 'movement_coverage', 'games': i + 1, 'events': count}), flush=True)
        replay.verify()
        for p, sha in hashes.items():
            if hashlib.sha256(Path(p).read_bytes()).hexdigest() != sha:
                raise ValueError('Movement source changed during replay')
        save('checked-source-sha256.json', replay.checked)
        save('result.json', {'status': 'complete-source-replay-coverage-only', 'games': len(selected),
                            'events': count, 'projected_row_sha256': digest.hexdigest(), 'availability': stats,
                            'publishable': False, 'model_fitted': False})
        print(json.dumps({'status': 'complete-source-replay-coverage-only', 'games': len(selected), 'events': count}), flush=True)
    except Exception as error:
        save('failure.json', {'error': str(error), 'publishable': False})
        raise


if __name__ == '__main__':
    run(sys.argv[1])

"""Full-vector, dated offline inference for the frozen earlier-loss selector.

No fitting, production authorization, or claim of untouched validation.
"""
import argparse
from copy import deepcopy
import math
from pathlib import Path
from projections.calibration_candidate import context_from_row
from recent_timing_inference import RecentCandidate, BANDS
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint
import evaluate_recovered_xg as evaluation
from collect_development_sog_reports import module

SOURCE = 'scripts/proof/results/timing-shape-20260907-full'
REPLAY = 'scripts/proof/results/recent-candidate-replay-20260907-full'
SELECTION = 'scripts/proof/results/earlier-shape-selection-20260907.json'


def choose(earlier):
    """Caller supplies only earlier original prequential predictions."""
    if not earlier:
        return False
    a = evaluation.score(earlier, 'recent_xg')
    b = evaluation.score(earlier, 'shape_xg')
    return all(b[k] < a[k] for k in ('brier', 'log_loss'))


class SelectedCandidate:
    def __init__(self, recent, shape, earlier):
        self.recent = recent
        self.shape = deepcopy(shape)
        fit = recent.fit
        if set(shape) != set(fit) or any(shape[k] != fit[k] for k in ('month', 'start_inclusive', 'end_exclusive')):
            raise ValueError('Exact dated shape fit required')
        if set(shape['bands']) != set(BANDS):
            raise ValueError('Exact timing bands required')
        for name, b in shape['bands'].items():
            if set(b) != {'intercept', 'slope_delta', 'mean_logit', 'projected_gradient', 'events', 'games', 'training_keys', 'training_end'}:
                raise ValueError('Exact shape fields required')
            if any(b[k] != fit['bands'][name][k] for k in ('events', 'games', 'training_keys', 'training_end')):
                raise ValueError('Shape and recent support must match')
            if any(type(b[k]) not in (int, float) or not math.isfinite(b[k]) for k in ('intercept', 'slope_delta', 'mean_logit', 'projected_gradient')):
                raise ValueError('Finite shape parameters required')
            if not (-10 <= b['intercept'] <= 10 and -.75 <= b['slope_delta'] <= 3 and 0 <= b['projected_gradient'] <= 1e-5):
                raise ValueError('Bounded converged monotone shape required')
            if (b['events'] < 30 or b['games'] < 10) and (b['intercept'] != 0 or b['slope_delta'] != 0):
                raise ValueError('Sparse fit must preserve baseline')
        evaluation.unique(earlier)
        if any(r['population'] != 'original' or not r['game_date'] < fit['end_exclusive'] for r in earlier):
            raise ValueError('Only strictly earlier original outcomes may select')
        self.use_shape = choose(earlier)
        self.training_games = {r['game_id'] for r in earlier}
        self.receipt = {'contract': 'citrus-selected-timing-offline-v1', 'publishable': False,
            'recent_fingerprint': recent.fingerprint, 'shape': self.shape,
            'earlier_predictions_sha256': fingerprint(earlier), 'earlier_events': len(earlier),
            'use_shape': self.use_shape}
        self.fingerprint = fingerprint(self.receipt)

    def predict(self, rows):
        if any(r['game_id'] in self.training_games for r in rows):
            raise ValueError('Selection training game overlap')
        out = self.recent.predict(rows)
        gi = self.recent.schema['names'].index('seconds_since_immediate_event')
        for r, p in zip(rows, out):
            p['recent_xg'] = p['neutral_xg']
            if self.use_shape:
                q = p['baseline_neutral_xg']  # Do not apply shape on top of recent offset.
                gap = r['features'][gi]
                context = context_from_row(r, self.recent.schema)
                if context['prior_sog_same_team'] == '1' and gap <= 10:
                    band = 'same_clock' if gap == 0 else 'up_to_1s' if gap <= 1 else 'over_1_under_3s' if gap < 3 else 'from_3_to_10s'
                    b = self.shape['bands'][band]
                    if b['intercept'] != 0 or b['slope_delta'] != 0:
                        clipped = min(1-1e-6, max(1e-6, q))
                        z = math.log(clipped)-math.log1p(-clipped)
                        z += b['intercept'] + b['slope_delta']*(z-b['mean_logit'])
                        q = 1/(1+math.exp(-z)) if z >= 0 else math.exp(z)/(1+math.exp(z))
                        q = min(1-1e-6, max(1e-6, q))
                p['neutral_xg'] = q
            p.update(selected_timing_fingerprint=self.fingerprint, publishable=False)
        return out


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False)
    c = reuse.Closure(ROOT)
    c.pin('scripts/proof/selected_timing_candidate.py', file_sha(Path(__file__)))
    for directory, digest, status in (
        (SOURCE, '6080f762775b5486d1561bf42935ddcc8b4a62f678a696c960c42474ffeeead5', 'complete-timing-shape-development-not-accepted'),
        (REPLAY, '9105778a28608d4993d7817730dfc80320205b4bbf1c69d635addab927670f99', 'complete-recent-candidate-full-vector-replay')):
        pin_run(c, directory, digest, status)
        c.mapping(c.read(directory+'/consumed-file-sha256.json'))
    selection = c.read(SELECTION)
    features = reuse.load(ROOT)
    writer = module('collect_goal_sog_evidence')
    manifest = c.read(REPLAY+'/manifest.json')['sidecars']
    summary = {}
    print('Frozen dependencies verified; replaying full feature vectors without refitting', flush=True)
    for fold in ('fold1', 'fold2'):
        expected = c.read(f'{SOURCE}/{fold}-predictions.json')
        keyed = evaluation.unique(expected)
        rows = list(features.folds[fold]['validation']['rows'])
        for gid in sorted({r['game_id'] for r in expected if r['population'] == 'recovered'}):
            rows.extend(c.read(f'{evaluation.FEATURES}/{gid}.json')['rows'])
        if set(evaluation.unique(rows)) != set(keyed):
            raise ValueError('Complete population required')
        result = []
        error = 0.
        for entry in (e for e in manifest if e['fold'] == fold):
            month = entry['month']
            recent = RecentCandidate.load(c.safe(entry['base_bundle']), entry['base_sha256'],
                c.safe(REPLAY+'/'+entry['sidecar']), entry['sidecar_sha256'])
            shape = c.read(f'{SOURCE}/{fold}-{month}-fit.json')
            earlier = [r for r in expected if r['population'] == 'original' and r['game_date'] < month+'-01']
            candidate = SelectedCandidate(recent, shape, earlier)
            if candidate.use_shape != selection['folds'][fold]['months'][month]['use_shape']:
                raise ValueError('Independent selection mismatch')
            batch = [r for r in rows if r['game_date'][:7] == month]
            for row, p in zip(batch, candidate.predict(batch)):
                old = keyed[p['game_id'], p['event_id']]
                if int(row['label']) != old['target'] or fingerprint(shape) != old['shape_fit_sha256']:
                    raise ValueError('Target or shape mismatch')
                want = old['shape_xg'] if candidate.use_shape else old['recent_xg']
                error = max(error, abs(want-p['neutral_xg']))
                result.append({**p, 'target': old['target'], 'population': old['population']})
            writer.write_new(output/f'{fold}-{month}-receipt.json', candidate.receipt)
            print(f'{fold}/{month}: {len(batch)} predictions verified', flush=True)
        if set(evaluation.unique(result)) != set(keyed) or error > 1e-12:
            raise ValueError('Full-vector parity failure')
        original = [r for r in result if r['population'] == 'original']
        summary[fold] = {'events': len(result), 'max_prediction_error': error,
            'reference': evaluation.score(original, 'recent_xg'), 'selected': evaluation.score(original, 'neutral_xg')}
        writer.write_new(output/f'{fold}-predictions.json', result)
    features.verify()
    c.verify()
    writer.write_new(output/'summary.json', {'folds': summary, 'publishable': False, 'production_changed': False,
        'limitation': 'Adaptive retrospective development, not untouched validation.'})
    writer.write_new(output/'consumed-file-sha256.json', {**features.closure.checked, **c.checked})
    writer.write_new(output/'health.json', {'status': 'complete-selected-timing-full-vector-replay', 'publishable': False,
        'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}})
    print({f: {k: v for k, v in s.items() if k in ('events', 'max_prediction_error')} for f, s in summary.items()}, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    run(parser.parse_args().output)

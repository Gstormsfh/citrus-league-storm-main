"""Synthetic receipts and real writer function bodies; no models or DB access."""
import ast
from copy import deepcopy
import hashlib
import json
import logging
from pathlib import Path
import sys
import subprocess
from types import SimpleNamespace, ModuleType

import numpy as np
import pandas as pd
import pytest

from acquisition.observed_sequences import extract_observed_sequences
from acquisition.event_observation_service import prepare_observation
from projections.analytics_publication import fingerprint
from projections.sequence_shadow import apply_sequence_shadow
from projections.sequence_value import GOAL


def play(eid, seconds, *, code=506):
    return {'eventId': eid, 'sortOrder': eid, 'typeCode': code,
            'periodDescriptor': {'number': 1, 'periodType': 'REG'},
            'timeInPeriod': f'{seconds//60:02}:{seconds%60:02}',
            'details': {'eventOwnerTeamId': 1}}


def receipt(plays):
    payload = {'id': 2024020001, 'season': 20242025, 'gameType': 2, 'gameState': 'OFF',
               'homeTeam': {'id': 1, 'score': sum(p['typeCode'] == 505 for p in plays),
                            'sog': sum(p['typeCode'] in (505, 506) for p in plays)},
               'awayTeam': {'id': 2, 'score': 0, 'sog': 0},
               'periodDescriptor': {'number': 3, 'periodType': 'REG'}, 'plays': plays}
    observed = '2026-09-05T00:00:00Z'
    return {'game_id': payload['id'], 'observed_at': observed, 'status': 'complete',
            'url': f'https://api-web.nhle.com/v1/gamecenter/{payload["id"]}/play-by-play',
            'prepared': list(prepare_observation(payload, observed))}


def fixture():
    source = receipt([play(1, 10), play(2, 12), play(3, 13, code=505)])
    sequences = extract_observed_sequences(source, max_gap_seconds=2)
    prediction = {'origin': 'citrus', 'source_receipt_sha256': fingerprint(source),
                  'conditioning': GOAL, 'model_sha256': fingerprint('synthetic model'),
                  'features_sha256': fingerprint('synthetic features'),
                  'calibrator_sha256': fingerprint('synthetic calibrator'), 'events': []}
    for e in sequences['chains'][0]['events']:
        prediction['events'].append({**{k: e[k] for k in
            ('game_id', 'event_id', 'sort_order', 'source_event_sha256')}, 'value': 0.2})
    context = {'source_receipt': source, 'max_gap_seconds': 2, 'prediction_receipt': prediction,
               'validation_receipt': {'evidence_kind': 'synthetic', 'status': 'passed',
                   'gate_version': 'synthetic-test-only', 'evidence_sha256': fingerprint('fixture'),
                   'prediction_receipt_sha256': fingerprint(prediction)}}
    frame = pd.DataFrame([{'game_id': source['game_id'], 'event_id': i,
                           'xG_Value': 0.2, 'distance': 5.0, 'shot_x': 84.0, 'shot_y': -2.0,
                           'arena_adjusted_x': 83.0, 'arena_adjusted_y': -2.5,
                           'has_pass_before_shot': 1, 'pass_quality_score': .42,
                           'shooting_talent_adjusted_xg': .23, 'shooting_talent_multiplier': 1.15,
                           'expected_rebound_probability': .12,
                           'expected_goals_of_expected_rebounds': .03,
                           'created_expected_goals': .23, 'is_goal': i == 3,
                           'passer_id': None, 'shot_type_raw': None} for i in (3, 1, 2)])
    frame.attrs['existing_provenance'] = {'status': 'legacy', 'nested': ['preserve']}
    return frame, source['prepared'][0]['payload']['pbp'], source['game_id'], context


@pytest.mark.parametrize('with_context', [False, True])
def test_synthetic_full_source_and_attested_predictions_compute_without_live_column_changes(with_context):
    frame, raw, gid, context = fixture()
    before = frame.copy(deep=True)
    attrs = deepcopy(frame.attrs)
    raw_bytes = json.dumps(raw, separators=(',', ':'), ensure_ascii=False).encode()
    raw_digest = hashlib.sha256(raw_bytes).hexdigest()
    context_before = deepcopy(context)
    result = apply_sequence_shadow(frame, raw, gid, context=context if with_context else None)
    pd.testing.assert_frame_equal(frame, before)
    assert {k: v for k, v in frame.attrs.items() if k != 'sequence_shadow'} == attrs
    assert context == context_before
    assert hashlib.sha256(json.dumps(raw, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest() == raw_digest
    assert result['status'] == ('computed' if with_context else 'unavailable')
    if not with_context:
        assert result['publishable'] is False
        return
    assert result['evidence_kind'] == 'synthetic' and result['publishable'] is False
    assert result['chains'][0]['event_ids'] == ['1', '2', '3']
    assert result['chains'][0]['contributions'] == pytest.approx([.2, .16, .128])


@pytest.mark.parametrize('change,reason', [
    ('missing_context', 'source_and_prediction_receipts_missing'),
    ('raw_revision', 'actual_source_conflict'),
    ('missing_attempt', 'incomplete_attempt_population'),
    ('duplicate', 'actual_population_conflict'),
    ('different_prediction', 'actual_prediction_conflict'),
    ('invalid_probability', 'missing_or_invalid_evidence'),
    ('missing_calibrator', 'missing_or_invalid_evidence'),
    ('detached_attestation', 'prediction_validation_conflict'),
    ('unknown_evidence_kind', 'evidence_kind_missing'),
])
def test_fail_closed(change, reason):
    frame, raw, gid, context = fixture()
    if change == 'missing_context': context = None
    if change == 'raw_revision': raw = {**raw, 'gameState': 'LIVE'}
    if change == 'missing_attempt': frame = frame.iloc[:2].copy()
    if change == 'duplicate': frame = pd.concat([frame, frame.iloc[:1]])
    if change == 'different_prediction': frame.loc[0, 'xG_Value'] = .3
    if change == 'invalid_probability': frame.loc[0, 'xG_Value'] = float('nan')
    if change == 'missing_calibrator':
        del context['prediction_receipt']['calibrator_sha256']
        context['validation_receipt']['prediction_receipt_sha256'] = fingerprint(context['prediction_receipt'])
    if change == 'detached_attestation': context['prediction_receipt']['model_sha256'] = 'a'*64
    if change == 'unknown_evidence_kind': context['validation_receipt']['evidence_kind'] = 'assumed'
    result = apply_sequence_shadow(frame, raw, gid, context=context)
    assert result['status'] == 'unavailable' and result['chains'] == []
    assert result['reason'] == reason and result['publishable'] is False


@pytest.mark.parametrize('value', [True, None, -0.01, 1.01, float('inf')])
def test_actual_probability_is_never_filled_or_clipped(value):
    frame, raw, gid, context = fixture()
    frame['xG_Value'] = pd.Series([value, .2, .2], dtype=object)
    result = apply_sequence_shadow(frame, raw, gid, context=context)
    assert result['status'] == 'unavailable' and result['chains'] == []


def test_source_revision_and_prediction_membership_are_bound():
    frame, raw, gid, context = fixture()
    context['prediction_receipt']['events'][0]['source_event_sha256'] = 'f' * 64
    context['validation_receipt']['prediction_receipt_sha256'] = fingerprint(context['prediction_receipt'])
    result = apply_sequence_shadow(frame, raw, gid, context=context)
    assert result['reason'] == 'prediction_event_identity_conflict'


@pytest.mark.parametrize('nightly', [False, True])
def test_real_launcher_path_setup_resolves_shadow_without_model_imports(nightly):
    root = Path(__file__).parents[2]
    path = root / ('data-pipeline/scoring/run_daily_pbp_processing.py' if nightly else
                   'data-pipeline/acquisition/data_acquisition.py')
    # Execute only the launcher-owned sys.path setup in a fresh isolated
    # interpreter, not its imports, models, or database work.
    script = r'''
import ast, os, sys
path, nightly = sys.argv[1], sys.argv[2] == 'True'
tree = ast.parse(open(path).read())
if nightly:
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'process_single_game')
    setup = next(n for n in fn.body if isinstance(n, ast.Try)).body
    stop = next(i for i, n in enumerate(setup) if isinstance(n, ast.ImportFrom) and n.module == 'process_xg_stats')
    setup = setup[:stop]
else:
    setup = [n for n in tree.body if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
             and ast.unparse(n.value.func) == 'sys.path.insert'][:1]
exec(compile(ast.Module(body=setup, type_ignores=[]), path, 'exec'),
     {'__file__': path, 'sys': sys, 'os': os})
from projections.sequence_shadow import apply_sequence_shadow
assert callable(apply_sequence_shadow)
assert 'joblib' not in sys.modules and 'data_acquisition' not in sys.modules
'''
    result = subprocess.run([sys.executable, '-I', '-c', script, str(path), str(nightly)],
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize('nightly', [False, True])
@pytest.mark.parametrize('with_context', [False, True])
def test_actual_postprediction_writer_calls_shadow_and_preserves_saved_columns(monkeypatch, nightly, with_context):
    frame, raw, gid, context = fixture()
    root = Path(__file__).parents[2]
    path = root / ('scripts/utilities/process_xg_stats.py' if nightly else
                   'data-pipeline/acquisition/data_acquisition.py')
    name = 'process_single_game_json' if nightly else 'process_game_from_raw_data'
    tree = ast.parse(path.read_text())
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    features = ModuleType('feature_calculations')
    features.apply_calculated_features_to_dataframe = lambda df: df
    def legacy_flurry(df, **kwargs):
        df = df.copy()
        df['flurry_adjusted_xg'] = .123
        return df
    features.calculate_flurry_adjusted_xg = legacy_flurry
    def preserve_existing_attrs(df):
        df.attrs.update(deepcopy(frame.attrs))
        return df
    features.apply_calculated_features_to_dataframe = preserve_existing_attrs
    monkeypatch.setitem(sys.modules, 'feature_calculations', features)
    # All database surfaces are fakes, including the pre-existing nightly delete.
    class Db:
        def table(self, *args): return self
        def delete(self): return self
        def eq(self, *args): return self
        def execute(self): return None
        def update(self, *args): return self
        def select(self, *args, **kwargs): return [1, 2, 3]
    db = Db()
    saved = []
    namespace = {'pd': pd, 'np': np, 'logger': logging.getLogger('test'), 'supabase': db,
                 '_extract_shots_from_game': lambda *args: frame.to_dict(orient='records'),
                 'get_fresh_supabase_client': lambda: db,
                 'USE_MONEYPUCK_MODEL': True, 'MODEL_FEATURES': ['distance'],
                 'XG_MODEL': SimpleNamespace(predict_proba=lambda X: np.array([[.8, .2]] * len(X))),
                 'XA_MODEL': None, 'XA_MODEL_FEATURES': [],
                 '_save_shots_to_database': lambda df, *args: saved.append(df.copy(deep=True))}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), namespace)
    args = (raw, gid) if nightly else (gid, raw, db)
    original_raw_bytes = json.dumps(raw, separators=(',', ':')).encode()
    original_context = deepcopy(context)
    result = namespace[name](*args, sequence_shadow_context=context if with_context else None)
    assert result is not None and len(saved) == 1
    diagnostic = saved[0].attrs['sequence_shadow']
    assert diagnostic['status'] == ('computed' if with_context else 'unavailable')
    assert diagnostic['publishable'] is False
    assert saved[0]['xG_Value'].tolist() == [.2, .2, .2]
    assert saved[0]['flurry_adjusted_xg'].tolist() == [.123, .123, .123]
    assert not any('shadow' in column for column in saved[0].columns)
    pd.testing.assert_frame_equal(saved[0][frame.columns], frame)
    assert saved[0].attrs['existing_provenance'] == frame.attrs['existing_provenance']
    assert {k for k in saved[0].attrs} == {'existing_provenance', 'sequence_shadow'}
    assert json.dumps(raw, separators=(',', ':')).encode() == original_raw_bytes
    assert context == original_context

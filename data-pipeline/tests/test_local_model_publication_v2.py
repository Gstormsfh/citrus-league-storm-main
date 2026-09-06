"""The versioned permission-test correction must not change model/aggregation code."""
import ast
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import local_model_publication_e2e as original
import local_model_publication_e2e_v2 as current


@pytest.mark.parametrize('name', ['aggregate', 'diagnostic_candidate', 'require_diagnostic',
                                 'withheld_copy', 'build_candidates'])
def test_model_and_candidate_function_bodies_unchanged(name):
    def body(path):
        tree = ast.parse(path.read_text())
        return ast.dump(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name))
    assert body(ROOT / 'scripts/local_model_publication_e2e.py') == body(ROOT / 'scripts/local_model_publication_e2e_v2.py')


def test_new_proof_version_is_explicit_and_additively_binds_original_code():
    assert current.VERSION == 'citrus-local-model-publication-proof-v2'
    assert current.VERSION != original.VERSION
    assert set(original.CODE) < set(current.CODE)
    assert {'scripts/local_model_publication_e2e_v2.py', 'scripts/proof/local_access_denial.py',
            'scripts/proof/run_local_model_publication_v4.mjs'} <= set(current.CODE)
    assert current.METRIC == original.METRIC
    assert current.POPULATION == original.POPULATION
    assert current.REVIEW_SHA == original.REVIEW_SHA


def test_v2_candidate_still_cannot_be_promoted():
    candidate = current.diagnostic_candidate('fold1', 2022, 'regular',
        [{'entity_id': 2022020001, 'value': 0, 'availability': 'available', 'reason': 'verified', 'exposure': 1}],
        {'feature_sha256': 'a' * 64, 'raw_model_sha256': 'b' * 64, 'calibrators_sha256': 'c' * 64},
        '2026-09-06T10:00:00Z', '2026-09-06T06:00:00Z', 'd' * 40)
    current.require_diagnostic(candidate)
    assert candidate[1]['validation']['gate_version'] == current.VERSION + ':diagnostic-transport-only'
    assert candidate[0]['payload']['publishable'] is False
    assert candidate[1]['validation']['freshness_observed_at'] == '2026-09-06T06:00:00+00:00'
    candidate[1]['validation']['foundation_accepted'] = True
    with pytest.raises(ValueError):
        current.require_diagnostic(candidate)

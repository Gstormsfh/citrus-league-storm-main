"""Synthetic diagnostic tests; never fit or load candidate artifacts."""
import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

spec = importlib.util.spec_from_file_location('zone_review_v2', Path(__file__).with_name('review_zone_inference_batches_v2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def test_policy_declared_and_rounding_only_tolerance():
    assert m.POLICY['calibrated_atol'] == 1e-12
    assert m.POLICY['calibrated_rtol'] == 0.
    a = np.array([.02])
    b = np.nextafter(a, 1.)
    assert 0 < m.compare(a, b, calibrated=True) < 1e-12
    with pytest.raises(ValueError, match='exactly'):
        m.compare(a, b, calibrated=False)


def test_no_relative_tolerance_or_performance_gate_relaxation():
    with pytest.raises(ValueError, match='tolerance'):
        m.compare([.9], [.9 + 2e-12], calibrated=True)


@pytest.mark.parametrize('actual,expected', [([float('nan')], [0]), ([float('inf')], [0]),
                                            ([0], [float('-inf')]), ([[.1]], [.1])])
def test_invalid_comparisons_fail_closed(actual, expected):
    with pytest.raises(ValueError):
        m.compare(actual, expected, calibrated=True)


def scoped(monkeypatch, tmp_path):
    monkeypatch.setattr(m, 'ROOT', tmp_path)
    results = tmp_path / 'scripts/proof/results'
    results.mkdir(parents=True)
    candidate = results / 'official-zone-context-test'
    candidate.mkdir()
    return candidate, results / 'zone-inference-batch-review-v2-test'


def test_existing_empty_output_is_not_owned_or_written(monkeypatch, tmp_path):
    candidate, output = scoped(monkeypatch, tmp_path)
    output.mkdir()
    with pytest.raises(FileExistsError):
        m.run(candidate, output)
    assert list(output.iterdir()) == []


def test_owned_failure_receipt_preserves_predeclared_plan(monkeypatch, tmp_path):
    candidate, output = scoped(monkeypatch, tmp_path)
    def fail(*args):
        assert json.loads((output / 'plan.json').read_text())['comparison_policy'] == m.POLICY
        raise ValueError('synthetic')
    monkeypatch.setattr(m, '_review', fail)
    with pytest.raises(ValueError, match='synthetic'):
        m.run(candidate, output)
    assert json.loads((output / 'failure.json').read_text())['error_type'] == 'ValueError'


@pytest.mark.parametrize('kind', ['traversal', 'wrong_prefix', 'symlink'])
def test_rejected_path_never_creates_output(monkeypatch, tmp_path, kind):
    candidate, output = scoped(monkeypatch, tmp_path)
    if kind == 'traversal':
        candidate = candidate / '..' / candidate.name
    elif kind == 'wrong_prefix':
        output = output.with_name('zone-inference-batch-review-v1-test')
    else:
        link = candidate.with_name('official-zone-context-link')
        link.symlink_to(candidate, target_is_directory=True)
        candidate = link
    with pytest.raises(ValueError):
        m.run(candidate, output)
    assert not output.exists()

from copy import deepcopy
from itertools import combinations
from pathlib import Path
import sys
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import record_calibration_shape_checkpoint as c


def report():
    statistics = {'events': 100, 'goals': 10,
        'models': {name: {'reliability': [{'lower': a, 'upper': b}
            for a, b in zip(c.EDGES, c.EDGES[1:])]} for name in c.NAMES},
        'paired_differences': [{'left': a, 'right': b} for a, b in combinations(sorted(c.NAMES), 2)]}
    return {'publishable': False, 'config': {'bin_edges': c.EDGES},
        'overall': deepcopy(statistics), 'subgroups': [{'dimension': d, 'value': None,
            'statistics': deepcopy(statistics)} for d in sorted(c.DIMENSIONS)]}


def test_complete_report_retains_all_candidates_and_dimensions():
    c.validate_report(report())


@pytest.mark.parametrize('mutation', [
    lambda r: r['overall']['models'].pop('reference_sigmoid'),
    lambda r: r['subgroups'].pop(),
    lambda r: r['subgroups'].append(deepcopy(r['subgroups'][0])),
    lambda r: r['subgroups'][0]['statistics'].__setitem__('events', 99),
    lambda r: r['subgroups'][0]['statistics'].__setitem__('goals', 9),
    lambda r: r['overall']['paired_differences'].pop(),
    lambda r: r['overall']['paired_differences'].__setitem__(1, r['overall']['paired_differences'][0]),
    lambda r: r['subgroups'][0]['statistics']['models']['monotone_logit']['reliability'].pop(),
    lambda r: r.__setitem__('publishable', True),
])
def test_incomplete_or_overstated_review_rejected(mutation):
    value = report(); mutation(value)
    with pytest.raises(ValueError):
        c.validate_report(value)


@pytest.mark.parametrize('pin', [None, '', 'abc', 'A' * 64, '../health.json'])
def test_health_pin_required_before_read(pin):
    with pytest.raises(ValueError):
        c.bound_review(pin)


def test_unsafe_archive_does_not_create(tmp_path):
    with pytest.raises(ValueError):
        c.archive(tmp_path / 'outside', '0' * 64)
    assert not (tmp_path / 'outside').exists()


def test_failed_review_keeps_attempt_and_never_overwrites(tmp_path, monkeypatch):
    monkeypatch.setattr(c, 'REPO', tmp_path)
    (tmp_path / 'scripts/proof/results').mkdir(parents=True)
    output = tmp_path / 'scripts/proof/results/analytics-calibration-shape-checkpoint-test'
    def fail(pin):
        raise ValueError('Missing or changed evidence')
    monkeypatch.setattr(c, 'bound_review', fail)
    with pytest.raises(ValueError):
        c.archive(output, '0' * 64)
    assert (output / 'attempt-started.json').exists() and (output / 'failure.json').exists()
    assert not (output / 'receipt.json').exists()
    with pytest.raises(FileExistsError):
        c.archive(output, '0' * 64)


def test_only_new_evidence_roots():
    assert c.ROOTS == ['scripts/proof/results/official-calibration-shape-experiment-20260906',
                       'scripts/proof/results/official-calibration-shape-review-20260906']

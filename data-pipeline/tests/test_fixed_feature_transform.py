import copy
import json

import pytest

from projections.fixed_feature_transform import fit, transform, validate


def fitted():
    return fit([{'x': 2., 'type': 'wrist'}, {'x': 20., 'type': 'slap'}],
               numeric=['x'], categorical=['type'])


def test_roundtrip_invariance_and_nonmutation():
    contract = json.loads(json.dumps(fitted(), allow_nan=False))
    rows = [{'x': None, 'type': 'wrist'}, {'x': 0., 'type': None}, {'x': 100., 'type': 'new'}]
    saved = copy.deepcopy((contract, rows))
    batch = transform(contract, rows)
    assert batch == [[11., 1, 3], [0., 0, 0], [100., 0, 1]]
    assert batch == [transform(contract, [row])[0] for row in rows]
    assert transform(contract, list(reversed(rows))) == list(reversed(batch))
    assert (contract, rows) == saved


def test_training_only_statistics_and_stable_unknowns():
    contract = fitted()
    assert transform(contract, [{'x': None, 'type': 'new'}, {'x': 999999., 'type': 'other'}])[0] == [11., 1, 1]
    assert contract['medians'] == [11.]
    assert contract['vocabularies'] == [['slap', 'wrist']]


@pytest.mark.parametrize('value', [True, '2', float('nan'), float('inf'), -float('inf'), 10**1000])
def test_invalid_numeric_rejected_on_fit_and_transform(value):
    with pytest.raises(ValueError):
        fit([{'x': value}], numeric=['x'], categorical=[])
    with pytest.raises(ValueError):
        transform(fitted(), [{'x': value, 'type': 'wrist'}])


@pytest.mark.parametrize('row', [{}, {'x': 1}, {'x': 1, 'type': 'wrist', 'extra': 0}, [1, 'wrist'], {'x': 1, 'type': True}])
def test_malformed_rows_fail_closed(row):
    with pytest.raises(ValueError):
        transform(fitted(), [row])


def test_missing_numeric_training_policy_and_categorical_tokens():
    with pytest.raises(ValueError, match='All-missing'):
        fit([{'x': None}], numeric=['x'], categorical=[])
    contract = fit([{'kind': None}], numeric=[], categorical=['kind'])
    assert transform(contract, [{'kind': None}, {'kind': 'anything'}]) == [[0], [1]]
    literal = fit([{'kind': '__MISSING__'}, {'kind': ''}], numeric=[], categorical=['kind'])
    assert transform(literal, [{'kind': '__MISSING__'}, {'kind': None}]) == [[3], [0]]


@pytest.mark.parametrize('numeric,categorical', [(['x', 'x'], []), (['x'], ['x']), ([], []), ([''], []), ('x', [])])
def test_invalid_schema(numeric, categorical):
    with pytest.raises(ValueError):
        fit([{'x': 1}], numeric=numeric, categorical=categorical)


@pytest.mark.parametrize('key,value', [('version', 'bad'), ('output_width', True), ('output_width', 99), ('medians', []), ('medians', [None]), ('vocabularies', [['wrist', 'slap']]), ('vocabularies', [['wrist', 'wrist']])])
def test_malformed_saved_contract(key, value):
    contract = fitted()
    contract[key] = value
    with pytest.raises(ValueError):
        transform(contract, [])


def test_missing_contract_and_empty_training():
    with pytest.raises(ValueError):
        validate({})
    with pytest.raises(ValueError):
        fit([], numeric=['x'], categorical=[])
    assert transform(fitted(), []) == []


def test_large_finite_median_stays_finite():
    contract = fit([{'x': 1e308}, {'x': 1e308}], numeric=['x'], categorical=[])
    assert transform(contract, [{'x': None}]) == [[1e308, 1]]


def test_subnormal_median_preserved():
    contract = fit([{'x': 5e-324}, {'x': 5e-324}], numeric=['x'], categorical=[])
    assert transform(contract, [{'x': None}]) == [[5e-324, 1]]

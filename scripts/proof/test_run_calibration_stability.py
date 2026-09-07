"""Synthetic chronology/selection contracts, no real-data calibration fit."""
from copy import deepcopy
import pytest
import run_calibration_stability as runner


def records():
    return [{'game_id': 2022020001+i, 'event_id': j, 'game_date': day, 'target': j%2}
            for i, day in enumerate(('2023-01-01', '2023-01-15', '2023-01-16', '2023-01-30', '2023-02-01', '2023-03-03'))
            for j in range(2)]


def test_monthly_partial_first_block_and_exact_expanding_prefix():
    rows = records(); before = deepcopy(rows)
    blocks = runner.monthly_blocks(rows, '2023-01-16')
    assert rows == before
    assert [b['month'] for b in blocks] == ['2023-01', '2023-02', '2023-03']
    assert len(blocks[0]['train_records']) == 4 and len(blocks[0]['test_records']) == 4
    assert len(blocks[1]['train_records']) == 8 and len(blocks[2]['train_records']) == 10
    assert blocks == runner.monthly_blocks(rows[::-1], '2023-01-16')
    for b in blocks:
        assert max(r['game_date'] for r in b['train_records']) < min(r['game_date'] for r in b['test_records'])


def test_future_outcome_flips_do_not_change_membership_or_earlier_fit_labels():
    rows = records(); changed = deepcopy(rows)
    for r in changed:
        if r['game_date'] >= '2023-02-01': r['target'] = 1-r['target']
    original = runner.monthly_blocks(rows, '2023-01-16')
    perturbed = runner.monthly_blocks(changed, '2023-01-16')
    assert [b['receipt'] for b in original] == [b['receipt'] for b in perturbed]
    assert original[1]['train_records'] == perturbed[1]['train_records']


@pytest.mark.parametrize('change', ['duplicate', 'bool', 'float', 'mixed_date', 'bad_date', 'all_early', 'all_later'])
def test_bad_monthly_sources_rejected(change):
    rows = records(); cutoff = '2023-01-16'
    if change == 'duplicate': rows.append(deepcopy(rows[0]))
    if change == 'bool': rows[0]['event_id'] = True
    if change == 'float': rows[0]['event_id'] = 0.
    if change == 'mixed_date': rows[0]['game_date'] = '2023-01-02'
    if change == 'bad_date': rows[0]['game_date'] = '2023-1-1'
    if change == 'all_early': cutoff = '2024-01-01'
    if change == 'all_later': cutoff = '2022-01-01'
    with pytest.raises(ValueError): runner.monthly_blocks(rows, cutoff)


def test_first_block_reuses_json_map_without_any_fitter_call(monkeypatch):
    block = runner.monthly_blocks(records(), '2023-01-16')[0]
    monkeypatch.setattr(runner.conditional, 'fit', lambda *a, **k: pytest.fail('firstblock fitted'))
    initial = {'synthetic': [1, 2, None]}
    result = runner.fit_block(block, initial, {}, {}, first=True)
    assert result == initial and result is not initial


def test_only_earlier_labels_probabilities_contexts_pass_to_fit(monkeypatch):
    blocks = runner.monthly_blocks(records(), '2023-01-16')
    block = blocks[1]; rows = records()
    raw = {(r['game_id'], r['event_id']): .1 for r in rows}
    context = {key: {'marker': key} for key in raw}
    captured = []
    monkeypatch.setattr(runner.conditional, 'fit', lambda p, y, c: captured.append((p, y, c)) or {'synthetic': True})
    result = runner.fit_block(block, {}, raw, context, first=False)
    assert result == {'synthetic': True}
    assert len(captured) == 1
    assert captured[0][1] == [r['target'] for r in block['train_records']]
    assert len(captured[0][0]) == len(block['train_records'])
    assert all(c['marker'] not in {(r['game_id'], r['event_id']) for r in block['test_records']} for c in captured[0][2])


def test_fit_block_rejects_same_date_or_shared_game(monkeypatch):
    block = runner.monthly_blocks(records(), '2023-01-16')[0]
    block['train_records'][0]['game_date'] = block['test_records'][0]['game_date']
    with pytest.raises(ValueError): runner.fit_block(block, {}, {}, {}, first=True)


def test_preflight_study_requires_both_folds_and_every_expected_block(monkeypatch):
    blocks = runner.monthly_blocks(records(), '2023-01-16')
    prepared = {f: {'blocks': deepcopy(blocks), 'contexts_by_key': {}} for f in ('fold1', 'fold2')}
    expected = {f: [b['receipt'] for b in blocks] for f in prepared}
    seen = []
    monkeypatch.setattr(runner, 'preflight_block', lambda b, c: seen.append(b['month']) or {})
    runner.preflight_study(prepared, expected)
    assert len(seen) == 6
    with pytest.raises(ValueError): runner.preflight_study({'fold1': prepared['fold1']}, expected)
    changed = deepcopy(expected); changed['fold2'][1]['test']['events'] += 1
    with pytest.raises(ValueError): runner.preflight_study(prepared, changed)


def test_guard_requires_each_loss_no_tolerance_or_nonfinite():
    losses = {n: {m: .1 for m in runner.METRICS} for n in runner.OUTPUTS}
    assert runner.primary_passed(losses)
    for m in runner.METRICS:
        changed = deepcopy(losses); changed['expanding'][m] += 1e-14
        assert not runner.primary_passed(changed)
    losses['expanding']['brier'] = float('nan')
    assert not runner.primary_passed(losses)

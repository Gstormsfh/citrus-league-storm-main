"""Synthetic manifests only: no fitting, historical datasets, or model loading."""
from copy import deepcopy

import pytest

from projections.analytics_publication import fingerprint
from projections.chronological_split import plan_chronological_split


NOW = '2026-09-06T00:00:00Z'


def fixture():
    manifest = {'source': 'official-nhl', 'feature_origin': 'citrus-official-nhl',
                'feature_version': 'test-pre-shot-v1', 'population_version': 'test-unblocked-v1',
                'features_sha256': fingerprint('synthetic feature code'),
                'source_receipts': [], 'events': []}
    windows = {name: {'start': f'2026-0{i}-01', 'end': f'2026-0{i}-28'}
               for i, name in enumerate(('train', 'calibration', 'test'), 1)}
    for i in (1, 2, 3):
        gid = 2025020000 + i
        receipt = {'sha256': fingerprint(['synthetic receipt', i]), 'game_id': gid,
                   'game_date': f'2026-0{i}-02', 'observed_at': '2026-04-01T00:00:00Z',
                   'source_url': f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play',
                   'event_ids': [1, 2]}
        manifest['source_receipts'].append(receipt)
        for eid in (1, 2):
            manifest['events'].append({'game_id': gid, 'event_id': eid,
                'game_date': receipt['game_date'], 'source_receipt_sha256': receipt['sha256'],
                'feature_sha256': fingerprint(['synthetic feature row', i, eid]),
                'eligible': True})
    return manifest, windows


def test_complete_chronological_game_partition_is_deterministic_and_retrospective():
    manifest, windows = fixture()
    original = deepcopy(manifest)
    result = plan_chronological_split(manifest, windows, now=NOW)
    assert result['status'] == 'planned-not-executed'
    assert result['test_claim'] == 'retrospective'
    assert result['historical_as_of_verified'] is False
    assert result['evidence_semantics'] == 'manifest-consistency-only'
    assert [[r['game_id'] for r in rows] for rows in result['members'].values()] == [
        [2025020001, 2025020001], [2025020002, 2025020002], [2025020003, 2025020003]]
    assert manifest == original
    manifest['events'].reverse()
    manifest['source_receipts'].reverse()
    assert plan_chronological_split(manifest, windows, now=NOW) == result
    assert result['receipt_sha256'] == fingerprint({k: v for k, v in result.items() if k != 'receipt_sha256'})


def test_explicit_exclusions_outside_windows_remain_bound():
    manifest, windows = fixture()
    receipt = deepcopy(manifest['source_receipts'][0])
    receipt.update(game_id=2025020004, game_date='2025-12-01', sha256=fingerprint('excluded source'),
                   event_ids=[9], source_url='https://api-web.nhle.com/v1/gamecenter/2025020004/play-by-play')
    manifest['source_receipts'].append(receipt)
    excluded = {'game_id': 2025020004, 'event_id': 9, 'game_date': receipt['game_date'],
                'source_receipt_sha256': receipt['sha256'], 'feature_sha256': fingerprint('excluded'),
                'eligible': False, 'exclusion_reason': 'outside declared population'}
    manifest['events'].append(excluded)
    result = plan_chronological_split(manifest, windows, now=NOW)
    assert result['exclusions'] == [excluded]
    excluded['exclusion_reason'] = 'revised explicit exclusion'
    changed = plan_chronological_split(manifest, windows, now=NOW)
    assert changed['receipt_sha256'] != result['receipt_sha256']
    assert changed['exclusions_sha256'] != result['exclusions_sha256']


@pytest.mark.parametrize('fault', ['missing_row', 'duplicate_row', 'duplicate_receipt',
    'wrong_game', 'wrong_receipt', 'conflicting_date', 'missing_date', 'numeric_date',
    'bool_id', 'bool_eligibility', 'unknown_field', 'missing_feature_hash',
    'unknown_provenance', 'external_features', 'wrong_url', 'missing_reason', 'eligible_reason'])
def test_invalid_membership_and_provenance_rejected(fault):
    manifest, windows = fixture()
    row = manifest['events'][0]
    if fault == 'missing_row': manifest['events'].pop()
    if fault == 'duplicate_row': manifest['events'].append(deepcopy(row))
    if fault == 'duplicate_receipt': manifest['source_receipts'].append(deepcopy(manifest['source_receipts'][0]))
    if fault == 'wrong_game': row['game_id'] = 999
    if fault == 'wrong_receipt': row['source_receipt_sha256'] = 'f' * 64
    if fault == 'conflicting_date': row['game_date'] = '2026-02-02'
    if fault == 'missing_date': del row['game_date']
    if fault == 'numeric_date': row['game_date'] = 20260102
    if fault == 'bool_id': row['game_id'] = True
    if fault == 'bool_eligibility': row['eligible'] = 1
    if fault == 'unknown_field': manifest['borrowed_parameters'] = 'unaccepted'
    if fault == 'missing_feature_hash': row['feature_sha256'] = None
    if fault == 'unknown_provenance': manifest['source'] = 'moneypuck-file'
    if fault == 'external_features': manifest['feature_origin'] = 'moneypuck'
    if fault == 'wrong_url': manifest['source_receipts'][0]['source_url'] = 'https://example.com/shots.csv'
    if fault == 'missing_reason': row['eligible'] = False
    if fault == 'eligible_reason': row['exclusion_reason'] = 'contradiction'
    with pytest.raises((ValueError, KeyError)):
        plan_chronological_split(manifest, windows, now=NOW)


@pytest.mark.parametrize('observed', [None, '2026-04-01', '2026-04-01T00:00:00',
                                    '2026-10-01T00:00:00Z', 'invalid', True])
def test_observation_must_be_explicit_aware_and_not_future(observed):
    manifest, windows = fixture()
    manifest['source_receipts'][0]['observed_at'] = observed
    with pytest.raises((ValueError, TypeError)):
        plan_chronological_split(manifest, windows, now=NOW)


def test_postgame_observation_allowed_but_not_available_before_observation():
    manifest, windows = fixture()
    assert plan_chronological_split(manifest, windows, now=NOW)['test_claim'] == 'retrospective'
    with pytest.raises(ValueError):
        plan_chronological_split(manifest, windows, now=NOW, historical_as_of='2026-03-01T00:00:00Z')
    result = plan_chronological_split(manifest, windows, now=NOW, historical_as_of='2026-05-01T00:00:00Z')
    assert result['observation_cutoff_check'] == 'timestamps-only'
    assert result['historical_as_of_verified'] is False


@pytest.mark.parametrize('fault', ['overlap', 'same_day', 'reversed', 'gap', 'missing_window', 'extra_window'])
def test_windows_require_exact_order_and_complete_eligible_assignment(fault):
    manifest, windows = fixture()
    if fault == 'overlap': windows['calibration']['start'] = '2026-01-20'
    if fault == 'same_day': windows['calibration']['start'] = windows['train']['end']
    if fault == 'reversed': windows['train']['end'] = '2025-12-01'
    if fault == 'gap': windows['calibration']['start'] = '2026-02-03'
    if fault == 'missing_window': del windows['test']
    if fault == 'extra_window': windows['tuning'] = windows['train']
    with pytest.raises(ValueError):
        plan_chronological_split(manifest, windows, now=NOW)


def prospective_fixture():
    manifest, windows = fixture()
    manifest['source_receipts'] = manifest['source_receipts'][:2]
    manifest['events'] = manifest['events'][:4]
    windows['test'] = {'start': '2026-10-01', 'end': '2026-10-31'}
    declaration = {'frozen_at': '2026-09-01T00:00:00Z',
        'pipeline_sha256': fingerprint('synthetic frozen pipeline'),
        'criteria_sha256': fingerprint('synthetic predeclared criteria'),
        'plan_spec_sha256': fingerprint({'windows': windows, 'source_manifest_sha256': fingerprint(manifest),
            **{k: manifest[k] for k in ('feature_version', 'population_version', 'features_sha256')}})}
    return manifest, windows, declaration


def test_future_window_is_only_an_empty_pinned_reservation():
    manifest, windows, declaration = prospective_fixture()
    result = plan_chronological_split(manifest, windows, now=NOW,
        test_claim='prospective-reservation', declaration=declaration)
    assert result['status'] == 'reserved-not-evaluated' and result['members']['test'] == []
    assert result['declaration'] == declaration
    declaration['criteria_sha256'] = fingerprint('changed after planning')
    assert result['declaration'] != declaration


@pytest.mark.parametrize('change', ['features', 'observation', 'exclusion'])
def test_reservation_pins_prior_training_and_calibration_manifest(change):
    manifest, windows, declaration = prospective_fixture()
    if change == 'features':
        manifest['events'][0]['feature_sha256'] = fingerprint('changed feature row')
    elif change == 'observation':
        manifest['source_receipts'][0]['observed_at'] = '2026-05-01T00:00:00Z'
    else:
        manifest['events'][0].update(eligible=False, exclusion_reason='changed selection')
    with pytest.raises(ValueError, match='specification'):
        plan_chronological_split(manifest, windows, now=NOW,
            test_claim='prospective-reservation', declaration=declaration)


@pytest.mark.parametrize('field', ['features_sha256', 'feature_version', 'population_version'])
def test_feature_and_population_lineage_changes_invalidate_plan_identity(field):
    manifest, windows = fixture()
    original = plan_chronological_split(manifest, windows, now=NOW)
    manifest[field] = fingerprint('revised features') if field.endswith('sha256') else 'revised-v2'
    changed = plan_chronological_split(manifest, windows, now=NOW)
    assert changed['receipt_sha256'] != original['receipt_sha256']


def test_source_revision_and_feature_row_hash_are_bound():
    manifest, windows = fixture()
    original = plan_chronological_split(manifest, windows, now=NOW)
    manifest['events'][0]['feature_sha256'] = fingerprint('revised feature row')
    changed = plan_chronological_split(manifest, windows, now=NOW)
    assert changed['membership_sha256']['train'] != original['membership_sha256']['train']
    manifest['source_receipts'][0]['observed_at'] = '2026-05-01T00:00:00Z'
    assert plan_chronological_split(manifest, windows, now=NOW)['receipt_sha256'] != changed['receipt_sha256']


@pytest.mark.parametrize('fault', ['missing', 'future_freeze', 'window_started', 'changed_spec', 'missing_criteria'])
def test_reservations_need_explicit_timing_and_pinned_plan(fault):
    manifest, windows, declaration = prospective_fixture()
    now = NOW
    if fault == 'missing': declaration = None
    if fault == 'future_freeze': declaration['frozen_at'] = '2026-09-07T00:00:00Z'
    if fault == 'window_started': now = '2026-10-01T00:00:00Z'
    if fault == 'changed_spec': windows['test']['end'] = '2026-10-30'
    if fault == 'missing_criteria': del declaration['criteria_sha256']
    with pytest.raises(ValueError):
        plan_chronological_split(manifest, windows, now=now,
            test_claim='prospective-reservation', declaration=declaration)


@pytest.mark.parametrize('claim', ['untouched', 'untouched-history', 'prospective', True])
def test_never_certifies_untouched_history_or_evaluated_prospective(claim):
    manifest, windows = fixture()
    with pytest.raises(ValueError):
        plan_chronological_split(manifest, windows, now=NOW, test_claim=claim)


@pytest.mark.parametrize('gid', [1, True, '2025020001', 2025020000, 2025010001,
                                2025040001, 1899020001, -2025020001])
def test_receipt_rejects_noncanonical_game_identity(gid):
    manifest, windows = fixture()
    manifest['source_receipts'][0]['game_id'] = gid
    manifest['source_receipts'][0]['source_url'] = f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play'
    for row in manifest['events'][:2]:
        row['game_id'] = gid
    with pytest.raises(ValueError, match='Canonical'):
        plan_chronological_split(manifest, windows, now=NOW)


@pytest.mark.parametrize('game_date,observed', [
    ('2026-10-01', '2026-04-01T00:00:00Z'),
    ('2026-01-02', '2026-01-01T23:59:59Z'),
    ('2024-01-02', '2026-04-01T00:00:00Z'),
])
def test_receipt_rejects_inconsistent_actual_game_calendar(game_date, observed):
    manifest, windows = fixture()
    manifest['source_receipts'][0].update(game_date=game_date, observed_at=observed)
    for row in manifest['events'][:2]:
        row['game_date'] = game_date
        row.update(eligible=False, exclusion_reason='still must have valid provenance')
    with pytest.raises(ValueError, match='timing'):
        plan_chronological_split(manifest, windows, now=NOW)


@pytest.mark.parametrize('value', [None, [], 'train', 1])
@pytest.mark.parametrize('nested', [False, True])
def test_window_structure_fails_with_validation_error(value, nested):
    manifest, windows = fixture()
    if nested:
        windows['train'] = value
    else:
        windows = value
    with pytest.raises(ValueError):
        plan_chronological_split(manifest, windows, now=NOW)


def test_observation_calendar_is_normalized_to_utc_without_inferring_puck_drop():
    manifest, windows = fixture()
    manifest['source_receipts'][0]['observed_at'] = '2026-01-01T20:00:00-07:00'
    result = plan_chronological_split(manifest, windows, now=NOW)
    assert result['evidence_semantics'] == 'manifest-consistency-only'
    assert result['historical_as_of_verified'] is False

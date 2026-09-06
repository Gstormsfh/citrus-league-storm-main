from copy import deepcopy
from pathlib import Path
import sys
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import local_model_publication_e2e as c


@pytest.fixture
def events():
    return [{'game_id': 2022020001, 'event_id': i, 'season': 2022,
             'game_type': 'regular', 'probability': p} for i, p in enumerate([0, .2, .7])]


def test_exact_game_aggregate_preserves_zero_and_exposure(events):
    expected = [(r['game_id'], r['event_id']) for r in events]
    result = c.aggregate(events, expected)
    assert list(result) == [(2022, 'regular')]
    assert result[2022, 'regular'][0]['value'] == pytest.approx(.9)
    assert result[2022, 'regular'][0]['exposure'] == 3
    events = events[:1]
    assert c.aggregate(events, expected[:1])[2022, 'regular'][0]['value'] == 0


@pytest.mark.parametrize('bad', ['duplicate', 'missing', 'extra', 'season', 'game_type',
    'nan', 'infinity', 'negative', 'above_one', 'boolean', 'event_identity', 'empty', 'duplicate_expected'])
def test_bad_event_population_rejected(events, bad):
    expected = [(r['game_id'], r['event_id']) for r in events]
    if bad == 'duplicate': events.append(deepcopy(events[0]))
    elif bad == 'missing': events.pop()
    elif bad == 'extra': events.append({**events[0], 'event_id': 5})
    elif bad == 'season': events[0]['season'] = 2023
    elif bad == 'game_type': events[0]['game_type'] = 'playoff'
    elif bad == 'event_identity': events[0]['event_id'] = True
    elif bad == 'empty': events = []
    elif bad == 'duplicate_expected': expected.append(expected[0])
    else: events[0]['probability'] = {'nan': float('nan'), 'infinity': float('inf'),
        'negative': -.1, 'above_one': 1.1, 'boolean': True}[bad]
    with pytest.raises(ValueError): c.aggregate(events, expected)


def test_regular_playoff_and_season_never_merge(events):
    events.extend([{**events[0], 'game_id': 2022030001, 'game_type': 'playoff'},
                   {**events[0], 'game_id': 2023020001, 'season': 2023}])
    result = c.aggregate(events, [(r['game_id'], r['event_id']) for r in events])
    assert set(result) == {(2022, 'regular'), (2022, 'playoff'), (2023, 'regular')}


@pytest.fixture
def candidate(events):
    values = c.aggregate(events, [(r['game_id'], r['event_id']) for r in events])[2022, 'regular']
    return c.diagnostic_candidate('fold1', 2022, 'regular', values,
        {'feature_sha256': 'a' * 64, 'raw_model_sha256': 'b' * 64, 'calibrators_sha256': 'c' * 64},
        '2026-09-06T10:00:00Z', '2026-09-06T06:00:00Z', 'd' * 40)


def test_diagnostic_is_not_serving_acceptance(candidate):
    c.require_diagnostic(candidate)
    assert candidate[1]['metric'] == c.METRIC
    assert candidate[1]['validation']['foundation_accepted'] is False
    assert candidate[0]['payload']['publishable'] is False
    assert candidate[1]['validation']['freshness_observed_at'] == '2026-09-06T06:00:00+00:00'


@pytest.mark.parametrize('bad', ['metric', 'population', 'variant', 'model_accepted',
                                'foundation_accepted', 'publishable', 'gate'])
def test_nonlocal_or_promoted_candidates_rejected(candidate, bad):
    if bad in ('metric', 'population', 'variant'): candidate[1][bad] = 'production'
    elif bad == 'gate': candidate[1]['validation']['gate_version'] = 'production-passed'
    else: candidate[0]['payload'][bad] = True
    with pytest.raises(ValueError): c.require_diagnostic(candidate)


def test_synthetic_withholding_preserves_original_and_old_freshness(candidate):
    before = deepcopy(candidate); copy = c.withheld_copy(candidate)
    assert candidate == before
    assert copy[0]['id'] != candidate[0]['id'] and copy[1]['id'] != candidate[1]['id']
    assert copy[2][0]['value'] is None
    assert copy[2][0]['reason'] == 'disposable_fixture_missing_source'
    assert copy[1]['validation']['freshness_observed_at'] == candidate[1]['validation']['freshness_observed_at']
    c.require_diagnostic(copy)


@pytest.mark.parametrize('url', ['https://localhost:1234', 'http://localhost.evil.test:1234',
    'http://127.0.0.1:1234?remote=true', 'http://user:password@localhost:1234', 'https://example.com'])
def test_remote_urls_fail_before_any_database_call(url):
    with pytest.raises(ValueError): c.guard_local(url, 'not-a-hosted-credential')

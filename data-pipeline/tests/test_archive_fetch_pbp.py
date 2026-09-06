"""Actual fetcher flow with fake REST and official HTTP responses only."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def fetcher(monkeypatch):
    path = Path(__file__).resolve().parents[2] / 'scripts/nhl_archive/fetch_pbp.py'
    spec = importlib.util.spec_from_file_location('archive_fetch_regression', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    return module


GID = 2024020001
DAY = '2024-10-01'
MANIFEST = [{'game_id': GID, 'date': DAY}]


def pair(gid=GID):
    shared = {'id': gid, 'gameDate': DAY, 'season': 20242025, 'gameType': 2,
              'gameState': 'OFF', 'homeTeam': {'id': 1}, 'awayTeam': {'id': 2}}
    return ({**deepcopy(shared), 'plays': [{'eventId': 1}]},
            {**deepcopy(shared),
             'playerByGameStats': {'homeTeam': {'forwards': []}, 'awayTeam': {'forwards': []}}})


def stored(fetcher, box=True):
    pbp, payload = pair()
    return {'game_id': GID, 'game_date': DAY, 'raw_json': pbp,
            'boxscore_json': payload if box else None, 'content_sha256': fetcher._sha256_of(pbp),
            'source_url': f'{fetcher.NHL_API_BASE}/gamecenter/{GID}/play-by-play',
            'processed': True, 'fetched_at': '2024-10-02T01:00:00Z'}


class FakeDB:
    def __init__(self, rows=(), fail_read=False, extra=False):
        self.rows = {row['game_id']: deepcopy(row) for row in rows}
        self.audits, self.writes = [], []
        self.fail_read, self.extra = fail_read, extra

    def select_exact(self, table, **kwargs):
        assert kwargs['order'] == 'game_id.asc' and kwargs['offset'] == 0
        assert kwargs['limit'] == 100
        if self.fail_read:
            raise RuntimeError('transport returned a partial page')
        ids = kwargs['filters'][0][2]
        return [deepcopy(row) for gid, row in sorted(self.rows.items()) if gid in ids or self.extra]

    def insert(self, table, rows):
        for row in rows:
            assert row['game_id'] not in self.rows
            self.rows[row['game_id']] = deepcopy(row)
        self.writes.append(deepcopy(rows))

    def update(self, table, values, filters):
        gid = filters[0][2]
        row = self.rows[gid]
        assert json.loads(filters[1][2]) == row['raw_json']
        assert filters[2] == ('boxscore_json', 'is', 'null') or json.loads(filters[2][2]) == row['boxscore_json']
        row.update(deepcopy(values))
        self.writes.append(deepcopy(values))

    def rpc(self, name, args):
        if name == 'citrus_fill_archive_boxscore':
            row = self.rows[args['p_game_id']]
            assert row['raw_json'] == args['p_expected_raw']
            assert row['game_date'] == args['p_game_date']
            assert row['content_sha256'] == args['p_expected_sha256']
            assert row['fetched_at'] == args['p_expected_fetched_at']
            assert row['boxscore_json'] is None
            row['boxscore_json'] = deepcopy(args['p_boxscore'])
            self.writes.append({'boxscore_json': deepcopy(args['p_boxscore'])})
            return True
        self.audits.append(args)


def official(monkeypatch, fetcher, pbp=None, box=None, fail_box=False):
    base_pbp, base_box = pair()
    class Response:
        status_code = 200
        def __init__(self, payload): self.payload = payload
        def json(self): return deepcopy(self.payload)
    def request(url, **kwargs):
        if url.endswith('/boxscore'):
            if fail_box:
                raise RuntimeError('synthetic failure')
            return Response(base_box if box is None else box)
        return Response(base_pbp if pbp is None else pbp)
    monkeypatch.setattr(fetcher, 'citrus_request', request)


def test_new_pair_inserts_and_unchanged_pair_preserves_observation(fetcher, monkeypatch):
    official(monkeypatch, fetcher)
    db = FakeDB()
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 0
    old = deepcopy(db.rows)
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 0
    assert db.rows == old and len(db.writes) == 1
    assert db.audits[-1]['p_gate_name'] == 'pbp_fetch_complete'
    assert db.audits[-1]['p_actual'] == 1


def test_failed_box_fetch_cannot_erase_good_box_or_report_success(fetcher, monkeypatch):
    official(monkeypatch, fetcher, fail_box=True)
    db = FakeDB([stored(fetcher)])
    old = deepcopy(db.rows)
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1
    assert db.rows == old and not db.writes and db.audits[-1]['p_actual'] == 0


def test_same_pbp_hash_does_not_skip_missing_box(fetcher, monkeypatch):
    official(monkeypatch, fetcher)
    old = stored(fetcher, box=False)
    db = FakeDB([old])
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 0
    assert db.rows[GID]['boxscore_json'] == pair()[1]
    assert db.rows[GID]['fetched_at'] == old['fetched_at']
    assert db.rows[GID]['processed'] is True and len(db.writes) == 1


@pytest.mark.parametrize('which', ['pbp', 'box'])
def test_corrections_withheld_until_versioned_storage_exists(fetcher, monkeypatch, which):
    pbp, box = pair()
    (pbp if which == 'pbp' else box)['correction'] = True
    official(monkeypatch, fetcher, pbp=pbp, box=box)
    db = FakeDB([stored(fetcher)])
    old = deepcopy(db.rows)
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1
    assert db.rows == old and not db.writes
    assert 'correction_requires_versioned_storage=1' in db.audits[-1]['p_note']


def test_partial_read_cannot_report_healthy(fetcher, monkeypatch):
    official(monkeypatch, fetcher)
    db = FakeDB([stored(fetcher)], fail_read=True)
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1
    assert not db.writes and len(db.audits) == 1 and db.audits[0]['p_actual'] == 0


def test_extra_unrequested_game_cannot_mask_missing_requested(fetcher, monkeypatch):
    official(monkeypatch, fetcher)
    row = stored(fetcher)
    row['game_id'] += 1
    db = FakeDB([row], extra=True)
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1
    assert db.audits[-1]['p_actual'] == 0 and not db.writes


@pytest.mark.parametrize('change', ['id', 'date', 'empty', 'nan'])
def test_invalid_official_pbp_pair_never_writes(fetcher, monkeypatch, change):
    pbp, _ = pair()
    if change == 'id': pbp['id'] += 1
    elif change == 'date': pbp['gameDate'] = '2024-10-02'
    elif change == 'empty': pbp['plays'] = []
    else: pbp['unexpected'] = float('nan')
    official(monkeypatch, fetcher, pbp=pbp)
    db = FakeDB()
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1 and not db.writes


def test_manifest_rejects_duplicates_empty_and_date_mismatch(fetcher, tmp_path):
    path = tmp_path / 'manifest.csv'
    for body in ['', f'{GID},2024,{DAY}\n{GID},2024,{DAY}\n', f'{GID},2024,2022-10-01\n']:
        path.write_text('game_id,season,date\n' + body)
        with pytest.raises(ValueError):
            fetcher.load_manifest_for_season(path, 2024)


def test_hash_is_legacy_semantic_json_not_compact_or_http_bytes(fetcher):
    payload = {'z': 1, 'a': [2]}
    assert fetcher._sha256_of(payload) == hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    with pytest.raises(ValueError):
        fetcher._sha256_of({'n': float('nan')})


@pytest.mark.parametrize('args', [['--rate-sleep', '0'], ['--rate-sleep', 'nan'], ['--limit', '0'], ['--limit', '-1']])
def test_cli_rejects_invalid_rate_or_limit_before_any_client(fetcher, monkeypatch, args):
    monkeypatch.setattr('sys.argv', ['fetch_pbp', '--season', '2024'] + args)
    with pytest.raises(SystemExit) as exc:
        fetcher.main()
    assert exc.value.code == 2


def test_compare_and_set_noop_cannot_report_success(fetcher, monkeypatch):
    official(monkeypatch, fetcher)
    db = FakeDB([stored(fetcher, box=False)])
    original_rpc = db.rpc
    monkeypatch.setattr(db, 'rpc', lambda name, args: False if name == 'citrus_fill_archive_boxscore'
                        else original_rpc(name, args))
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1
    assert db.audits[-1]['p_actual'] == 0


@pytest.mark.parametrize('box', [{}, [], False, 0])
def test_nonnull_existing_box_evidence_is_never_overwritten(fetcher, monkeypatch, box):
    official(monkeypatch, fetcher)
    previous = stored(fetcher)
    previous['boxscore_json'] = box
    db = FakeDB([previous])
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1
    assert db.rows[GID] == previous and not db.writes


def test_missing_rpc_cannot_fall_back_to_unguarded_update(fetcher, monkeypatch):
    official(monkeypatch, fetcher)
    previous = stored(fetcher, box=False)
    db = FakeDB([previous])
    original_rpc = db.rpc
    def unavailable(name, args):
        if name == 'citrus_fill_archive_boxscore':
            raise RuntimeError('RPC not deployed')
        return original_rpc(name, args)
    monkeypatch.setattr(db, 'rpc', unavailable)
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1
    assert db.rows[GID] == previous and not db.writes


def test_failure_in_final_read_never_installs_healthy_audit(fetcher, monkeypatch):
    official(monkeypatch, fetcher)
    db = FakeDB([stored(fetcher)])
    read = db.select_exact
    calls = 0
    def select(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('truncated final response')
        return read(*args, **kwargs)
    monkeypatch.setattr(db, 'select_exact', select)
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1
    assert len(db.audits) == 1 and db.audits[-1]['p_actual'] == 0


def test_requested_pages_are_disjoint_ordered_and_exact(fetcher):
    ids = list(range(GID, GID + 201))
    db = FakeDB([{'game_id': gid} for gid in ids])
    assert list(fetcher.existing_rows(db, dict.fromkeys(ids))) == ids


def test_partial_boxscore_does_not_complete_missing_evidence(fetcher, monkeypatch):
    _, box = pair()
    del box['playerByGameStats']['awayTeam']
    official(monkeypatch, fetcher, box=box)
    db = FakeDB([stored(fetcher, box=False)])
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1 and not db.writes


@pytest.mark.parametrize('field,value', [('source_url', None), ('source_url', 'https://example.com'),
                                      ('game_date', '2024-10-02'),
                                      ('content_sha256', 'wrong'),
                                      ('fetched_at', None), ('fetched_at', '2024-10-02T01:00:00'),
                                      ('fetched_at', '9999-01-01T00:00:00Z')])
def test_invalid_stored_provenance_never_repaired_or_certified(fetcher, monkeypatch, field, value):
    official(monkeypatch, fetcher)
    row = stored(fetcher)
    row[field] = value
    db = FakeDB([row])
    original = deepcopy(db.rows)
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1
    assert db.rows == original and not db.writes
    assert all(audit['p_actual'] == 0 for audit in db.audits)


@pytest.mark.parametrize('field,value', [('season', 20232024), ('gameType', 3),
                                      ('gameState', 'LIVE'), ('gameState', 'FUT')])
@pytest.mark.parametrize('endpoint', ['pbp', 'box'])
def test_payload_season_type_and_final_state_must_match(fetcher, monkeypatch, field, value, endpoint):
    pbp, box = pair()
    (pbp if endpoint == 'pbp' else box)[field] = value
    official(monkeypatch, fetcher, pbp=pbp, box=box)
    db = FakeDB()
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1 and not db.writes


def test_pair_home_away_must_match_not_just_have_valid_ids(fetcher, monkeypatch):
    _, box = pair()
    box['homeTeam'], box['awayTeam'] = box['awayTeam'], box['homeTeam']
    official(monkeypatch, fetcher, box=box)
    db = FakeDB()
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 1 and not db.writes


@pytest.mark.parametrize('gid', [2024020000, 2024010001, 202402001, True, '2024020001'])
def test_direct_boundaries_reject_noncanonical_game_ids(fetcher, gid):
    db = FakeDB()
    with pytest.raises(ValueError):
        fetcher.run(db, [{'game_id': gid, 'date': DAY}], 2024, 0.5)
    pbp, box = pair()
    with pytest.raises(ValueError):
        fetcher.upsert_raw(db, gid, DAY, pbp, box, 'url', fetcher._sha256_of(pbp))
    assert not db.writes


def test_structural_health_does_not_claim_full_official_stat_normalization(fetcher, monkeypatch):
    # Minimal synthetic plays deliberately lack the context required by the
    # canonical event normalizer/final totals verifier, which are separate gates.
    official(monkeypatch, fetcher)
    db = FakeDB()
    assert fetcher.run(db, MANIFEST, 2024, 0.5) == 0
    assert 'structural_pair_only_not_official_stat_adjudication' in db.audits[-1]['p_note']


@pytest.mark.parametrize('gid', ['2024020000', '2024010001', '02024020001'])
def test_manifest_rejects_zero_suffix_wrong_type_and_noncanonical_spelling(fetcher, tmp_path, gid):
    manifest = tmp_path / 'manifest.csv'
    manifest.write_text(f'game_id,season,date\n{gid},2024,{DAY}\n')
    with pytest.raises(ValueError):
        fetcher.load_manifest_for_season(manifest, 2024)


def test_historical_request_rejects_future_calendar_date(fetcher):
    assert not fetcher.valid_request(9998020001, '9998-10-01')
    with pytest.raises(ValueError):
        fetcher.run(FakeDB(), [{'game_id': 9998020001, 'date': '9998-10-01'}], 9998, 0.5)


@pytest.mark.parametrize('observed,valid', [('2024-09-30T23:59:59Z', False),
                                         ('2024-10-01T00:00:00Z', True),
                                         ('2024-09-30T20:00:00-04:00', True),
                                         ('2024-10-01T01:00:00+02:00', False)])
def test_observation_utc_date_must_not_precede_declared_game_date(fetcher, observed, valid):
    row = stored(fetcher)
    row['fetched_at'] = observed
    assert fetcher.valid_stored_provenance(row, GID) is valid

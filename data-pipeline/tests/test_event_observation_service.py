import copy
import pytest

from acquisition.event_observation_service import EventObservationService, prepare_observation
from tests.test_canonical_events import game, shot


class DB:
    def __init__(self):
        self.rows = {}
        self.fail = None

    def select(self, table, filters, **kwargs):
        col, _, value = filters[0]
        return copy.deepcopy([r for r in self.rows.get(table, []) if r[col] == value])

    select_exact = select

    def insert(self, table, rows):
        if self.fail == table:
            raise RuntimeError('interrupted')
        self.rows.setdefault(table, []).extend(copy.deepcopy(rows))


def test_record_replay_and_correction_preserve_both_source_revisions():
    db = DB()
    service = EventObservationService(db)
    payload = game([shot()])
    first = service.record(payload, '2026-01-01T00:00:00Z')
    assert not first['replayed'] and first['status'] == 'complete'
    assert service.record(payload, '2026-01-01T00:00:00Z')['replayed']
    correction = service.record(game([shot(typeCode=505)]), '2026-01-02T00:00:00Z')
    assert first['snapshot_id'] != correction['snapshot_id']
    assert len(db.rows['analytics_event_observations']) == 2


def test_partial_write_never_seals_and_retry_resumes():
    db = DB()
    service = EventObservationService(db)
    db.fail = 'analytics_event_observations'
    with pytest.raises(RuntimeError):
        service.record(game([shot()]), '2026-01-01T00:00:00Z')
    assert not db.rows.get('analytics_event_observation_sets')
    db.fail = None
    service.record(game([shot()]), '2026-01-01T00:00:00Z')
    assert len(db.rows['analytics_source_snapshots']) == 1


def test_conflict_refused_and_quarantine_retained_without_complete_status():
    db = DB()
    service = EventObservationService(db)
    payload = game([shot(), shot()])
    result = service.record(payload, '2026-01-01T00:00:00Z')
    assert result['status'] == 'quarantined' and result['quarantined_events'] == 1
    db.rows['analytics_event_observations'][0]['is_goal'] = True
    with pytest.raises(ValueError, match='conflicts'):
        service.record(payload, '2026-01-01T00:00:00Z')


def test_preparation_detaches_payload_and_rejects_unknown_observation_time():
    payload = game([shot()])
    prepared = prepare_observation(payload, '2026-01-01T00:00:00Z')
    payload['plays'].clear()
    assert prepared[0]['payload']['pbp']['plays']
    with pytest.raises(ValueError, match='timezone'):
        prepare_observation(game([shot()]), '2026-01-01T00:00:00')

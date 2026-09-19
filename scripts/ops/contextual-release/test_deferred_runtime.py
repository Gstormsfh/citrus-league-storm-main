import json
import pytest
import run_contextual_refresh as runner
from tests.test_contextual_release_runner import fixture
from operational_gates import SOURCE, PROJECT, SKATER_FLAGS, GOALIE_FLAGS
from run_contextual_monitor import evaluate
from test_runtime import fixture as gates_fixture, NOW


def test_first_run_saves_exact_reviewed_request_without_publishing(monkeypatch, tmp_path):
    service, _, options = fixture(monkeypatch, tmp_path)
    result = runner.execute(service, completion_mode='prepare', **options)
    assert result['status'] == 'awaiting_publication'
    assert service.posts == []
    raw = (options['attempt']/'completion-request.exact.json').read_text()
    assert '25.12345678901234567890123456789' in raw
    assert json.loads(raw)['p_context']['status'] == 'validated'
    assert any(json.loads(p.read_text()).get('status') == 'prepared' for p in options['attempt'].glob('event-*.json'))


def monitor_fixture():
    policy, s = gates_fixture()
    for j in s['jobs']:
        if j['jobid'] in (31, 34): j['active'] = False
    s['active'] = dict(source_revision=SOURCE, revision='c'*64, last_refresh_status='success', last_refresh_at='2026-09-19T09:40:00Z')
    common = dict(daily_rows=100, distinct_revisions=1, maximum_daily_ros_count_error=0)
    health = {'skaters': {**common, **dict.fromkeys(SKATER_FLAGS, True), 'skaters': 2, 'maximum_gp_error': 0},
              'goalies': {**common, **dict.fromkeys(GOALIE_FLAGS, True), 'goalies': 2, 'maximum_daily_ros_starts_error': 0}}
    execution = dict(startTime='2026-09-19T09:10:00Z', completionTime='2026-09-19T09:35:00Z', succeededCount=1)
    journal = dict(verified=True, revision='c'*64)
    return s, health, execution, journal, policy


def test_independent_monitor_accepts_exact_success():
    assert evaluate(*monitor_fixture(), NOW) == 'published'


@pytest.mark.parametrize('fault', ['failed', 'killed', 'stale', 'missing_cycle', 'mismatch', 'journal', 'stat', 'empty', 'cron', 'retries'])
def test_independent_monitor_detects_failures(fault):
    s, h, e, j, p = monitor_fixture()
    if fault == 'failed': e['failedCount'] = 1
    if fault == 'killed': e.pop('completionTime')
    if fault == 'stale': s['active']['last_refresh_at'] = '2026-09-17T09:40:00Z'
    if fault == 'missing_cycle': e['startTime'] = '2026-09-18T09:10:00Z'
    if fault == 'mismatch': j['revision'] = 'd'*64
    if fault == 'journal': j = None
    if fault == 'stat': h['skaters']['all_required_daily_stats_present'] = False
    if fault == 'empty': h['goalies']['goalies'] = 0
    if fault == 'cron': s['jobs'][-1]['active'] = True
    if fault == 'retries': e['retriedCount'] = 1
    with pytest.raises(ValueError): evaluate(s, h, e, j, p, NOW)

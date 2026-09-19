from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import sys
import pytest
sys.path.insert(0, str(Path(__file__).parent / 'runtime'))
from operational_gates import check_policy, dependencies, cloud_identity, output_health, SOURCE, PROJECT, SKATER_FLAGS, GOALIE_FLAGS

NOW = datetime(2026, 9, 19, 10, tzinfo=timezone.utc)


def fixture():
    policy = dict(project=PROJECT, production_authorized=True, source_revision=SOURCE,
                  reviewed_at='2026-09-18', review_after='2026-09-21', scope='preseason', status='approved')
    jobs = [dict(jobid=i, active=True) for i in (19, 20, 22, 32, 33)] + [
        dict(jobid=31, active=True, schedule='50 8 * * *', command='select public.rebuild_ros_projections(public.get_projection_target_season());'),
        dict(jobid=34, active=True, schedule='5 9 * * *', command='select public.rebuild_player_projected_stats(public.get_projection_target_season());')]
    snapshot = dict(jobs=jobs, draftBlockers=0, runs=[dict(jobid=i, status='succeeded',
        start_time='2026-09-19T08:58:00Z', end_time='2026-09-19T08:58:02Z') for i in (19, 20, 22, 32, 33)])
    return policy, snapshot


def test_production_policy_and_actual_dependencies():
    policy, snapshot = fixture()
    check_policy(policy, NOW)
    dependencies(snapshot, NOW, 'prepare')
    with pytest.raises(ValueError): dependencies(snapshot, NOW, 'publish')
    for j in snapshot['jobs']:
        if j['jobid'] in (31, 34): j['active'] = False
    dependencies(snapshot, NOW, 'publish')


@pytest.mark.parametrize('fault', ['expiry', 'staging', 'source', 'goalie', 'extend'])
def test_policy_rejects_unapproved_changes(fault):
    p, _ = fixture(); now = NOW
    if fault == 'expiry': now = NOW.replace(day=21)
    if fault == 'staging': p['production_authorized'] = False
    if fault == 'source': p['source_revision'] = 'f'*64
    if fault == 'goalie': p['goalie_calendar_policy'] = {'enabled': True}
    if fault == 'extend': p['review_after'] = '2026-10-01'
    with pytest.raises(ValueError): check_policy(p, now)


@pytest.mark.parametrize('fault', ['missing', 'failed', 'running', 'future', 'stale', 'disabled', 'drift', 'freeze'])
def test_dependencies_fail_closed(fault):
    _, s = fixture()
    if fault == 'missing': s['runs'].pop()
    if fault == 'failed': s['runs'].append({**s['runs'][0], 'status': 'failed', 'start_time': '2026-09-19T09:00:00Z'})
    if fault == 'running': s['runs'][0]['end_time'] = None
    if fault == 'future': s['runs'][0]['end_time'] = '2026-09-20T09:00:00Z'
    if fault == 'stale': s['runs'][0]['start_time'] = '2026-09-18T08:58:00Z'
    if fault == 'disabled': s['jobs'][0]['active'] = False
    if fault == 'drift': s['jobs'][-1]['command'] = 'unexpected'
    if fault == 'freeze': s['draftBlockers'] = 1
    with pytest.raises(ValueError): dependencies(s, NOW, 'prepare')


def test_identity_prevents_retry_and_wrong_database():
    env = dict(CLOUD_RUN_EXECUTION='citrus-contextual-production-example', CLOUD_RUN_TASK_INDEX='0',
               CLOUD_RUN_TASK_COUNT='1', CLOUD_RUN_TASK_ATTEMPT='0', SUPABASE_URL='https://'+PROJECT+'.supabase.co')
    assert cloud_identity(env).endswith('example')
    for key in env:
        bad = {**env, key: 'wrong'}
        with pytest.raises(ValueError): cloud_identity(bad)


def test_output_checks_reject_missing_category_or_empty_population():
    base = dict(daily_rows=100, distinct_revisions=1, all_required_daily_stats=True,
                active_revision_matches=True, maximum_daily_ros_count_error=1e-14)
    good = {'skaters': {**base, 'skaters': 2, **dict.fromkeys(SKATER_FLAGS, True), 'maximum_gp_error': 0},
            'goalies': {**base, 'goalies': 2, **dict.fromkeys(GOALIE_FLAGS, True), 'maximum_daily_ros_starts_error': 0}}
    output_health(good)
    for field, value in [('all_required_daily_stats', False), ('skaters', 0),
                         ('maximum_daily_ros_count_error', 0.1), ('distinct_revisions', 2)]:
        bad = deepcopy(good); bad['skaters'][field] = value
        with pytest.raises(ValueError): output_health(bad)

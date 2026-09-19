"""Operational guards only. No projection arithmetic or source replacement."""
from datetime import datetime, timedelta, timezone
import re

PROJECT = 'iezwazccqqrhrjupxzvf'
SOURCE = '70fd8899e67480cf7cd061a3b88e4a4110bc5a2f27ae756c300f48635fec8255'
UPSTREAM = (19, 20, 22, 32, 33)
COMMON_FLAGS = ('matching_output_players', 'daily_ros_revision_matches', 'active_revision_matches')
SKATER_FLAGS = COMMON_FLAGS + ('all_contextual', 'all_uncertainty', 'all_required_daily_stats_present',
    'all_required_ros_stats_present', 'optional_plus_minus_coverage_matches')
GOALIE_FLAGS = COMMON_FLAGS + ('all_required_daily_stats', 'all_required_ros_stats')


def require(value, reason):
    if not value:
        raise ValueError(reason)


def stamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'timezone_required')
    return result.astimezone(timezone.utc)


def check_policy(policy, now):
    require(policy.get('project') == PROJECT and policy.get('production_authorized') is True,
            'production_policy_required')
    require(policy.get('source_revision') == SOURCE, 'unreviewed_source')
    require(policy.get('review_after') == '2026-09-21' and
            policy['reviewed_at'] <= now.date().isoformat() < policy['review_after'], 'policy_expired')
    require(policy.get('scope') == 'preseason' and policy.get('status') == 'approved', 'unreviewed_policy')
    require(not policy.get('goalie_calendar_policy'), 'goalie_calendar_not_authorized')


def dependencies(snapshot, now, mode):
    require(mode in ('prepare', 'publish', 'monitor'), 'invalid_mode')
    boundary = now.replace(hour=9, minute=10, second=0, microsecond=0)
    if now < boundary:
        boundary -= timedelta(days=1)
    for jobid in UPSTREAM:
        jobs = [j for j in snapshot['jobs'] if j['jobid'] == jobid]
        require(len(jobs) == 1 and jobs[0]['active'] is True, 'upstream_disabled')
        runs = sorted((r for r in snapshot['runs'] if r['jobid'] == jobid),
                      key=lambda r: stamp(r['start_time']), reverse=True)
        require(bool(runs), 'upstream_missing')
        run = runs[0]
        require(run['status'] == 'succeeded' and run.get('end_time'), 'upstream_not_complete')
        start, end = stamp(run['start_time']), stamp(run['end_time'])
        require(start.date() >= boundary.date() and start <= end <= now and
                now-end <= timedelta(hours=26), 'upstream_stale')
    require(snapshot.get('draftBlockers') == 0 or mode == 'monitor', 'draft_freeze')
    old = sorted((j for j in snapshot['jobs'] if j['jobid'] in (31, 34)), key=lambda j: j['jobid'])
    require(len(old) == 2, 'legacy_cron_missing')
    require([j['schedule'] for j in old] == ['50 8 * * *', '5 9 * * *'], 'legacy_cron_drift')
    require([j['command'] for j in old] == [
        'select public.rebuild_ros_projections(public.get_projection_target_season());',
        'select public.rebuild_player_projected_stats(public.get_projection_target_season());'], 'legacy_cron_drift')
    require(all(j['active'] is (mode == 'prepare') for j in old), 'legacy_cron_mode_mismatch')
    return boundary


def output_health(value):
    for family, population in (('skaters', 'skaters'), ('goalies', 'goalies')):
        row = value[family]
        require(int(row[population]) > 0 and int(row['daily_rows']) > 0, 'empty_outputs')
        for flag in SKATER_FLAGS if family == 'skaters' else GOALIE_FLAGS:
            require(row.get(flag) is True, 'missing_or_failed_output_check')
        for field in ('maximum_daily_ros_count_error', 'maximum_gp_error' if family == 'skaters' else 'maximum_daily_ros_starts_error'):
            require(row.get(field) is not None and 0 <= float(row[field]) <= 1e-7, 'missing_or_failed_conservation_check')
        for key, supplied in row.items():
            if key.startswith('all_') or key in ('matching_output_players', 'daily_ros_revision_matches',
                    'active_revision_matches', 'optional_plus_minus_coverage_matches'):
                require(supplied is True, 'output_contract_failed')
            if key.startswith('maximum_'):
                require(supplied is not None and 0 <= float(supplied) <= 1e-7, 'output_conservation_failed')
        require(row['distinct_revisions'] == 1, 'mixed_output_revisions')


def cloud_identity(env):
    execution = env.get('CLOUD_RUN_EXECUTION', '')
    require(re.fullmatch(r'citrus-contextual-production-[a-z0-9-]+', execution) and
            env.get('CLOUD_RUN_TASK_INDEX') == '0' and env.get('CLOUD_RUN_TASK_COUNT') == '1' and
            env.get('CLOUD_RUN_TASK_ATTEMPT') == '0' and
            env.get('SUPABASE_URL') == 'https://' + PROJECT + '.supabase.co', 'single_attempt_production_job_required')
    return execution

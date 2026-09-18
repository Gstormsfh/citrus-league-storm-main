"""Read-only availability/freshness check for the SQL-owned projection outputs.

Does not rebuild models, certify accuracy, or assert complete player/game coverage.
Uses standard library only so the scheduled check cannot import a legacy writer.
"""
import json
import argparse
from math import isfinite
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from uuid import UUID


class HealthError(ValueError):
    pass


class ProjectionReader:
    def __init__(self, url, key, opener=urlopen):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or not re.fullmatch(r'[a-z0-9]+\.supabase\.co', parsed.netloc) or parsed.path not in ('', '/'):
            raise HealthError('invalid_supabase_url')
        if not key or '\n' in key or '\r' in key:
            raise HealthError('missing_or_invalid_api_key')
        self.url = url.rstrip('/')+'/rest/v1/'; self.key = key; self.opener = opener

    def get(self, path, params=None, *, counted=False):
        headers = {'apikey': self.key, 'Authorization': 'Bearer '+self.key}
        if counted: headers['Prefer'] = 'count=exact'
        request = Request(self.url+path+('?' + urlencode(params) if params else ''), headers=headers, method='GET')
        try:
            with self.opener(request, timeout=30) as response:
                body = response.read(1048577)
                if len(body) > 1048576: raise HealthError('oversized_response')
                value = json.loads(body)
                if not counted: return value
                match = re.fullmatch(r'(?:\d+-\d+|\*)/(\d+)', response.headers.get('Content-Range', ''))
                if not match: raise HealthError('missing_exact_count')
                return value, int(match[1])
        except HealthError:
            raise
        except Exception:
            # Do not put keys, URLs, response bodies or user data in job logs.
            raise HealthError('projection_read_failed') from None

    def target_season(self):
        return self.get('rpc/get_projection_target_season')

    def canonical_refresh(self, season):
        return self.get('canonical_published_runs', {
            'select': 'run_id,revision,activated_at,last_refresh_at,last_refresh_status',
            'season': f'eq.{season}', 'limit': 2})

    def remaining_games(self, season, today):
        return self.get('nhl_games', {'select': 'game_id', 'season': f'eq.{season}',
            'game_date': f'gte.{today}', 'game_type': 'eq.regular', 'limit': 1}, counted=True)

    def outputs(self, table, season, today):
        filters = self.output_filters(table, season, today)
        filters.update(select='updated_at', order='updated_at.asc.nullsfirst')
        return self.get(table, filters, counted=True)

    @staticmethod
    def output_filters(table, season, today):
        filters = {'season': f'eq.{season}', 'limit': 1}
        if table == 'player_projected_stats': filters['projection_date'] = f'gte.{today}'
        elif table == 'player_ros_projections': filters['games_remaining'] = 'gt.0'
        else: raise HealthError('unsupported_output_table')
        return filters

    def mismatched_outputs(self, table, season, today, run_id, revision):
        validate_publication_identity({'run_id': run_id, 'revision': revision})
        filters = self.output_filters(table, season, today)
        filters.update(select='player_id', **{'or':
            f'(projection_run_id.is.null,projection_revision.is.null,'
            f'projection_run_id.neq.{run_id},projection_revision.neq.{revision})'})
        return self.get(table, filters, counted=True)

    def model_capability(self, season, today, capability):
        filters = {'select': 'player_id', 'season': f'eq.{season}',
                   'projection_date': f'gte.{today}', 'is_goalie': 'eq.false', 'limit': 1}
        if capability == 'flat':
            filters['calculation_method'] = 'eq.canonical_expected_volume_v1'
        elif capability == 'opponent':
            filters['opponent_adjustment'] = 'gt.0'
        elif capability == 'simulation':
            # An explicitly excluded game correctly has zero mean and zero
            # uncertainty. Require contextual provenance and supplied intervals,
            # not invented positive uncertainty on unavailable dates.
            filters['calculation_method'] = 'eq.canonical_contextual_v1'
            filters['projection_std_dev'] = 'gte.0'
            filters['projection_ci_50_lower'] = 'not.is.null'
            filters['projection_ci_50_upper'] = 'not.is.null'
        elif capability != 'total':
            raise HealthError('unknown_model_capability')
        return self.get('player_projected_stats', filters, counted=True)

    def defensive_history(self, season):
        cache = self.get('team_stats', {'select':'team_abbrev,games_played,goals_against_avg,shots_against_avg,save_pct',
                                      'season':f'eq.{season}', 'order':'team_abbrev.asc'})
        games = []
        total = None
        while total is None or len(games) < total:
            batch, count = self.get('nhl_games', {'select':'game_id,home_team,away_team',
                'season':f'eq.{season}', 'game_type':'eq.regular', 'status':'eq.final',
                'order':'game_id.asc', 'limit':500, 'offset':len(games)}, counted=True)
            if not isinstance(batch, list) or (total is not None and count != total):
                raise HealthError('defensive_schedule_changed_during_read')
            total = count
            if not batch and len(games) < total:
                raise HealthError('defensive_schedule_incomplete')
            games.extend(batch)
        if len(games) != total:
            raise HealthError('defensive_schedule_incomplete')
        return cache, games


def check_defensive_history(reader, season):
    """Coverage gate only; it does not certify xGA/GAR or future line exposure."""
    cache, games = reader.defensive_history(season)
    played = {}
    ids = set()
    for game in games:
        if game['game_id'] in ids:
            raise HealthError('duplicate_defensive_schedule_game')
        ids.add(game['game_id'])
        for team in (game['home_team'], game['away_team']):
            played[team] = played.get(team, 0)+1
    by_team = {r['team_abbrev']:r for r in cache}
    if len(by_team) != len(cache):
        raise HealthError('duplicate_defensive_cache_team')
    mismatched = sorted(team for team, n in played.items() if by_team.get(team, {}).get('games_played') != n)
    missing = sorted(team for team in played if any(by_team.get(team, {}).get(k) is None
        for k in ('goals_against_avg','shots_against_avg','save_pct')))
    invalid = []
    for team in sorted(played):
        for field in ('goals_against_avg', 'shots_against_avg', 'save_pct'):
            value = by_team.get(team, {}).get(field)
            if value is None:
                continue  # Reported by missing_fields, not treated as zero.
            try:
                if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                    raise ValueError('Not a numeric statistic')
                number = float(value)
                if not isfinite(number) or number < 0 or (field == 'save_pct' and number > 1):
                    raise ValueError('Invalid defensive statistic')
            except (ValueError, TypeError, OverflowError):
                invalid.append({'team': team, 'field': field})
    extra = sorted(set(by_team)-set(played))
    return {'status':'coverage_present' if played and not (mismatched or missing or invalid or extra) else 'degraded',
            'season':season, 'games':len(games), 'teams':len(played),
            'coverage_mismatch':mismatched, 'missing_fields':missing, 'invalid_fields':invalid, 'unscheduled_teams':extra,
            'accuracy_validated':False, 'line_matchups_validated':False}


def check_model_capabilities(reader, season, today):
    """Fresh flat rows are not proof that matchup or MC models are serving."""
    counts = {}
    for kind in ('total', 'flat', 'opponent', 'simulation'):
        rows, count = reader.model_capability(season, today, kind)
        validate_count(rows, count, kind)
        counts[kind] = count
    total = counts['total']
    if any(n > total for n in counts.values()):
        raise HealthError('model_capability_counts_inconsistent')
    failures = []
    if not total: failures.append('no_skater_model_rows')
    if counts['flat']: failures.append('flat_season_allocations_serving')
    if counts['opponent'] != total: failures.append('opponent_adjustments_incomplete')
    if counts['simulation'] != total: failures.append('monte_carlo_output_incomplete')
    return {'status': 'degraded' if failures else 'present', 'counts': counts,
            'failures': failures, 'accuracy_validated': False,
            'line_matchups_validated': False}


def validate_count(rows, count, label):
    if not isinstance(rows, list) or type(count) is not int or count < 0 or len(rows) != min(count, 1):
        raise HealthError(label+'_invalid_count_response')


def validate_publication_identity(active):
    try:
        run_id = active['run_id']
        if not isinstance(run_id, str) or str(UUID(run_id)) != run_id:
            raise ValueError('Invalid run ID')
        if not isinstance(active['revision'], str) or not re.fullmatch(r'[0-9a-f]{64}', active['revision']):
            raise ValueError('Invalid revision')
    except (KeyError, TypeError, ValueError):
        raise HealthError('canonical_publication_identity_invalid') from None


def validate_fresh_timestamp(value, now, label):
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (TypeError, ValueError, AttributeError):
        raise HealthError(label+'_invalid_timestamp') from None
    if stamp.tzinfo is None: raise HealthError(label+'_invalid_timestamp')
    if stamp > now+timedelta(minutes=5): raise HealthError(label+'_future_timestamp')
    if now-stamp > timedelta(hours=36): raise HealthError(label+'_stale')
    return stamp


def check(reader, now):
    if now.tzinfo is None: raise HealthError('timezone_required')
    now = now.astimezone(timezone.utc); season = reader.target_season()
    if type(season) is not int or not now.year-1 <= season <= now.year+1:
        raise HealthError('invalid_projection_target_season')
    today = now.date().isoformat(); games, count = reader.remaining_games(season, today)
    validate_count(games, count, 'schedule')
    result = {'scope': 'sql_projection_output_availability_and_freshness', 'read_only': True,
              'target_season': season, 'remaining_schedule_rows': count, 'checked_at': now.isoformat(),
              'accuracy_validated': False, 'complete_coverage_validated': False}
    if count == 0:
        return {**result, 'status': 'not_required_no_remaining_schedule', 'outputs': {}}
    active = reader.canonical_refresh(season)
    if not isinstance(active, list) or len(active) > 1:
        raise HealthError('canonical_active_response_invalid')
    if active:
        if not isinstance(active[0], dict): raise HealthError('canonical_active_response_invalid')
        state = active[0].get('last_refresh_status')
        # A failed refresh leaves yesterday's valid rows intact. Their age must
        # not mask the failure for the remainder of the freshness window.
        if state == 'failed':
            raise HealthError('canonical_refresh_failed')
        if state not in ('success', 'initial_activation'):
            raise HealthError('canonical_refresh_status_unknown')
        validate_publication_identity(active[0])
        validate_fresh_timestamp(active[0].get('last_refresh_at'), now, 'canonical_refresh')
        result['canonical_refresh'] = active[0]
    else:
        raise HealthError('no_active_canonical_run')
    outputs = {}
    for table in ('player_ros_projections', 'player_projected_stats'):
        rows, n = reader.outputs(table, season, today); validate_count(rows, n, table)
        if n == 0: raise HealthError(table+'_missing')
        value = rows[0].get('updated_at') if isinstance(rows[0], dict) else None
        stamp = validate_fresh_timestamp(value, now, table)
        mismatched, count = reader.mismatched_outputs(table, season, today,
            active[0]['run_id'], active[0]['revision'])
        validate_count(mismatched, count, table+'_revision')
        if count: raise HealthError(table+'_publication_mismatch')
        outputs[table] = {'rows': n, 'oldest_updated_at': stamp.isoformat(), 'publication_matches': True}
    # Independent REST reads can straddle an atomic activation. Never certify
    # a mixed snapshot; the next monitor invocation can retry the stable run.
    if reader.canonical_refresh(season) != active:
        raise HealthError('canonical_publication_changed_during_check')
    return {**result, 'status': 'available_and_fresh', 'outputs': outputs}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-model-capabilities', action='store_true')
    args = parser.parse_args()
    try:
        reader = ProjectionReader(os.getenv('VITE_SUPABASE_URL', ''), os.getenv('SUPABASE_SERVICE_ROLE_KEY', ''))
        now = datetime.now(timezone.utc)
        result = check(reader, now)
        if args.require_model_capabilities and result['remaining_schedule_rows']:
            result['model_capabilities'] = check_model_capabilities(reader, result['target_season'], now.date().isoformat())
            result['defensive_history'] = check_defensive_history(reader, result['target_season']-1)
            if reader.canonical_refresh(result['target_season']) != [result['canonical_refresh']]:
                raise HealthError('canonical_publication_changed_during_check')
            if result['model_capabilities']['status'] != 'present' or result['defensive_history']['status'] != 'coverage_present':
                result['status'] = 'degraded_projection_inputs'
                print(json.dumps(result, sort_keys=True)); return 1
        print(json.dumps(result, sort_keys=True)); return 0
    except HealthError as exc:
        print(json.dumps({'status': 'failed', 'read_only': True, 'reason': str(exc)}, sort_keys=True)); return 1


if __name__ == '__main__':
    sys.exit(main())

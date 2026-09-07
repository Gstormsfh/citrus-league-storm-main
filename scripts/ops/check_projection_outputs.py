"""Read-only availability/freshness check for the SQL-owned projection outputs.

Does not rebuild models, certify accuracy, or assert complete player/game coverage.
Uses standard library only so the scheduled check cannot import a legacy writer.
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


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

    def remaining_games(self, season, today):
        return self.get('nhl_games', {'select': 'game_id', 'season': f'eq.{season}',
            'game_date': f'gte.{today}', 'limit': 1}, counted=True)

    def outputs(self, table, season, today):
        filters = {'select': 'updated_at', 'season': f'eq.{season}', 'order': 'updated_at.asc.nullsfirst', 'limit': 1}
        if table == 'player_projected_stats': filters['projection_date'] = f'gte.{today}'
        elif table == 'player_ros_projections': filters['games_remaining'] = 'gt.0'
        else: raise HealthError('unsupported_output_table')
        return self.get(table, filters, counted=True)


def validate_count(rows, count, label):
    if not isinstance(rows, list) or type(count) is not int or count < 0 or len(rows) != min(count, 1):
        raise HealthError(label+'_invalid_count_response')


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
    outputs = {}
    for table in ('player_ros_projections', 'player_projected_stats'):
        rows, n = reader.outputs(table, season, today); validate_count(rows, n, table)
        if n == 0: raise HealthError(table+'_missing')
        value = rows[0].get('updated_at') if isinstance(rows[0], dict) else None
        try:
            stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except (TypeError, ValueError, AttributeError):
            raise HealthError(table+'_invalid_timestamp') from None
        if stamp.tzinfo is None: raise HealthError(table+'_invalid_timestamp')
        if stamp > now+timedelta(minutes=5): raise HealthError(table+'_future_timestamp')
        if now-stamp > timedelta(hours=36): raise HealthError(table+'_stale')
        outputs[table] = {'rows': n, 'oldest_updated_at': stamp.isoformat()}
    return {**result, 'status': 'available_and_fresh', 'outputs': outputs}


def main():
    try:
        reader = ProjectionReader(os.getenv('VITE_SUPABASE_URL', ''), os.getenv('SUPABASE_SERVICE_ROLE_KEY', ''))
        result = check(reader, datetime.now(timezone.utc))
        print(json.dumps(result, sort_keys=True)); return 0
    except HealthError as exc:
        print(json.dumps({'status': 'failed', 'read_only': True, 'reason': str(exc)}, sort_keys=True)); return 1


if __name__ == '__main__':
    sys.exit(main())

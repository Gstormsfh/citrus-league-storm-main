import io
import unittest
from datetime import datetime, timezone
from check_projection_outputs import ProjectionReader, HealthError, check

NOW = datetime(2026, 9, 7, 10, tzinfo=timezone.utc)


class Fake:
    season = 2026
    schedule = ([{'game_id': 1}], 100)
    data = ([{'updated_at': '2026-09-07T09:05:00+00:00'}], 1000)
    def target_season(self): return self.season
    def remaining_games(self, season, today):
        assert season == self.season and today == '2026-09-07'
        return self.schedule
    def outputs(self, table, season, today): return self.data


class TestProjectionHealth(unittest.TestCase):
    def test_active_upcoming_season_not_calendar_season(self):
        result = check(Fake(), NOW)
        self.assertEqual(result['target_season'], 2026)
        self.assertEqual(result['status'], 'available_and_fresh')
        self.assertFalse(result['accuracy_validated'])

    def test_no_games_is_explicit_not_a_rebuild_success(self):
        f = Fake(); f.schedule = ([], 0)
        self.assertEqual(check(f, NOW)['status'], 'not_required_no_remaining_schedule')

    def test_missing_stale_null_future_and_partial_fail(self):
        cases = [( [], 0), ([{'updated_at': None}], 1),
            ([{'updated_at': '2026-09-05T00:00:00Z'}], 1),
            ([{'updated_at': '2026-09-08T00:00:00Z'}], 1),
            ([{'updated_at': '2026-09-07T09:05:00'}], 1), ([], 100)]
        for data in cases:
            with self.subTest(data=data):
                f = Fake(); f.data = data
                with self.assertRaises(HealthError): check(f, NOW)

    def test_invalid_target_and_missing_schedule_fail(self):
        for season in (None, True, '2026', 2030):
            f = Fake(); f.season = season
            with self.assertRaises(HealthError): check(f, NOW)
        f = Fake(); f.schedule = ([], 12)
        with self.assertRaises(HealthError): check(f, NOW)

    def test_reader_get_only_and_exact_count(self):
        calls = []
        def opener(req, timeout):
            calls.append(req)
            r = io.BytesIO(b'[{"updated_at":"2026-09-07T09:05:00Z"}]')
            r.headers = {'Content-Range': '0-0/123'}
            return r
        reader = ProjectionReader('https://example.supabase.co', 'test', opener)
        self.assertEqual(reader.outputs('player_projected_stats', 2026, '2026-09-07')[1], 123)
        self.assertEqual(calls[0].method, 'GET')
        self.assertIn('updated_at.asc.nullsfirst', calls[0].full_url)
        with self.assertRaises(HealthError): reader.outputs('unknown', 2026, '2026-09-07')

    def test_network_errors_do_not_expose_credentials(self):
        def opener(*args, **kwargs): raise RuntimeError('secret-value')
        reader = ProjectionReader('https://example.supabase.co', 'secret-value', opener)
        with self.assertRaisesRegex(HealthError, '^projection_read_failed$'): reader.target_season()

    def test_count_header_required(self):
        def opener(*args, **kwargs):
            r = io.BytesIO(b'[]'); r.headers = {}; return r
        with self.assertRaisesRegex(HealthError, 'missing_exact_count'):
            ProjectionReader('https://example.supabase.co', 'test', opener).remaining_games(2026, '2026-09-07')


if __name__ == '__main__': unittest.main()

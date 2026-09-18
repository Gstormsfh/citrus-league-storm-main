import io
import unittest
from urllib.parse import parse_qs, urlsplit
from datetime import datetime, timezone
from check_projection_outputs import ProjectionReader, HealthError, check, check_model_capabilities, check_defensive_history

NOW = datetime(2026, 9, 7, 10, tzinfo=timezone.utc)
ACTIVE = {'run_id': '12345678-1234-1234-1234-123456789012', 'revision': 'a'*64,
          'last_refresh_status': 'success', 'last_refresh_at': '2026-09-07T09:05:00Z',
          'activated_at': '2026-09-07T09:05:00Z'}


class Fake:
    season = 2026
    schedule = ([{'game_id': 1}], 100)
    data = ([{'updated_at': '2026-09-07T09:05:00+00:00'}], 1000)
    def target_season(self): return self.season
    def remaining_games(self, season, today):
        assert season == self.season and today == '2026-09-07'
        return self.schedule
    def outputs(self, table, season, today): return self.data
    def canonical_refresh(self, season): return [dict(ACTIVE)]
    def mismatched_outputs(self, table, season, today, run_id, revision):
        assert run_id == ACTIVE['run_id'] and revision == ACTIVE['revision']
        return [], 0


class TestProjectionHealth(unittest.TestCase):
    def test_failed_refresh_cannot_hide_behind_fresh_materialized_rows(self):
        class Failed(Fake):
            def canonical_refresh(self, season):
                return [{'last_refresh_status': 'failed'}]
        with self.assertRaisesRegex(HealthError, '^canonical_refresh_failed$'):
            check(Failed(), NOW)

    def test_unknown_or_duplicate_active_state_fails_closed(self):
        for response in ([{'last_refresh_status': None}], [{}, {}], None):
            f = Fake()
            f.canonical_refresh = lambda season: response
            with self.assertRaises(HealthError): check(f, NOW)

    def test_success_and_initial_activation_are_explicit(self):
        for state in ('success', 'initial_activation'):
            f = Fake()
            f.canonical_refresh = lambda season: [{**ACTIVE, 'last_refresh_status': state}]
            self.assertEqual(check(f, NOW)['canonical_refresh']['last_refresh_status'], state)

    def test_fresh_rows_without_active_publication_are_not_healthy(self):
        f = Fake(); f.canonical_refresh = lambda season: []
        with self.assertRaisesRegex(HealthError, '^no_active_canonical_run$'): check(f, NOW)

    def test_stale_refresh_is_not_hidden_by_rewritten_output_timestamps(self):
        f = Fake()
        f.canonical_refresh = lambda season: [{**ACTIVE, 'last_refresh_at': '2026-09-05T00:00:00Z'}]
        with self.assertRaisesRegex(HealthError, '^canonical_refresh_stale$'): check(f, NOW)

    def test_invalid_active_identity_fails_closed(self):
        for changes in ({'run_id': None}, {'run_id': 'invalid'}, {'revision': None}, {'revision': 'not-a-hash'}):
            with self.subTest(changes=changes):
                f = Fake(); f.canonical_refresh = lambda season: [{**ACTIVE, **changes}]
                with self.assertRaisesRegex(HealthError, '^canonical_publication_identity_invalid$'): check(f, NOW)

    def test_fresh_rows_from_wrong_or_missing_revision_fail(self):
        for table in ('player_ros_projections', 'player_projected_stats'):
            with self.subTest(table=table):
                f = Fake()
                f.mismatched_outputs = lambda t, *args: ([{'player_id': 1}], 1) if t == table else ([], 0)
                with self.assertRaisesRegex(HealthError, '^'+table+'_publication_mismatch$'): check(f, NOW)

    def test_incomplete_revision_count_cannot_pass(self):
        f = Fake(); f.mismatched_outputs = lambda *args: ([], 1)
        with self.assertRaisesRegex(HealthError, 'revision_invalid_count_response$'): check(f, NOW)

    def test_publication_switch_or_refresh_failure_during_check_fails_closed(self):
        for changes in ({'revision': 'b'*64}, {'last_refresh_status': 'failed'},
                        {'last_refresh_at': '2026-09-07T10:00:00Z'}):
            with self.subTest(changes=changes):
                f = Fake(); responses = iter([[dict(ACTIVE)], [{**ACTIVE, **changes}]])
                f.canonical_refresh = lambda season: next(responses)
                with self.assertRaisesRegex(HealthError, '^canonical_publication_changed_during_check$'): check(f, NOW)

    def test_defensive_cache_requires_complete_actual_game_coverage(self):
        class HistoryFake:
            cached_games = 1
            def defensive_history(self, season):
                return ([dict(team_abbrev=t,games_played=self.cached_games,goals_against_avg=2.5,
                              shots_against_avg=28,save_pct=.91) for t in ['A','B']],
                        [dict(game_id=i,home_team='A',away_team='B') for i in [1,2]])
        reader = HistoryFake()
        result = check_defensive_history(reader, 2025)
        self.assertEqual(result['status'], 'degraded')
        self.assertEqual(result['coverage_mismatch'], ['A','B'])
        reader.cached_games = 2
        self.assertEqual(check_defensive_history(reader, 2025)['status'], 'coverage_present')

    def test_empty_defensive_history_is_not_healthy(self):
        class HistoryFake:
            def defensive_history(self, season): return [], []
        self.assertEqual(check_defensive_history(HistoryFake(), 2025)['status'], 'degraded')

    def test_impossible_defensive_statistics_are_not_healthy(self):
        class HistoryFake:
            value = .91
            field = 'save_pct'
            def defensive_history(self, season):
                rows = [dict(team_abbrev=t,games_played=1,goals_against_avg=2.5,
                             shots_against_avg=28,save_pct=.91) for t in ('A','B')]
                rows[0][self.field] = self.value
                return rows, [dict(game_id=1,home_team='A',away_team='B')]
        reader = HistoryFake()
        for field, value in [('save_pct',1.2),('save_pct',True),('save_pct','NaN'),
                             ('goals_against_avg',-1),('shots_against_avg','Infinity'),
                             ('goals_against_avg',{}),('save_pct','unavailable')]:
            with self.subTest(field=field,value=value):
                reader.field, reader.value = field, value
                report = check_defensive_history(reader,2025)
                self.assertEqual(report['status'],'degraded')
                self.assertEqual(report['invalid_fields'],[dict(team='A',field=field)])
        reader.field, reader.value = 'save_pct', '.91'
        self.assertEqual(check_defensive_history(reader,2025)['status'],'coverage_present')

    def test_fresh_flat_outputs_fail_model_capability_check(self):
        class ModelFake:
            def model_capability(self, season, today, kind):
                count = {'total': 84, 'flat': 84, 'opponent': 0, 'simulation': 0}[kind]
                return ([{'player_id': 8484166}] if count else [], count)
        result = check_model_capabilities(ModelFake(), 2026, '2026-09-16')
        self.assertEqual(result['status'], 'degraded')
        self.assertIn('flat_season_allocations_serving', result['failures'])
        self.assertIn('monte_carlo_output_incomplete', result['failures'])

    def test_model_presence_does_not_claim_calibration_or_line_matchups(self):
        class ModelFake:
            def model_capability(self, season, today, kind):
                return ([], 0) if kind == 'flat' else ([{'player_id': 1}], 84)
        result = check_model_capabilities(ModelFake(), 2026, '2026-09-16')
        self.assertEqual(result['status'], 'present')
        self.assertFalse(result['accuracy_validated'])
        self.assertFalse(result['line_matchups_validated'])
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

    def test_revision_queries_include_nulls_and_same_horizon(self):
        calls = []
        def opener(req, timeout):
            calls.append(req)
            r = io.BytesIO(b'[]'); r.headers = {'Content-Range': '*/0'}; return r
        reader = ProjectionReader('https://example.supabase.co', 'test', opener)
        for table in ('player_ros_projections', 'player_projected_stats'):
            reader.mismatched_outputs(table, 2026, '2026-09-07', ACTIVE['run_id'], ACTIVE['revision'])
            params = parse_qs(urlsplit(calls[-1].full_url).query)
            self.assertEqual(calls[-1].method, 'GET')
            self.assertEqual(params['season'], ['eq.2026'])
            self.assertEqual(params['limit'], ['1'])
            clauses = params['or'][0]
            self.assertIn('projection_run_id.is.null', clauses)
            self.assertIn('projection_revision.is.null', clauses)
            self.assertIn('projection_run_id.neq.'+ACTIVE['run_id'], clauses)
            self.assertIn('projection_revision.neq.'+ACTIVE['revision'], clauses)
            self.assertEqual(params['projection_date' if table == 'player_projected_stats' else 'games_remaining'],
                             ['gte.2026-09-07' if table == 'player_projected_stats' else 'gt.0'])
        reader.remaining_games(2026, '2026-09-07')
        self.assertEqual(parse_qs(urlsplit(calls[-1].full_url).query)['game_type'], ['eq.regular'])
        reader.canonical_refresh(2026)
        self.assertTrue(urlsplit(calls[-1].full_url).path.endswith('/canonical_published_runs'))
        reader.model_capability(2026, '2026-09-07', 'simulation')
        params = parse_qs(urlsplit(calls[-1].full_url).query)
        self.assertEqual(params['calculation_method'], ['eq.canonical_contextual_v1'])
        self.assertEqual(params['projection_std_dev'], ['gte.0'])
        self.assertEqual(params['projection_ci_50_lower'], ['not.is.null'])
        self.assertEqual(params['projection_ci_50_upper'], ['not.is.null'])

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

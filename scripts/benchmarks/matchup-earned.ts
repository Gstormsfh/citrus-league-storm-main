import { performance } from 'node:perf_hooks';
import { aggregateEarnedStats, elapsedStatDates } from '../../apps/web/src/utils/matchupEarnedStats';
const rows = Array.from({ length: 40 }, (_, i) => ({ player_id: i + 1, goals: i % 3, assists: i % 2, shots_on_goal: 4 }));
const settings = { skater: { goals: 6, assists: 4, shots_on_goal: .9 } };
const dates = Array.from({ length: 7 }, (_, i) => `2026-10-${String(i + 5).padStart(2, '0')}`);
for (let i = 0; i < 100; i++) aggregateEarnedStats(rows, settings);
const start = performance.now();
for (let i = 0; i < 1000; i++) aggregateEarnedStats(rows, settings);
const total = performance.now() - start;
const result = { kind: 'local controlled request graph and CPU fixture; not live browser latency',
  players: rows.length, iterations: 1000, aggregation_total_ms: total, aggregation_ms_per_40_players: total / 1000,
  weekday_fixture: 'Wednesday 2026-10-07', previous_actual_requests_per_initial_load: dates.length + 1,
  revised_actual_requests_per_initial_load: elapsedStatDates(dates, '2026-10-07').length,
  previous_future_week_actual_requests: 8, revised_future_week_actual_requests: elapsedStatDates(dates, '2026-10-01').length,
  previous_finished_week_actual_requests: 8, revised_finished_week_actual_requests: elapsedStatDates(dates, '2026-10-12').length,
  configured_visible_poll_ms: 120000, network_latency_measured: false };
console.log(JSON.stringify(result, null, 2));

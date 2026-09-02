/**
 * Micro-benchmarks for the pure hot-path functions and the fat payloads,
 * written for the 2026-09-02 scale audit
 * (docs/PERFORMANCE_AND_SCALE_2026-09-02.md).
 *
 * These measure CPU and bytes ONLY — no database, no network, no
 * production target. They answer "is the JavaScript on this path a
 * bottleneck at our traffic?" and nothing else. Every DB-side and
 * end-to-end number belongs to the k6 suite under `scripts/load-test/`
 * and to `docs/apple/LOAD_TEST_RESULTS.md`.
 *
 * Run:
 *   cd server && npx tsx scripts/bench-hot-paths.ts
 *
 * Output is a table of ops/sec and per-op microseconds. Numbers vary with
 * the machine — always record the CPU alongside them.
 */
import { gzipSync } from 'node:zlib';
import { ScoringCalculator, DEFAULT_SCORING } from '@citrus/shared';

// ── harness ──────────────────────────────────────────────────────────

interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  opsPerSec: number;
  usPerOp: number;
  note?: string;
}

const results: BenchResult[] = [];

function bench(name: string, iterations: number, fn: () => void, note?: string): void {
  // Warm the JIT so we time steady-state, not the interpreter.
  const warmup = Math.min(iterations, 1000);
  for (let i = 0; i < warmup; i++) fn();

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;

  results.push({
    name,
    iterations,
    totalMs,
    opsPerSec: iterations / (totalMs / 1000),
    usPerOp: (totalMs * 1000) / iterations,
    note,
  });
}

// ── fixtures at realistic sizes ──────────────────────────────────────

/** One skater's stat line, the shape ScoringCalculator actually receives. */
function skaterStats(seed: number): Record<string, number> {
  return {
    goals: seed % 45,
    assists: (seed * 3) % 70,
    ppp: seed % 20,
    shp: seed % 4,
    sog: (seed * 7) % 300,
    blocks: (seed * 2) % 160,
    hits: (seed * 5) % 240,
    pim: seed % 90,
    plus_minus: (seed % 60) - 30,
  };
}

function goalieStats(seed: number): Record<string, number> {
  return {
    wins: seed % 40,
    saves: (seed * 23) % 1800,
    shutouts: seed % 8,
    goals_against: (seed * 3) % 160,
  };
}

/**
 * `DashboardIndexEntry`, field for field, at realistic magnitudes. The
 * point of building it by hand is that the serialized size is then a
 * MEASUREMENT of the wire payload rather than an estimate from the type.
 */
function dashboardIndexEntry(i: number) {
  const isGoalie = i % 12 === 0;
  return {
    id: 8470000 + i,
    name: `Firstname Lastname-${i}`,
    team: ['TOR', 'EDM', 'COL', 'TBL', 'BOS', 'VGK'][i % 6],
    position: isGoalie ? 'G' : ['C', 'LW', 'RW', 'D'][i % 4],
    jersey: (i % 98) + 1,
    headshot_url: `https://assets.nhle.com/mugs/nhl/20252026/TOR/${8470000 + i}.png`,
    is_goalie: isGoalie,
    roster_status: i % 9 === 0 ? 'IR' : 'active',
    gp: i % 82,
    goals: i % 45,
    assists: (i * 3) % 70,
    points: (i % 45) + ((i * 3) % 70),
    sog: (i * 7) % 300,
    hits: (i * 5) % 240,
    blocks: (i * 2) % 160,
    ppp: i % 20,
    plus_minus: (i % 60) - 30,
    x_goals: Number((((i * 13) % 400) / 10).toFixed(4)),
    wins: isGoalie ? i % 40 : 0,
    saves: isGoalie ? (i * 23) % 1800 : 0,
    save_pct: isGoalie ? Number((0.88 + (i % 60) / 1000).toFixed(5)) : 0,
    gaa: isGoalie ? Number((2 + (i % 150) / 100).toFixed(5)) : 0,
    shutouts: isGoalie ? i % 8 : 0,
    xg_per_60: Number((((i * 7) % 300) / 100).toFixed(4)),
    xg_rating: ['elite', 'above average', 'average', 'below average'][i % 4],
    gar_per_60: Number((((i * 11) % 400) / 100 - 1).toFixed(4)),
    gar_evo: Number((((i * 3) % 300) / 100 - 1).toFixed(4)),
    gar_evd: Number((((i * 5) % 300) / 100 - 1).toFixed(4)),
    gar_ppo: Number((((i * 7) % 300) / 100 - 1).toFixed(4)),
    gar_ppd: Number((((i * 9) % 300) / 100 - 1).toFixed(4)),
    gar_pen: Number((((i * 13) % 200) / 100 - 1).toFixed(4)),
    proj_gp: 82 - (i % 82),
    proj_fantasy_points: Number((((i * 17) % 4000) / 10).toFixed(3)),
    proj_fantasy_ppg: Number((((i * 19) % 90) / 10).toFixed(4)),
    proj_goals: Number((((i * 23) % 450) / 10).toFixed(3)),
    proj_assists: Number((((i * 29) % 700) / 10).toFixed(3)),
    proj_sog: Number((((i * 31) % 3000) / 10).toFixed(3)),
    proj_ppp: Number((((i * 37) % 200) / 10).toFixed(3)),
    proj_wins: isGoalie ? Number((((i * 41) % 400) / 10).toFixed(3)) : null,
    proj_saves: isGoalie ? Number((((i * 43) % 18000) / 10).toFixed(3)) : null,
    proj_shutouts: isGoalie ? Number((((i * 47) % 80) / 10).toFixed(3)) : null,
  };
}

/** The ETag hash `cacheControlMiddleware` runs over every cacheable body. */
function generateETag(body: string): string {
  let hash = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `"${Math.abs(hash).toString(36)}"`;
}

// ── 1. Scoring ───────────────────────────────────────────────────────
// `ScoringCalculator.calculatePoints` is the single source of truth for
// fantasy points and runs once per player per day per surface.

const scorer = new ScoringCalculator(DEFAULT_SCORING);
const SKATERS = Array.from({ length: 1000 }, (_, i) => skaterStats(i));
const GOALIES = Array.from({ length: 1000 }, (_, i) => goalieStats(i));

let sink = 0;
bench('ScoringCalculator.calculatePoints — one skater', 2_000_000, () => {
  sink += scorer.calculatePoints(SKATERS[sink & 1023 % 1000], false);
});
bench('ScoringCalculator.calculatePoints — one goalie', 2_000_000, () => {
  sink += scorer.calculatePoints(GOALIES[sink & 1023 % 1000], true);
});

// A whole league's week: 12 teams x 20 rostered players x 7 days.
const LEAGUE_WEEK_LINES = 12 * 20 * 7;
bench(
  `ScoringCalculator.calculatePoints — one league-week (${LEAGUE_WEEK_LINES} lines)`,
  20_000,
  () => {
    for (let i = 0; i < LEAGUE_WEEK_LINES; i++) {
      sink += scorer.calculatePoints(SKATERS[i % 1000], false);
    }
  },
  '12 teams x 20 players x 7 days',
);

// ── 2. The dashboard-index payload ───────────────────────────────────
// `GET /api/players/dashboard-index` serialises the whole browse index on
// every uncached page load. Measure the bytes, not a guess at them.

const DIRECTORY_SIZES = [1000, 1900];
for (const n of DIRECTORY_SIZES) {
  const rows = Array.from({ length: n }, (_, i) => dashboardIndexEntry(i));
  const json = JSON.stringify(rows);
  const gz = gzipSync(Buffer.from(json), { level: 6 });
  const raw = Buffer.byteLength(json);

  results.push({
    name: `dashboard-index payload — ${n} players`,
    iterations: 1,
    totalMs: 0,
    opsPerSec: 0,
    usPerOp: 0,
    note:
      `raw ${(raw / 1024).toFixed(1)} KiB, gzip ${(gz.length / 1024).toFixed(1)} KiB, ` +
      `${(raw / n).toFixed(0)} B/row raw`,
  });

  bench(`JSON.stringify dashboard-index — ${n} players`, 300, () => {
    sink += JSON.stringify(rows).length;
  });
  bench(`gzip dashboard-index — ${n} players`, 100, () => {
    sink += gzipSync(Buffer.from(json), { level: 6 }).length;
  });
  bench(`generateETag over dashboard-index — ${n} players`, 300, () => {
    sink += generateETag(json).length;
  });
}

// ── 3. The ETag hash on a mid-sized cacheable body ───────────────────
// `cacheControlMiddleware` clones the response body to a string and walks
// it character by character for every GET matching a cache rule
// (`/matchups`, `/roster`, `/standings`, `/projections`, ...).

for (const kb of [10, 100, 500]) {
  const body = JSON.stringify(
    Array.from({ length: Math.max(1, Math.round((kb * 1024) / 220)) }, (_, i) =>
      dashboardIndexEntry(i),
    ),
  );
  const actualKb = Buffer.byteLength(body) / 1024;
  bench(
    `generateETag — ${actualKb.toFixed(0)} KiB body`,
    2000,
    () => {
      sink += generateETag(body).length;
    },
    'runs per cacheable GET, after the body is already built',
  );
}

// ── report ───────────────────────────────────────────────────────────

if (sink === Number.MIN_SAFE_INTEGER) process.exit(1); // keep `sink` live

const nameWidth = Math.max(...results.map((r) => r.name.length));
const line = '─'.repeat(nameWidth + 46);

process.stdout.write(`\nCitrus hot-path micro-benchmarks\n`);
process.stdout.write(`node ${process.version}  ${process.platform}/${process.arch}\n`);
process.stdout.write(`${line}\n`);
process.stdout.write(
  `${'benchmark'.padEnd(nameWidth)}  ${'ops/sec'.padStart(14)}  ${'us/op'.padStart(12)}\n`,
);
process.stdout.write(`${line}\n`);
for (const r of results) {
  if (r.iterations === 1 && r.totalMs === 0) {
    process.stdout.write(`${r.name.padEnd(nameWidth)}  ${(r.note ?? '').padStart(28)}\n`);
    continue;
  }
  const ops = r.opsPerSec >= 1000 ? Math.round(r.opsPerSec).toLocaleString('en-US') : r.opsPerSec.toFixed(1);
  process.stdout.write(
    `${r.name.padEnd(nameWidth)}  ${ops.padStart(14)}  ${r.usPerOp.toFixed(3).padStart(12)}` +
      (r.note ? `   (${r.note})` : '') +
      '\n',
  );
}
process.stdout.write(`${line}\n\n`);

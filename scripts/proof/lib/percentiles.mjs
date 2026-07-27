// scripts/proof/lib/percentiles.mjs
//
// Percentile aggregation for the draft harness (chunk 11g.10 sub-step
// 10c-2). Pure functions — no I/O, no side effects, deterministic
// under identical inputs.
//
// Methodology laws honored (per 10c-2 spec):
//   - Percentiles only: p50/p90/p95/p99/max + N. No means, no
//     single-shot quotes.
//   - Minimum 200 samples per scenario before quoting. `formatTable`
//     surfaces a WARN row when N < 200 rather than silently emitting
//     numbers that are noise.
//   - Every output labeled `MANDATE-CANDIDATE` in the header until
//     Garrett ratifies the methodology against the first results.
//   - Drop rate and per-client seq ordering violations are first-
//     class metrics — always reported, target 0.
//   - Cold/warm tagging is a `group` field on each sample; the
//     aggregation splits per group.

const REQUIRED_MIN_SAMPLES = 200;

/**
 * Linear-interpolation percentile on a pre-sorted numeric array.
 * `p` in [0, 100]. `sorted` must be ascending and non-empty.
 * Returns null for empty input (callers must check N > 0 first).
 *
 * Uses the standard type-7 (Excel / numpy default) formula:
 *   pos = (p/100) * (N - 1)
 *   floor = ⌊pos⌋, frac = pos - floor
 *   value = sorted[floor] + frac * (sorted[floor+1] - sorted[floor])
 */
export function percentile(p, sorted) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const pos = (p / 100) * (sorted.length - 1);
  const floor = Math.floor(pos);
  const frac = pos - floor;
  if (floor + 1 >= sorted.length) return sorted[floor];
  return sorted[floor] + frac * (sorted[floor + 1] - sorted[floor]);
}

/**
 * Compute the standard percentile bundle for a sample array.
 * Returns { N, p50, p90, p95, p99, max } or nulls for empty input.
 * Does NOT mutate `samples`.
 */
export function bundle(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { N: 0, p50: null, p90: null, p95: null, p99: null, max: null };
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  return {
    N: sorted.length,
    p50: percentile(50, sorted),
    p90: percentile(90, sorted),
    p95: percentile(95, sorted),
    p99: percentile(99, sorted),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Format a percentile bundle as a fixed-width row for terminal output.
 * `label` is left-padded to `labelWidth`; numeric values right-padded
 * to `numWidth`. Nulls render as `--`. Small N gets an inline `⚠<N`
 * annotation.
 */
export function formatRow(label, b, opts = {}) {
  const labelWidth = opts.labelWidth ?? 28;
  const numWidth = opts.numWidth ?? 9;
  const fmt = (v) => {
    if (v === null || v === undefined) return '--'.padStart(numWidth);
    if (Number.isFinite(v)) {
      // 1 decimal place for latencies (ms); integer for counts.
      const s = v >= 100 ? v.toFixed(0) : v.toFixed(1);
      return s.padStart(numWidth);
    }
    return String(v).padStart(numWidth);
  };
  const warn = b.N > 0 && b.N < REQUIRED_MIN_SAMPLES ? ` ⚠<${REQUIRED_MIN_SAMPLES}` : '';
  return `${String(label).padEnd(labelWidth)}${fmt(b.N)}${fmt(b.p50)}${fmt(b.p90)}${fmt(b.p95)}${fmt(b.p99)}${fmt(b.max)}${warn}`;
}

export function formatHeader(title, opts = {}) {
  const labelWidth = opts.labelWidth ?? 28;
  const numWidth = opts.numWidth ?? 9;
  const cols = ['N', 'p50', 'p90', 'p95', 'p99', 'max']
    .map((c) => c.padStart(numWidth))
    .join('');
  return [
    '',
    `── ${title} ──`,
    `${'metric'.padEnd(labelWidth)}${cols}`,
    `${'─'.repeat(labelWidth + numWidth * 6)}`,
  ].join('\n');
}

/**
 * Build the full result table set for a harness run.
 *
 * `samples` array element shape:
 *   {
 *     scenario:          string,      // S1 | S2 | S3 | S4
 *     bootstrapClass:    'cold'|'warm', // cold = first pick post-lobby-construction
 *     clientLabel:       string,
 *     seq:               number,
 *     submitCallTs:      number,      // ms, single clock
 *     receiveTs:         number|null, // ms, single clock; null = drop
 *     rpcMs:             number,      // pg client RPC round-trip
 *     endToEndMs:        number|null, // receiveTs - submitCallTs (single clock); null on drop
 *     engineApplyMs:     number|null, // from external_event.applied (cross-clock; separate table)
 *     engineBroadcastMs: number|null, // from external_event.applied
 *     engineNotifyToBroadcastMs: number|null,
 *     seqOrderingViolation: boolean,  // true if this client received this seq out of expected order
 *   }
 *
 * Returns a printable string; the caller writes it wherever it wants.
 */
export function formatSummary(samples, opts = {}) {
  const scenario = opts.scenario ?? '(unspecified)';
  const clientCount = opts.clientCount ?? '?';
  const paced = opts.paced ?? '(unspecified)';
  const runId = opts.runId ?? new Date().toISOString();

  const dropped = samples.filter((s) => s.receiveTs === null);
  const delivered = samples.filter((s) => s.receiveTs !== null);
  const orderingViolations = samples.filter((s) => s.seqOrderingViolation === true);

  const endToEnd = delivered.map((s) => s.endToEndMs).filter((v) => v !== null);
  const rpc = samples.map((s) => s.rpcMs).filter((v) => Number.isFinite(v));
  const engineApply = delivered.map((s) => s.engineApplyMs).filter((v) => v !== null);
  const engineBroadcast = delivered.map((s) => s.engineBroadcastMs).filter((v) => v !== null);
  const engineNotifyToBroadcast = delivered.map((s) => s.engineNotifyToBroadcastMs).filter((v) => v !== null);

  // Cold vs warm split (single-clock end-to-end).
  const coldE2E = delivered.filter((s) => s.bootstrapClass === 'cold').map((s) => s.endToEndMs);
  const warmE2E = delivered.filter((s) => s.bootstrapClass === 'warm').map((s) => s.endToEndMs);

  // Per-client end-to-end.
  const clients = new Map();
  for (const s of delivered) {
    if (!clients.has(s.clientLabel)) clients.set(s.clientLabel, []);
    clients.get(s.clientLabel).push(s.endToEndMs);
  }

  const lines = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════════════');
  lines.push('  MANDATE-CANDIDATE — draft harness results (10c-2)');
  lines.push('  These numbers are unratified until Garrett confirms the methodology');
  lines.push('  against them. Percentiles are single-clock (client host) unless noted.');
  lines.push('═══════════════════════════════════════════════════════════════════════════');
  lines.push(`  scenario:      ${scenario}`);
  lines.push(`  client count:  ${clientCount}`);
  lines.push(`  pacing:        ${paced}`);
  lines.push(`  run id:        ${runId}`);
  lines.push(`  samples total: ${samples.length}   delivered: ${delivered.length}   dropped: ${dropped.length}   ordering-violations: ${orderingViolations.length}`);
  if (samples.length < REQUIRED_MIN_SAMPLES) {
    lines.push(`  ⚠ SAMPLE COUNT BELOW METHODOLOGY MINIMUM (${REQUIRED_MIN_SAMPLES}) — numbers are informational only`);
  }
  lines.push('');
  lines.push('── FIRST-CLASS FAILURE METRICS (target 0) ──');
  const dropRate = samples.length === 0 ? 0 : (dropped.length / samples.length) * 100;
  lines.push(`  drop rate:                ${dropRate.toFixed(2)}%   (${dropped.length}/${samples.length})`);
  lines.push(`  seq ordering violations:  ${orderingViolations.length}`);

  // Primary table: single-clock end-to-end (submit_call → client receive).
  lines.push(formatHeader('PRIMARY — end-to-end ms (single-clock, client host)'));
  lines.push(formatRow('overall', bundle(endToEnd)));
  lines.push(formatRow('  cold-bootstrap sample', bundle(coldE2E)));
  lines.push(formatRow('  warm', bundle(warmE2E)));

  // Per-client table.
  lines.push(formatHeader('PER-CLIENT — end-to-end ms (single-clock)'));
  const clientLabels = [...clients.keys()].sort();
  for (const label of clientLabels) {
    lines.push(formatRow(label, bundle(clients.get(label))));
  }

  // Engine-internal splits (cross-clock — DO NOT COMPARE to primary).
  lines.push(formatHeader('ENGINE-INTERNAL SPLITS — ms (from external_event.applied; cross-clock, informational)'));
  lines.push(formatRow('applyMs', bundle(engineApply)));
  lines.push(formatRow('broadcastMs', bundle(engineBroadcast)));
  lines.push(formatRow('notifyToBroadcastMs', bundle(engineNotifyToBroadcast)));

  // Supporting: RPC latency.
  lines.push(formatHeader('RPC — pg submit_pick_v2 round-trip ms (single-clock)'));
  lines.push(formatRow('rpc_ms', bundle(rpc)));

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════════════');
  return lines.join('\n');
}

export { REQUIRED_MIN_SAMPLES };

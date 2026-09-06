/** Offline-only shape-calibration inference. No serving barrel export or I/O. */
const settings = { epsilon: 1e-6, knots: [1e-6, .005, .01, .025, .05, .1, .2, .35, .5, .75, .95, 1 - 1e-6],
  reference_probability: .1, slope_identity_ridge: 100, adjacent_slope_ridge: 100, group_ridge: 100,
  maxiter: 3000, ftol: 1e-12, gtol: 1e-8, max_rows: 1000000, max_cells: 32000000,
  max_plateaus: 4096, optimizer: 'L-BFGS-B', threads: 1,
  smoothing: 'isotonic_plateau_endpoint_midpoint_then_pchip', tail_policy: 'clip_input_to_representative_support',
  output_policy: 'clip_all_new_candidates_to_epsilon', unknown_group_policy: 'zero_offset_explicit_context_status' };
const kinds = ['isotonic_clipped', 'smooth_isotonic_clipped', 'monotone_logit', 'monotone_logit_group'];
const fields = ['shot_type', 'prior_sog_same_team', 'strength'];
function check(ok: unknown): asserts ok { if (!ok) throw new Error('Invalid bounded shape calibration contract or input'); }
function object(value: unknown): Record<string, unknown> { check(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
function keys(value: Record<string, unknown>, expected: string[]) { check(Object.keys(value).length === expected.length && expected.every(k => Object.prototype.hasOwnProperty.call(value, k))); }
function finite(value: unknown): number { check(typeof value === 'number' && Number.isFinite(value)); return value; }
function list(value: unknown, maximum: number): number[] { check(Array.isArray(value) && value.length <= maximum); return value.map(finite); }
function category(value: unknown): string | null { check(value === null || (typeof value === 'string' && value.trim().length > 0 && value.length <= 128)); return value as string | null; }
const clip = (p: number, low = 1e-6, high = 1 - 1e-6) => Math.max(low, Math.min(high, p));
const logit = (p: number) => Math.log(p) - Math.log1p(-p);
function sigmoid(z: number) { finite(z); return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); }

// Independently reconstruct the defined PCHIP coefficients for contract validation.
// Formula checked against SciPy 1.13.1's versioned PCHIP/Hermite implementation.
function pchip(x: number[], y: number[]): number[][] {
  if (x.length === 1) return [];
  const h = x.slice(1).map((v, i) => v - x[i]), m = y.slice(1).map((v, i) => (v - y[i]) / h[i]);
  const d = new Array(x.length).fill(0) as number[];
  function edge(h0: number, h1: number, m0: number, m1: number) {
    const candidate = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1);
    if (Math.sign(candidate) !== Math.sign(m0)) return 0;
    return Math.sign(m0) !== Math.sign(m1) && Math.abs(candidate) > 3 * Math.abs(m0) ? 3 * m0 : candidate;
  }
  if (x.length === 2) { d[0] = m[0]; d[1] = m[0]; }
  else {
    for (let i = 1; i < x.length - 1; i++) if (m[i - 1] !== 0 && m[i] !== 0 && Math.sign(m[i - 1]) === Math.sign(m[i])) {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      d[i] = 1 / ((w1 / m[i - 1] + w2 / m[i]) / (w1 + w2));
    }
    d[0] = edge(h[0], h[1], m[0], m[1]);
    d[d.length - 1] = edge(h[h.length - 1], h[h.length - 2], m[m.length - 1], m[m.length - 2]);
  }
  return h.map((width, i) => { const t = (d[i] + d[i + 1] - 2 * m[i]) / width;
    return [t / width, (m[i] - d[i]) / width - t, d[i], y[i]]; });
}

export function compileCalibrationShape(input: unknown) {
  const model = object(input), kind = model.kind; check(typeof kind === 'string' && kinds.includes(kind));
  check(model.contract === 'citrus-calibration-shape-v1' && model.publishable === false);
  const declared = object(model.settings); keys(declared, Object.keys(settings));
  check(Object.entries(settings).every(([k, v]) => JSON.stringify(declared[k]) === JSON.stringify(v)));
  let map: (p: number, context?: unknown) => number;
  if (kind === 'isotonic_clipped' || kind === 'smooth_isotonic_clipped') {
    keys(model, ['contract', 'kind', 'settings', 'publishable', 'x', 'y', ...(kind === 'smooth_isotonic_clipped' ? ['coefficients'] : [])]);
    const maximum = kind === 'isotonic_clipped' ? 1000000 : 4096, x = list(model.x, maximum), y = list(model.y, maximum);
    check(x.length > 0 && x.length === y.length && x.every((v, i) => v >= 0 && v <= 1 && (!i || v > x[i - 1]))
      && y.every((v, i) => v >= 0 && v <= 1 && (!i || v >= y[i - 1])));
    let coefficients: number[][] = [];
    if (kind === 'smooth_isotonic_clipped') {
      check(Array.isArray(model.coefficients) && model.coefficients.length === x.length - 1);
      coefficients = model.coefficients.map(c => { const a = list(c, 4); check(a.length === 4); return a; });
      const expected = pchip(x, y);
      check(coefficients.every((c, i) => c.every((v, j) => Number.isFinite(expected[i][j])
        && Math.abs(v - expected[i][j]) <= 1e-12 * Math.max(1, Math.abs(expected[i][j])))));
    }
    map = (p: number) => {
      if (x.length === 1 || p <= x[0]) return y[0]; if (p >= x[x.length - 1]) return y[y.length - 1];
      let low = 0, high = x.length - 1;
      while (high - low > 1) { const middle = Math.floor((high + low) / 2); if (p < x[middle]) high = middle; else low = middle; }
      const dx = p - x[low];
      if (kind === 'isotonic_clipped') return y[low] + dx * (y[high] - y[low]) / (x[high] - x[low]);
      const c = coefficients[low]; return ((c[0] * dx + c[1]) * dx + c[2]) * dx + c[3];
    };
  } else {
    keys(model, ['contract', 'kind', 'settings', 'publishable', 'slopes', 'intercept', 'vocabulary', 'offsets', 'optimization']);
    const slopes = list(model.slopes, 11), intercept = finite(model.intercept); check(slopes.length === 11 && slopes.every(s => s >= 0));
    const optimization = object(model.optimization); keys(optimization, ['converged', 'iterations', 'objective']);
    check(optimization.converged === true && Number.isInteger(optimization.iterations));
    check(finite(optimization.iterations) >= 0 && finite(optimization.iterations) <= 3000); finite(optimization.objective);
    const vocabulary = object(model.vocabulary); keys(vocabulary, kind.endsWith('_group') ? fields : []);
    const offsets = list(model.offsets, 192), lookup: Map<string | null, number>[] = []; let start = 0;
    if (kind.endsWith('_group')) for (const name of fields) {
      const raw = vocabulary[name]; check(Array.isArray(raw) && raw.length > 0 && raw.length <= 64);
      const values = raw.map(category); check(new Set(values).size === values.length && values.every((v, i) => !i
        || (values[i - 1] === null && v !== null) || (v !== null && values[i - 1] !== null && values[i - 1] < v)));
      lookup.push(new Map(values.map((v, i) => [v, offsets[start + i]]))); start += values.length;
    }
    check(start === offsets.length);
    const knots = settings.knots.map(logit), center = logit(.1);
    map = (p: number, context?: unknown) => {
      const value = logit(clip(p)); let z = intercept;
      for (let i = 0; i < slopes.length; i++) z += slopes[i] * (clip(value - knots[i], 0, knots[i + 1] - knots[i]) - clip(center - knots[i], 0, knots[i + 1] - knots[i]));
      if (kind.endsWith('_group')) { const ctx = object(context); keys(ctx, fields);
        fields.forEach((name, i) => { z += lookup[i].get(category(ctx[name])) ?? 0; }); }
      return sigmoid(z);
    };
  }
  return { publishable: false as const, predict(probability: unknown, context?: unknown) {
    const p = finite(probability); check(p >= 0 && p <= 1); return clip(finite(map(p, context)));
  } };
}

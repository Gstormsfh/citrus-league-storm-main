/** Development-only JSON inference. Not exported by the serving package barrel.
 * Artifact integrity, source eligibility and publication authority are upstream gates.
 * This module performs no I/O, scoring writes, fantasy scoring or model loading.
 */
const kinds = ['raw', 'logit_sigmoid', 'isotonic', 'beta', 'beta_group'] as const;
const fields = ['shot_type', 'prior_sog_same_team', 'strength'] as const;
type Kind = typeof kinds[number];
type Field = typeof fields[number];
type Context = Record<Field, string | null>;
type Node = { leaf: number } | { feature: number; threshold: number; left: number; right: number };
const settings = { epsilon: 1e-6, shape_ridge: 1, group_ridge: 100,
  optimizer: 'L-BFGS-B', maxiter: 2000, ftol: 1e-12, gtol: 1e-8,
  max_rows: 1000000, max_categories_per_field: 64, max_context_cells: 32000000,
  unknown_group_policy: 'zero_offset_with_explicit_context_receipt', seed: 60906 };

function ensure(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`Portable xG: ${message}`);
}
function record(value: unknown): Record<string, unknown> {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'object required');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  ensure(Object.keys(value).length === expected.length && expected.every(k => Object.prototype.hasOwnProperty.call(value, k)), 'exact fields required');
}
function finite(value: unknown): number {
  ensure(typeof value === 'number' && Number.isFinite(value), 'finite number required'); return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  const n = finite(value); ensure(Number.isInteger(n) && n >= minimum && n <= maximum, 'bounded integer required'); return n;
}
function category(value: unknown): string | null {
  ensure(value === null || (typeof value === 'string' && value.trim().length > 0 && value.length <= 128), 'explicit category required');
  return value as string | null;
}
function names(value: unknown, maximum: number): string[] {
  ensure(Array.isArray(value) && value.length <= maximum, 'bounded name list required');
  const result = value.map(v => { const n = category(v); ensure(n !== null, 'name required'); return n; });
  ensure(new Set(result).size === result.length, 'unique names required'); return result;
}
function sigmoid(z: number): number {
  finite(z);
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

function compileCalibrator(input: unknown, expectedKind: Kind) {
  const c = record(input);
  const extras = expectedKind === 'raw' ? [] : expectedKind === 'logit_sigmoid' ? ['intercept', 'slope']
    : expectedKind === 'isotonic' ? ['x', 'y'] : ['a', 'b', 'intercept', 'vocabulary', 'offsets', 'optimization'];
  keys(c, ['contract', 'kind', 'settings', 'publishable', ...extras]);
  ensure(c.contract === 'citrus-probability-calibrator-v1' && c.kind === expectedKind && c.publishable === false, 'calibrator contract');
  const declared = record(c.settings); keys(declared, Object.keys(settings));
  ensure(Object.entries(settings).every(([k, v]) => declared[k] === v), 'calibrator settings');
  if (expectedKind === 'raw') return { predict: (p: number, _ctx: Context) => p, vocabulary: null };
  if (expectedKind === 'isotonic') {
    ensure(Array.isArray(c.x) && Array.isArray(c.y) && c.x.length > 0 && c.x.length <= 1000000 && c.x.length === c.y.length, 'isotonic knot count');
    const x = c.x.map(finite), y = c.y.map(finite);
    ensure(x.every((v, i) => v >= 0 && v <= 1 && (!i || v > x[i - 1]))
      && y.every((v, i) => v >= 0 && v <= 1 && (!i || v >= y[i - 1])), 'ordered isotonic knots');
    return { vocabulary: null, predict(p: number, _ctx: Context) {
      if (p <= x[0]) return y[0]; if (p >= x[x.length - 1]) return y[y.length - 1];
      let low = 0, high = x.length - 1;
      while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (p < x[middle]) high = middle; else low = middle; }
      return y[low] + (p - x[low]) * (y[high] - y[low]) / (x[high] - x[low]);
    } };
  }
  const intercept = finite(c.intercept);
  if (expectedKind === 'logit_sigmoid') {
    const slope = finite(c.slope);
    return { vocabulary: null, predict(p: number, _ctx: Context) {
      const q = Math.max(1e-6, Math.min(1 - 1e-6, p)); return sigmoid(intercept + slope * (Math.log(q) - Math.log1p(-q)));
    } };
  }
  const a = finite(c.a), b = finite(c.b); ensure(a >= 0 && b >= 0, 'nonnegative beta shape');
  const vocab = record(c.vocabulary); keys(vocab, expectedKind === 'beta_group' ? fields : []);
  const vocabulary = {} as Record<Field, (string | null)[]>;
  const offsets = c.offsets; ensure(Array.isArray(offsets), 'offset array');
  const values = offsets.map(finite); let offset = 0;
  const lookups = {} as Record<Field, Map<string | null, number>>;
  if (expectedKind === 'beta_group') for (const name of fields) {
    const raw = vocab[name]; ensure(Array.isArray(raw) && raw.length > 0 && raw.length <= 64, 'bounded group vocabulary');
    const list = raw.map(category);
    ensure(new Set(list).size === list.length && list.every((v, i) => !i || (list[i - 1] === null && v !== null)
      || (list[i - 1] !== null && v !== null && list[i - 1] < v)), 'canonical group vocabulary');
    vocabulary[name] = [...list]; lookups[name] = new Map(list.map((v, i) => [v, values[offset + i]])); offset += list.length;
  }
  ensure(offset === values.length, 'exact group offsets');
  const optimization = record(c.optimization); keys(optimization, ['converged', 'iterations', 'objective']);
  ensure(optimization.converged === true, 'converged calibrator'); integer(optimization.iterations, 0, 2000); finite(optimization.objective);
  return { vocabulary: expectedKind === 'beta_group' ? vocabulary : null, predict(p: number, ctx: Context) {
    const q = Math.max(1e-6, Math.min(1 - 1e-6, p)); let z = intercept + a * Math.log(q) - b * Math.log1p(-q);
    if (expectedKind === 'beta_group') for (const name of fields) z += lookups[name].get(ctx[name]) ?? 0;
    return sigmoid(z);
  } };
}

export function createPortableXgScorer(modelInput: unknown, calibratorInputs: unknown) {
  const model = record(modelInput);
  keys(model, ['contract', 'publishable', 'source_sklearn_version', 'input_policy', 'branch_policy', 'leaf_policy', 'design', 'baseline_logit', 'trees']);
  ensure(model.contract === 'citrus-json-numeric-context-model-v1' && model.publishable === false
    && model.source_sklearn_version === '1.5.2' && model.input_policy === 'finite_design_after_explicit_imputation'
    && model.branch_policy === 'less_than_or_equal_left' && model.leaf_policy === 'already_learning_rate_scaled', 'model contract');
  const design = record(model.design); keys(design, ['schema', 'numeric_names', 'categorical_names', 'medians', 'vocabulary']);
  const schema = record(design.schema); keys(schema, ['version', 'names', 'categorical_names']);
  ensure(typeof schema.version === 'string' && schema.version.trim(), 'schema version');
  const numericSchema = names(schema.names, 64), categoricalSchema = names(schema.categorical_names, 8);
  ensure(numericSchema.every(n => !categoricalSchema.includes(n)), 'disjoint schema');
  const numeric = names(design.numeric_names, 64), categorical = names(design.categorical_names, 8);
  ensure(numeric.length > 0 && numeric.every(n => numericSchema.includes(n)) && categorical.every(n => categoricalSchema.includes(n)), 'feature view');
  const medians = record(design.medians); keys(medians, numeric);
  const medianValues = numeric.map(n => finite(medians[n]));
  const vocabulary = record(design.vocabulary); keys(vocabulary, categorical);
  const vocab = categorical.map(n => {
    const list = names(vocabulary[n], 256); ensure(list.every((v, i) => !i || list[i - 1] < v), 'ordered train vocabulary'); return list;
  });
  const lookups = vocab.map(list => new Map(list.map((v, i) => [v, i])));
  const width = numeric.length * 2 + vocab.reduce((sum, list) => sum + list.length + 2, 0);
  ensure(width <= 1024, 'bounded feature width');
  const indices = numeric.map(n => numericSchema.indexOf(n));
  const contextIndices = ['immediate_previous_sog_same_team', 'shooting_skaters', 'defending_skaters'].map(n => numericSchema.indexOf(n));
  ensure(contextIndices.every(i => i >= 0) && categoricalSchema.includes('shot_type'), 'pre-outcome context schema');
  const baseline = finite(model.baseline_logit);
  ensure(Array.isArray(model.trees) && model.trees.length > 0 && model.trees.length <= 256, 'bounded trees');
  const trees: Node[][] = model.trees.map(input => {
    ensure(Array.isArray(input) && input.length > 0 && input.length <= 511, 'bounded nodes');
    const parents = input.map(() => 0);
    const tree: Node[] = input.map((value, i) => {
      const n = record(value);
      if (Object.prototype.hasOwnProperty.call(n, 'leaf')) { keys(n, ['leaf']); return { leaf: finite(n.leaf) }; }
      keys(n, ['feature', 'threshold', 'left', 'right']);
      const left = integer(n.left, i + 1, input.length - 1), right = integer(n.right, i + 1, input.length - 1);
      ensure(left !== right, 'distinct child nodes'); parents[left]++; parents[right]++;
      return { feature: integer(n.feature, 0, width - 1), threshold: finite(n.threshold), left, right };
    });
    ensure(parents.every((p, i) => p === (i ? 1 : 0)), 'rooted nonshared tree'); return tree;
  });
  const inputCal = record(calibratorInputs); keys(inputCal, kinds);
  const calibrated = Object.fromEntries(kinds.map(k => [k, compileCalibrator(inputCal[k], k)])) as Record<Kind, ReturnType<typeof compileCalibrator>>;
  return {
    publishable: false as const,
    predict(input: unknown) {
      const row = record(input), features = row.features;
      ensure(Array.isArray(features) && features.length === numericSchema.length, 'exact numeric input');
      const raw = features.map(v => v === null ? null : finite(v));
      const cats = record(row.categorical); keys(cats, categoricalSchema);
      for (const name of categoricalSchema) category(cats[name]);
      const x = new Array<number>(width).fill(0);
      for (let j = 0; j < numeric.length; j++) { x[j] = raw[indices[j]] === null ? medianValues[j] : raw[indices[j]]; x[j + numeric.length] = raw[indices[j]] === null ? 1 : 0; }
      const d = numeric.indexOf('distance_to_goal_ft'), angle = numeric.indexOf('signed_angle_deg');
      ensure((d < 0 || x[d] >= 0) && (angle < 0 || Math.abs(x[angle]) <= 180), 'valid geometry');
      let start = numeric.length * 2;
      categorical.forEach((name, i) => { const v = cats[name] as string | null, size = vocab[i].length;
        x[start + (v === null ? size : (lookups[i].get(v) ?? size + 1))] = 1; start += size + 2; });
      const prior = raw[contextIndices[0]], shooting = raw[contextIndices[1]], defending = raw[contextIndices[2]];
      ensure(prior === null || prior === 0 || prior === 1, 'prior SOG context');
      if (shooting !== null) integer(shooting, 0, 7); if (defending !== null) integer(defending, 0, 7);
      const context: Context = { shot_type: cats.shot_type as string | null, prior_sog_same_team: prior === null ? null : String(prior),
        strength: shooting === null || defending === null ? null : `${shooting}v${defending}` };
      let z = baseline;
      for (const tree of trees) { let index = 0; let node = tree[index];
        while (!('leaf' in node)) { index = x[node.feature] <= node.threshold ? node.left : node.right; node = tree[index]; }
        z += node.leaf;
      }
      const probability = sigmoid(z);
      const predictions = Object.fromEntries(kinds.map(k => [k, calibrated[k].predict(probability, context)])) as Record<Kind, number>;
      ensure(Object.values(predictions).every(p => Number.isFinite(p) && p >= 0 && p <= 1), 'finite calibrated probability');
      const contextStatus = Object.fromEntries(fields.map(name => [name, { missing: context[name] === null,
        unseen: !calibrated.beta_group.vocabulary[name].includes(context[name]) }])) as Record<Field, { missing: boolean; unseen: boolean }>;
      return { predictions, context, contextStatus, publishable: false as const };
    },
  };
}

import { describe, expect, it } from 'vitest';
import { createPortableXgScorer } from '../portableXg';

const settings = { epsilon: 1e-6, shape_ridge: 1, group_ridge: 100, optimizer: 'L-BFGS-B',
  maxiter: 2000, ftol: 1e-12, gtol: 1e-8, max_rows: 1000000, max_categories_per_field: 64,
  max_context_cells: 32000000, unknown_group_policy: 'zero_offset_with_explicit_context_receipt', seed: 60906 };
const names = ['distance_to_goal_ft', 'signed_angle_deg', 'immediate_previous_sog_same_team', 'shooting_skaters', 'defending_skaters'];
function artifacts() {
  const base = { contract: 'citrus-probability-calibrator-v1', settings: { ...settings }, publishable: false };
  const beta = { a: 1, b: 1, intercept: 0, vocabulary: {}, offsets: [], optimization: { converged: true, iterations: 1, objective: .2 } };
  return {
    model: { contract: 'citrus-json-numeric-context-model-v1', publishable: false,
      source_sklearn_version: '1.5.2', input_policy: 'finite_design_after_explicit_imputation',
      branch_policy: 'less_than_or_equal_left', leaf_policy: 'already_learning_rate_scaled',
      design: { schema: { version: 'synthetic', names: [...names], categorical_names: ['shot_type'] },
        numeric_names: [...names], categorical_names: ['shot_type'],
        medians: Object.fromEntries(names.map(n => [n, n.endsWith('skaters') ? 5 : 0])), vocabulary: { shot_type: ['wrist'] } },
      baseline_logit: 0, trees: [[{ feature: 0, threshold: 10, left: 1, right: 2 }, { leaf: -1 }, { leaf: 1 }]] },
    calibrators: {
      raw: { ...base, kind: 'raw' }, logit_sigmoid: { ...base, kind: 'logit_sigmoid', intercept: 0, slope: 1 },
      isotonic: { ...base, kind: 'isotonic', x: [0, .5, 1], y: [0, .5, 1] },
      beta: { ...base, kind: 'beta', ...beta },
      beta_group: { ...base, kind: 'beta_group', ...beta,
        vocabulary: { shot_type: ['wrist'], prior_sog_same_team: [null, '1'], strength: ['5v5'] }, offsets: [.1, .2, .3, .4] },
    },
  };
}
function row(distance = 10) { return { features: [distance, 0, null, 5, 5], categorical: { shot_type: 'wrist' } }; }

describe('development-only portable xG boundary', () => {
  it('uses <= on split thresholds and preserves calibrated probabilities', () => {
    const { model, calibrators } = artifacts(); const scorer = createPortableXgScorer(model, calibrators);
    const left = scorer.predict(row()), right = scorer.predict(row(10 + 1e-12));
    expect(left.predictions.raw).toBeCloseTo(1 / (1 + Math.exp(1)), 15);
    expect(right.predictions.raw).toBeCloseTo(1 / (1 + Math.exp(-1)), 15);
    for (const kind of ['beta', 'isotonic', 'logit_sigmoid']) expect(left.predictions[kind]).toBeCloseTo(left.predictions.raw, 15);
    expect(left.predictions.beta_group).toBeCloseTo(1 / (1 + Math.exp(.3)), 15);
    expect(left.publishable).toBe(false); expect(scorer.publishable).toBe(false);
  });
  it('retains null context instead of using the imputed value', () => {
    const { model, calibrators } = artifacts();
    const result = createPortableXgScorer(model, calibrators).predict(row());
    expect(result.context.prior_sog_same_team).toBeNull();
    expect(result.contextStatus.prior_sog_same_team).toEqual({ missing: true, unseen: false });
  });
  it('unseen explicit categories have zero offset and explicit status', () => {
    const { model, calibrators } = artifacts(); const r = row(); r.features[2] = 0; r.features[3] = 4; r.categorical.shot_type = 'new';
    const result = createPortableXgScorer(model, calibrators).predict(r);
    expect(result.predictions.beta_group).toBeCloseTo(result.predictions.beta, 15);
    expect(Object.values(result.contextStatus)).toEqual(Array(3).fill({ missing: false, unseen: true }));
  });
  it('copied compiled model does not change with caller mutations', () => {
    const { model, calibrators } = artifacts(); const scorer = createPortableXgScorer(model, calibrators);
    const before = scorer.predict(row()); model.trees[0][1].leaf = 100; calibrators.beta.a = 100;
    model.design.medians.distance_to_goal_ft = 100; calibrators.beta_group.offsets[0] = 100;
    expect(scorer.predict(row())).toEqual(before);
  });
  it('outcome and identity fields cannot affect predictions', () => {
    const { model, calibrators } = artifacts(); const scorer = createPortableXgScorer(model, calibrators);
    expect(scorer.predict({ ...row(), label: 1, player_id: 100, future: 7 })).toEqual(scorer.predict({ ...row(), label: 0 }));
  });
  it('known/missing/unknown one-hot cells are distinct', () => {
    const { model, calibrators } = artifacts(); model.trees[0][0].feature = 11; model.trees[0][0].threshold = .5;
    const scorer = createPortableXgScorer(model, calibrators); const r = row(); r.categorical.shot_type = null;
    expect(scorer.predict(r).predictions.raw).toBeGreaterThan(scorer.predict(row()).predictions.raw);
    r.categorical.shot_type = 'unseen'; expect(scorer.predict(r).predictions.raw).toBe(scorer.predict(row()).predictions.raw);
  });
  it.each([true, NaN, Infinity, '10', undefined])('rejects invalid numeric input %s', value => {
    const { model, calibrators } = artifacts(); const r = row() as any; r.features[0] = value;
    expect(() => createPortableXgScorer(model, calibrators).predict(r)).toThrow();
  });
  it.each([-1, 8, 5.5, true])('rejects invalid skater count %s', value => {
    const { model, calibrators } = artifacts(); const r = row() as any; r.features[3] = value;
    expect(() => createPortableXgScorer(model, calibrators).predict(r)).toThrow();
  });
  it.each([{}, { features: [1], categorical: { shot_type: 'wrist' } }, { ...row(), categorical: {} },
    { ...row(), categorical: { shot_type: '' } }, { ...row(), features: [-1, 0, null, 5, 5] },
    { ...row(), features: [1, 181, null, 5, 5] }])('rejects malformed feature rows', input => {
    const { model, calibrators } = artifacts(); expect(() => createPortableXgScorer(model, calibrators).predict(input)).toThrow();
  });
  it.each(['cycle', 'shared', 'orphan', 'feature', 'leaf', 'threshold', 'extra', 'empty', 'too_many'])('rejects malformed trees: %s', bad => {
    const { model, calibrators } = artifacts(); const m = model as any;
    if (bad === 'cycle') m.trees[0][0].left = 0;
    if (bad === 'shared') m.trees[0][0].right = 1;
    if (bad === 'orphan') m.trees[0].push({ leaf: 0 });
    if (bad === 'feature') m.trees[0][0].feature = true;
    if (bad === 'leaf') m.trees[0][1].leaf = NaN;
    if (bad === 'threshold') m.trees[0][0].threshold = Infinity;
    if (bad === 'extra') m.trees[0][0].categorical = true;
    if (bad === 'empty') m.trees = [];
    if (bad === 'too_many') m.trees = Array(257).fill([{ leaf: 0 }]);
    expect(() => createPortableXgScorer(model, calibrators)).toThrow();
  });
  it.each(['publishable', 'settings', 'negative', 'offset', 'vocabulary', 'convergence', 'knots', 'unknown'])('rejects malformed calibrators: %s', bad => {
    const { model, calibrators } = artifacts(); const c = calibrators as any;
    if (bad === 'publishable') c.beta.publishable = true;
    if (bad === 'settings') c.beta.settings.shape_ridge = true;
    if (bad === 'negative') c.beta.a = -1;
    if (bad === 'offset') c.beta_group.offsets.pop();
    if (bad === 'vocabulary') c.beta_group.vocabulary.prior_sog_same_team.reverse();
    if (bad === 'convergence') c.beta.optimization.converged = false;
    if (bad === 'knots') c.isotonic.x.reverse();
    if (bad === 'unknown') c.new_candidate = c.raw;
    expect(() => createPortableXgScorer(model, calibrators)).toThrow();
  });
  it('clips extreme raw logits only at the declared calibration epsilon', () => {
    const { model, calibrators } = artifacts(); model.baseline_logit = -1000;
    const result = createPortableXgScorer(model, calibrators).predict(row());
    expect(result.predictions.raw).toBe(0); expect(result.predictions.beta).toBeCloseTo(1e-6, 15);
  });
  it('single isotonic knot stays constant', () => {
    const { model, calibrators } = artifacts(); calibrators.isotonic.x = [.3]; calibrators.isotonic.y = [.2];
    const scorer = createPortableXgScorer(model, calibrators);
    expect(scorer.predict(row()).predictions.isotonic).toBe(.2); expect(scorer.predict(row(20)).predictions.isotonic).toBe(.2);
  });
});

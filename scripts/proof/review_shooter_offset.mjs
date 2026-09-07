// Independent scalar arithmetic and earlier-only player membership review.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir = 'scripts/proof/results/shooter-offset-20260907-full';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const key = r => `${r.game_id}/${r.event_id}`;
const sigmoid = z => z >= 0 ? 1/(1+Math.exp(-z)) : Math.exp(z)/(1+Math.exp(z));
const logit = p => { const q = Math.min(1-1e-6, Math.max(1e-6, p)); return Math.log(q)-Math.log1p(-q); };
const health = read(dir+'/health.json');
assert.equal(health.status, 'complete-shooter-offset-development-not-accepted');
for (const [name, digest] of Object.entries(health.files)) assert.equal(sha(dir+'/'+name), digest);
let events = 0, fits = 0, maxGradient = 0, maxError = 0;
for (const fold of ['fold1', 'fold2']) {
  const predictions = read(`${dir}/${fold}-predictions.json`);
  const source = read(`scripts/proof/results/recent-finishing-bridge-20260907-full/${fold}-events.json`);
  const index = new Map(source.map(r => [key(r), r]));
  const originals = new Set(read(`scripts/proof/results/composed-player-finishing-20260907-full/${fold}/events.json`).map(key));
  assert.equal(predictions.length, source.length);
  const seen = new Set();
  for (const month of [...new Set(source.map(r => r.game_date.slice(0, 7)))].sort()) {
    const fit = read(`${dir}/${fold}-${month}-fit.json`);
    assert.equal(fit.cutoff_exclusive, month+'-01'); assert.equal(fit.precision, 16);
    const expected = new Map();
    for (const r of source) if (originals.has(key(r)) && r.game_date < fit.cutoff_exclusive) {
      const k = `${r.game_type}/${r.player_id}`;
      if (!expected.has(k)) expected.set(k, []);
      expected.get(k).push(r);
    }
    assert.deepEqual(Object.keys(fit.players).sort(), [...expected.keys()].sort());
    for (const [k, p] of Object.entries(fit.players)) {
      const rows = expected.get(k);
      assert.deepEqual(p.training_keys.map(v => v.join('/')).sort(), rows.map(key).sort());
      assert.equal(p.events, rows.length); assert.equal(p.games, new Set(rows.map(r => r.game_id)).size);
      assert.equal(p.training_end, rows.map(r => r.game_date).sort().at(-1));
      let grad = 16*p.offset;
      for (const r of rows) grad += sigmoid(logit(r.neutral_xg)+p.offset)-Number(r.is_goal);
      maxGradient = Math.max(maxGradient, Math.abs(grad)); fits++;
    }
    for (const p of predictions.filter(r => r.game_date.slice(0, 7) === month)) {
      assert.ok(!seen.has(key(p))); seen.add(key(p));
      const r = index.get(key(p)); assert.ok(r);
      for (const f of ['neutral_xg','player_id','game_type','team_id','is_goal','game_date']) assert.equal(p[f], r[f]);
      const history = fit.players[`${r.game_type}/${r.player_id}`];
      assert.equal(p.prior_player_attempts, history?.events ?? 0);
      const offset = history?.offset ?? 0;
      const q = offset === 0 ? r.neutral_xg : sigmoid(logit(r.neutral_xg)+offset);
      maxError = Math.max(maxError, Math.abs(q-p.shooter_conditioned_probability)); events++;
    }
  }
  assert.equal(seen.size, index.size);
}
assert.ok(maxGradient < 1e-9); assert.ok(maxError < 1e-12);
console.log(JSON.stringify({verified: true, events, playerMonthFits: fits, maxGradient, maxProbabilityError: maxError, healthSha256: sha(dir+'/health.json')}));

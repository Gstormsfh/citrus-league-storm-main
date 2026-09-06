/** Bounded stdin/stdout bridge to independent TypeScript shape inference. */
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { compileCalibrationShape } from '../../packages/shared/src/utils/calibrationShape.ts';
const names = ['isotonic_clipped', 'smooth_isotonic_clipped', 'monotone_logit', 'monotone_logit_group'];
const path = resolve(process.argv[2] ?? '');
if (process.argv.length !== 3 || await realpath(path) !== path || (await stat(path)).size > 32 * 1024 * 1024) throw Error('Bounded nonsymlink JSON bundle required');
const models = JSON.parse(await readFile(path, 'utf8'));
if (!models || Object.keys(models).length !== 4 || !names.every(n => Object.hasOwn(models, n) && models[n].kind === n)) throw Error('Exact shape bundle required');
const scorers = Object.fromEntries(names.map(n => [n, compileCalibrationShape(models[n])]));
let count = 0, aborted = false;
const stop = () => { aborted = true; process.stdin.destroy(new Error('Interrupted shape inference')); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
try {
  for await (const line of lines) {
    if (aborted || ++count > 1000000 || !line || line.length > 65536) throw Error('Bounded complete inference rows required');
    const row = JSON.parse(line);
    if (!Number.isSafeInteger(row.game_id) || !Number.isSafeInteger(row.event_id)) throw Error('Exact event identity required');
    const out = JSON.stringify({ game_id: row.game_id, event_id: row.event_id,
      predictions: Object.fromEntries(names.map(n => [n, scorers[n].predict(row.raw_probability, row.context)])) }) + '\n';
    if (!process.stdout.write(out)) await once(process.stdout, 'drain');
  }
  if (!count || aborted) throw Error('No complete prediction population');
} finally { lines.close(); process.off('SIGINT', stop); process.off('SIGTERM', stop); }

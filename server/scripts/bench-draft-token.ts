/**
 * Local micro-bench for the draft-token helper. Not a real perf gate;
 * the route's p95 ≤ 50ms gate is measured on staging once 11g.1 deploys.
 * This script just confirms the JWT sign/verify path is fast enough
 * that it won't dominate the route's latency budget.
 */
import { issueDraftToken, verifyDraftToken } from '../src/lib/draftToken';

process.env.SUPABASE_JWT_SECRET = 'test-secret-long-enough-for-hs256-at-32-chars-minimum';

const params = { userId: 'u-1', draftId: 'd-1', leagueId: 'l-1' };
const N = 1000;
const issueTimes: number[] = [];
const verifyTimes: number[] = [];
const tokens: string[] = [];

for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint();
  const t = await issueDraftToken(params);
  issueTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
  tokens.push(t);
}
for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint();
  await verifyDraftToken(tokens[i], params.draftId);
  verifyTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
}

const p = (a: number[], q: number) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * q)];
console.log(`issue:  p50=${p(issueTimes, 0.5).toFixed(3)}ms p95=${p(issueTimes, 0.95).toFixed(3)}ms p99=${p(issueTimes, 0.99).toFixed(3)}ms`);
console.log(`verify: p50=${p(verifyTimes, 0.5).toFixed(3)}ms p95=${p(verifyTimes, 0.95).toFixed(3)}ms p99=${p(verifyTimes, 0.99).toFixed(3)}ms`);

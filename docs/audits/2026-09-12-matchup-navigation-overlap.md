# Matchup navigation overlap — review evidence

The Matchup loader previously waited for roster data, daily scores and records before requesting previous/next-week matchup IDs. Those IDs depend only on the validated league, caller, week and first-week date. The change starts the same reads after current-matchup validation and consumes their result at the original response boundary. An outcome wrapper handles rejection immediately while preserving earlier roster errors.

## Identical-input comparison

Baseline: `a5db32b0e77bcc0d14d29c92df10312c44a2710d`. Run the identical `MatchupService.navigationOverlap.test.ts` replay against each checkout's actual service source, using the same dependencies, fake clock, API responses and representative roster values. The baseline runs only the `captured latency replay` tests; the candidate also runs the behavioral tests.

| Fixture | Baseline virtual ms | Candidate virtual ms | Removed tail ms |
|---|---:|---:|---:|
| Test | 1365 | 1100 | 265 |
| Finalsz | 1409 | 1157 | 252 |
| Zero-latency cached control | 1157 | 1157 | 0 |

Latency inputs come from the sanitized September 12 authenticated baseline: Test first-lineup-to-daily-score interval 568 ms, daily score 532 ms, next-week GET 265 ms; Finalsz 620, 537 and 252 ms. These model only relevant late loader phases. They do not represent total page time. Earlier browser captures used prior a3cd assets during a rollout with unpinned API identity, so they are motivating observations, not a controlled production comparison.

Complete returned JSON is identical for each paired replay, including navigation, records, actual totals, daily values and roster projection fields. SHA-256 of serialized response:

- Test: `148c38f917f1649619dd21ed4e5dc725128605748422f31d711541009b3d237f`
- Finalsz and cached control: `43b28ef9029a846baaf7c8b4b8869abec3ce6f3bc203d1f21cfab223450216c8`

The fixtures use the real shared scorer for representative signed PM, zero and unconditional goalie projection outputs, retaining unavailable projections as null and expected starts separately. Roster construction and API boundaries are mocked. This establishes loader response parity; it is not a production database, NHL projection pipeline or browser paint benchmark. No production speedup is claimed.

To reproduce, run the new test in both checkouts with `-t 'captured latency replay'`. Set `CITRUS_NAV_REPLAY_OUTPUT` to an existing directory plus filename prefix to save each fixture, trace, complete response and hash. Compare the `response` objects as well as completion events. The candidate behavioral cases additionally verify early start, late completion, validation boundaries, both navigation directions, bye behavior and error precedence.

## Validation and operational scope

85 tests across seven focused service, scoring and scoreboard test files pass; web TypeScript and targeted ESLint pass. Existing projection cache, earned stats, expected projections and projected-final slot coverage remains green. The change makes no scoring, schema, source/model, mutation, API authorization or cache-key changes. Data-access review passes.

Successful loads issue the same navigation reads. They now overlap roster work, slightly increasing concurrency; on a later roster failure a read may already have started. Reads retain the same caller-scoped route and league/week arguments. No retry or cancellation is added. A cached zero-duration response yields no replay improvement. Live contention and end-to-end rendering remain unmeasured.

This is a review-only PR. Merge and deployment require the coordinator's separate rollout decision. A later authorized browser comparison should use a pinned serving revision and matched league/date/cache conditions.

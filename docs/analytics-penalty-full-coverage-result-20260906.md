# Full retained-development penalty annotation coverage

Completed evidence: `scripts/proof/results/penalty-full-coverage-20260906-development/`.
This is input coverage and replay evidence, not an accuracy experiment or active
penalty/power-play clock.

All **541,067 exact eligible event keys across 6,272 games** from the completed
movement corpus are retained in `vectors.jsonl`. No uncovered shots were removed.
The result preserves recorded annotation type, recorded duration in minutes,
seconds since that recorded event, provenance IDs and explicit missingness for
same-team and opponent channels.

| Channel | Recorded annotation available | Annotation unavailable | Recorded type available | Duration / annotation age available |
|---|---:|---:|---:|---:|
| Same team | 200,320 | 340,747 | 200,194 | 200,320 |
| Opponent | 238,677 | 302,390 | 238,416 | 238,677 |

An observed annotation can lack a recognized type: that affects 126 same-team
and 261 opponent rows. Those unknown types remain None. Missing prior history
is not zero elapsed time, no penalty, or even strength. A recorded two-minute
annotation can legitimately have an age over two minutes because this quantity
does not claim the penalty remains active.

## Verification

- One selected shot per game passed prefix truncation and current goal/non-goal
  perturbation checks: 6,272 games. Future events cannot change that checked
  shot's annotation output.
- A deterministic 100-game subset underwent independent backwards provenance,
  recorded-field and clock comparisons: 44,972 comparisons passed.
- A separate post-completion streaming read verified all three files bound by
  `health.json`, all 541,067 unique event keys, exact per-game row counts, the
  ordered event-key digest, and the availability totals shown above.
- Ordered event-key SHA-256:
  `49846312a1fbed39cbd681ac85e5ef03c8ec7b5f1105f5d4350bdd931dbaeeec`.
- `result.json` retains per-season type/duration/age distributions and reasons;
  `declaration.json` and its checked-source closure bind the frozen inputs and
  implementation. `vectors.jsonl` is 468,262,925 bytes.

## Limits and next gate

These are latest same-period recorded penalty annotations from current frozen
source revisions, not historical-as-of observations, adjudicated penalty state,
remaining penalty seconds or true power-play start age. Source-prefix checks
do not establish when a publisher first exposed each annotation. No model was
fitted; no calibration gain, forecast gain or superiority claim is supported.

A subsequent separately declared ablation may evaluate these explicitly named
annotations on unchanged chronological populations. Keep this coverage proof
and all unknown states intact regardless of whether that candidate succeeds.
Production and original model artifacts are unchanged by this proof.

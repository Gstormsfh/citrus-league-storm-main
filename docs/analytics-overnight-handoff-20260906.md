# Citrus overnight analytics handoff — 6 September 2026

Status: substantial local progress; **foundation, model quality and FPAR are not
accepted**. Production and hosted databases remain unchanged. No deployment,
push, merge, paid purchase or MoneyPuck-file training occurred in this mission
lane. This is the checkpoint for the scheduled overnight window ending at
08:00 America/Edmonton (14:00 UTC), not a claim of industry leadership.

## Verified outcome

| Area | Saved evidence | What it establishes |
|---|---|---|
| xG calibration | [Shape comparison](analytics-calibration-shape-result-20260906.md) | Context-aware monotone-logit calibration improves both probability losses in both inspected development folds versus group beta. Remaining bias and subgroup regressions prevent acceptance. |
| Source-to-model validation | [Actor checkpoint](analytics-actor-attribution-result-20260906.md) | Original NHL receipts, feature gates, saved JSON model and calibration map reproduce every raw/calibrated validation probability exactly; actor and team-stint accounting receives independent review. |
| Database-to-consumer path | [Local publication checkpoint](analytics-model-publication-result-20260906.md) | Actual Python publisher and TypeScript reader pass on two fresh disposable PostgreSQL/PostgREST fixtures, including replay, withholding, rollback and access denial. Diagnostic transport only, not hosted capacity or serving approval. |
| Preservation and organization | [Final integrity receipt](analytics-overnight-integrity-20260906.json) | All 62 named pins match on the final pass, including 17 legacy files and 12 compressed archives. No unknown artifact was deserialized; original evidence and prospective reservations remain retained. |

The final integrity check ran at 13:52:43 UTC. It rehashed the named top-level
pins; it did not rerun every nested source review or recreate the runtime.
Archives are local duplicates, not off-machine backups.

A subsequent [nested integrity pass](analytics-overnight-bound-integrity-20260906.json)
at 13:57:14 UTC rehashed all 15,626 files named in the saved actor review,
reading 3,703,157,340 bytes. Every digest still matches. This separately checks
the bound file bytes, not a rerun of the review's semantic calculations or fits.

Latest saved Python suite: **1,784 passed**, with 16 network tests deselected.
Separate inference/review and special-state suites record 48 and 10 passes.
These counts were checked against the saved XML; the final documentation-only
pass did not rerun those suites. Passing tests establish tested behavior, not
predictive superiority.

## Exact next work, in order

1. **Prioritize calibration quality under an explicit new validation plan.**
   Mid/high-probability overprediction remains. The latest shape comparison
   worsens both losses for 3v3 and bat shots in both folds; empty-net log loss
   also worsens in both folds. Diagnose source/context weaknesses before another
   parameter search. Do not keep optimizing these already-inspected outcomes
   and then call them untouched. Preserve all candidate failures and the
   original six prospective reservations; new variants need their own
   prospective declaration rather than silently joining the old reservation.
2. **Resolve special-state semantics without mutating frozen experiments.**
   The retained attribution diagnostic withholds 103 goalie-state events:
   100 have same-clock penalty-shot context and three remain unpaired at the end
   of overtime. Introduce a separately versioned contract only after source
   adjudication. Preserve unknown/missing/different actor evidence and reject
   contradictions. A goalie ID alone must not override an invalid state code.
3. **Join official appearances and time on ice exactly before rates.**
   Roster listing and model-event counts cannot become GP, TOI or xG/60.
   Require exact game/season/type/player coverage, team-stint reconciliation,
   source timestamps and nullable incomplete totals. Never overwrite official
   NHL actuals with PBP diagnostic counts.
4. **Complete remaining writer/dependency and operational coverage.**
   Keep local native proofs separate from hosted load/security/rollout gates.
   The composed native v5 lane still has no eligible inference rows; a
   throw-on-use guard is not a full successful nightly model execution.
5. **Validate physical forecasts, then integrate FPAR.**
   Require participation, exposure, horizon, uncertainty and compatible model
   lineage before league scoring. Use the existing `ScoringCalculator`, exact
   eligibility and a jointly feasible replacement allocation. Missing inputs
   (including unavailable plus/minus) must not become measured zero. The local
   replacement-pool contract is not an accepted, integrated FPAR product.

## Final bounded source follow-up

Primary recaps confirm shootouts for all three games:
[Vegas–Columbus](https://www.nhl.com/news/vegas-golden-knights-columbus-blue-jackets-game-recap-338101682),
[Vegas–Boston](https://www.nhl.com/news/vegas-golden-knights-boston-bruins-game-recap-338338506),
and [Calgary–Vancouver](https://www.nhl.com/news/calgary-flames-vancouver-canucks-game-recap-343082140).
These pages were opened on 6 September 2026. They do not independently classify
the three disputed attempt records.

The retained raw records are game/event `2022020349/723`, `2022020399/748` and
`2022021270/785`. Each is labeled OT 05:00, followed by an OT period-end and an
explicit SO period-start. Their shooter rosters identify Shea Theodore for the
first two and Brock Boeser for the third. Each disputed event, OT period-end
and subsequent SO period-start has code `1010`.

A state-code carryover at the overtime/shootout boundary is a **hypothesis**,
not an adjudication or permission to reassign/exclude an event. This follow-up
used the original PBP bodies under
`scripts/proof/results/historical-official-freeze-20260906/2022/pbp/` and did not
replace their receipts. Attempts to open `PL020349.HTM`, `PL020399.HTM` and
`PL021270.HTM` on NHL's 2022–2023 report path returned no usable content through
web retrieval. No mirrored report was substituted. Obtain a usable independent
event report or video before changing these cases in a new version.

## Preserve the whole research foundation

The [method-preservation map](analytics-method-preservation-20260906.md) remains
the scope anchor: raw observations, rink effects, geometry/pass proxies,
Bayesian finishing, rebound creation/flurry, opportunity/home/rest, joint
uncertainty, on-ice/GAR, goalie evaluation, era effects, possession/action value
and the wider published research roadmap. This is not a flurry-only rebuild.
MoneyPuck's public ideas may inform original methods; its files, predictions
and fitted parameters remain excluded from new training while rights are
unconfirmed. Older artifacts are preserved, not newly endorsed or silently
reused as compatible baselines.

New metric research remains in scope after the relevant foundation gates.
Define its target, units, observable inputs, abstention rule and incremental
held-out value before naming it a validated product. An observed chain value
is not automatically possession value, persistent player talent or FPAR.

## Authority and restart boundaries

Local versioned code, offline fits, tests, read-only primary-source research and
owned disposable Docker fixtures remain within the authorized mission scope.
No additional approval is needed for those next steps. Genuine new authority
would be required for hosted writes/DDL, rollout, purchases, external commitments
or use of restricted external files. None is necessary to continue useful local
work. Future outcomes and independent source evidence cannot be manufactured by
approval.

The last process check found no matching active fit, actor or publication job;
the owned local-publication Docker label had no remaining containers. Existing
Docker itself was not stopped. Resume from `docs/ANALYTICS_ACCEPTANCE.md` and
current git status; do not rerun completed lanes just to recreate a status update.

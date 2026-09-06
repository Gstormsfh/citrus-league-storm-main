# Analytics implementation acceptance record

Priority: foundation → metric validation → benchmarked quality → fantasy extensions.
Status: foundation NOT accepted. Local work only; no production rollout authorized.

| Gate | Source → writer → consumer | Acceptance evidence | Current state |
|---|---|---|---|
| Event identity | NHL/raw shots → scoring/season aggregates → player/goalie surfaces | Unique game/event plus shooter, period, outcome, population reconciliation; quarantine every conflict | PARTIAL: independent schedule covers all 1394 stored 2025-season games. Original NHL gate remains 1362 matched / 32 quarantined. Separate goal/SOG overlays cover original receipts and explicitly reviewed new HTTP revisions; neither changes the original gates or activates training. Raw remains 783 matched / 611 quarantined, with 814 cardinality and 226 semantic conflicts retained. Hosted reconciliation/publication remains blocked |
| TOI provenance | NHL summary/game log → game/season/talent writers → deployment metrics | Exact event sets and every TOI value; official GP; historical seasons; source timestamps; late corrections | PARTIAL: strict raw/derived receipt replay passes: 940 expected, 939 available, 1 withheld; 953 frozen files unchanged. Future exports enforce explicit project/season/window and checksummed catalog or equal complete REST reads. Replay revalidates original catalog evidence or retains frozen REST provenance, without new online observations. Legacy evidence is not upgraded; no production correction/publication |
| Season boundaries | NHL game identity → all writers | Explicit regular/playoff/shootout contract, ordered complete pagination | PARTIAL: rollup regular range + local guard; consumers already select variants; remaining writers unverified |
| Traded players | Team stints → season aggregator → charts | Sum exposures/counts, recompute rates, no duplicate totals | PARTIAL: history and actual dashboard aggregation tested; unknown multi-stint distance denominator returns NULL. Live regular-season shot/xG totals agree for 937 players; remaining consumer/exposure coverage pending |
| Availability/freshness | Field source → publication → consumers | Missing is unavailable; field-level age and reason, no stale row timestamp inference | LOCAL INTEGRATION COMPLETE: opt-in background reader feeds actual dashboard/detail/UI boundaries; refresh, revision, rollback, stale evidence and failed reads return verified values or explicit NULL. Flag remains OFF; hosted tables remain unapplied |
| Ownership/idempotence | Ingest/calculation → shared tables | Narrow writes, stable identities, replay and corrections, atomic publication | PARTIAL: native independent-connection publication/canonical races pass, including commit and rollback lock witnesses. Real Python publisher → local PostgREST → actual TypeScript reader passes publication, replay, new correction and explicit rollback. Historical acquisition conflicts remain quarantined; hosted capacity is not proven |
| Version lineage | Features/model/calibrator → scores → aggregates | Same variant/version/population, immutable evidence, reversible serving selection | PARTIAL: new publication contract pins source/feature/model/code/variant and supports explicit rollback. Existing model families and stored-score lineage remain unverified |
| Migration/security | Local migrations/live schema → readers/writers | Compare actual definitions/ledger; scoped RLS, staging, backup/rollback | PARTIAL: live definitions captured. Ordinary-user writes to global GSAx/projection tables confirmed; narrow restriction passes synthetic and actual staging rollback checks. Rollout unapplied. GSAx native races pass; hosted load, season-key redesign and broader writer lineage remain open |
| Health | Source expectations → completed batches | Affirmative expected/actual/withheld; partial read failure cannot publish | PARTIAL: exact-page failure propagation, TOI withholding, landing/per-game caller failures and publication manifests tested. Official PBP collector preserves partial receipts and emits failed health on disk/import errors. Remaining jobs and operational coverage pending |
| Chronological quality | Frozen earlier fit → later calibration → declared retrospective test; separately reserved prospective test | Proper scores, reliability, game-cluster uncertainty, subgroups, fixed lineage | MEASURED, NOT ACCEPTED: source-replayed first-party fit/calibration/test completed; all six variants share 116506 test attempts in 1362 eligible games. Calibrated context Brier 0.061753 / AUC 0.741076 improves on geometry but overpredicts 325.43 goals. Coverage/exclusions retained. All six pipelines reserved before the 2026-09-15–2027-08-31 future window; no future result or automatic acceptance. Historical revisions remain retrospective, not historical-as-of or untouched. MoneyPuck files excluded |
| Expected finishing/GAR/forecasts | Versioned history/context → persistent estimates | Observed G−xG distinct from persistent talent; exposure/units/opportunity/interval validation | Pending foundation and chronological evidence |
| Fantasy and database integration | ScoringCalculator + feasible roster/waiver state → versioned outputs | League/horizon/eligibility, joint allocation, non-additive move value separate, RLS | Deferred until earlier gates pass |

## Current local verification (2026-09-06)

### Additive calibration refinement and cross-language inference

The [new checkpoint](analytics-calibration-result-20260906.md) and
[bound evidence index](analytics-calibration-result-index-20260906.json) record
a completed, source-replayed calibration experiment under a separately frozen
plan. Context-aware beta improves Brier and log loss in both already-inspected
development folds versus the retained enhanced sigmoid. Ordinary beta does not.
All candidates, reliability bins, paired comparisons and subgroups remain
preserved. Mid/high-probability overprediction and subgroup regressions remain;
fold 1 aggregate goal bias is slightly worse. Calibration is **not accepted**.

Fresh refits reproduce the prior raw/sigmoid/isotonic validation vectors exactly.
Independent JSON Python design/inference passes every calibration/validation row;
the full-cohort TypeScript proof passes calibration raw and all five validation
probability maps within the declared tolerance. It retains missing and unseen
context explicitly. This proves portability of source-validated feature rows,
not TypeScript PBP parsing, hosted publication, full serving acceptance or FPAR.
The new TypeScript scorer is not connected to serving. Old experiments,
reservations and archives remain unchanged; no hosted operations occurred.

Local verification: 1,611 offline Python tests pass, 16 network tests excluded;
284 shared TypeScript tests and its type check pass; the standalone cross-language
proof harness passes 8 tests. See the checkpoint for calibration limits and
the next bounded overnight work. Overall foundation status remains NOT accepted.

### Additive earlier development and composed database work

The [earlier-development declaration](analytics-development-ablation-plan-20260906.json)
was frozen before a new real export or fit. Its additive exporter completed
6,365 selected games, retained 93 source-quarantined games and emitted 541,067
geometry-eligible attempts without narrowing the old training population.
One additional geometry-ineligible candidate remains in its audit. The manifest
semantic SHA is `2f657b06a5b715b305fbdef0977dd0e371e5ab55cee2cc4a982aa0f45e70421b`.
The source-replayed two-fold fit and declared shortlist are complete. The
[result and calibration limits](analytics-development-result-20260906.md) and
[bound machine review](analytics-development-result-proof-20260906.json) record
enhanced-context sigmoid as the declared development shortlist, not an accepted
or serving model. Both earlier validation folds improve probability losses over
base-context sigmoid; calibration and subgroup problems remain visible. The
create-only result wrapper replayed source membership again and verified 12,785
source/export/code/artifact files. Only event files before July 2024 were used;
the old observed historical test and all existing prospective reservations
remain unchanged.

Root independently passed the updated full offline Python suite: 1,515 tests,
16 network tests deselected, 33 existing datetime-deprecation warnings in
27.78 seconds. This includes result replay/lineage and archive adversarial
regressions; a test count does not assert model quality.

The [expanded composed-native proof](analytics-native-composed-expanded-20260906.json)
executes actual clock repair, strength/TOI, guarded on-ice/GAR, rink interpolation,
season refresh and GSAx reconciliation. Two disposable PostgreSQL 17.6 runs passed
with four independent lock witnesses, invalid-source atomicity, correction/replay
and unchanged older-season sentinels. Fixture cleanup verified zero objects and
roles; root stopped only its ownership-verified containers. A subsequent
[cell-mode proof](analytics-native-composed-cells-20260906.json) passed two native
runs using exact feature/fold/key views and the actual legacy cell scorer; no
successful tail stubs remain in that opt-in mode. v5 inference is still
throw-on-use with no eligible rows, and synthetic cell/rink parameters prove
plumbing rather than fitted validity. This is not full nightly/load/hosted
acceptance. The earlier narrower
[composed proof](analytics-native-composed-nightly-20260906.json) is preserved.

The [nullable-xG consumer correction](analytics-nullable-xg-consumers-20260906.md)
preserves absent versus supplied-zero season xG through the actual index,
draft-kit, player card, browse adapter and discrepancy note. Official actuals,
queries, entitlement and season filters are unchanged. Full web/server/shared
suites pass (4,484 / 1,849 / 244; six server tests skipped), all three type checks
pass, and web build passes. Full web lint has zero errors and nine warnings.
No hosted writes or model-serving promotion were performed.

The [new checkpoint archive](analytics-development-checkpoint-archive-20260906.json)
preserves selected source and the new development/report evidence separately
from the earlier archives. Every member and complete selected membership was
checked without extraction; root then independently rechecked both compressed
archive hashes and sizes. Both old archives, all 18 original experiment proof
files and all 17 inventoried legacy artifacts still match their prior hashes.
This is a local duplicate, not a remote backup or quality acceptance.

The [versioned report replay](analytics-report-v2-review-20260906.md) resolves only
reviewed historical team aliases and the supported terminal administrative
marker. Of the unchanged 2,713 source/report pairs, 2,668 parse and pass original
source gates; 45 remain unavailable. Complete attempt correspondence holds for
2,336, and 1,918 also have matching gameplay-type counts. These are source-review
counts, not training approval. Root independently rehashed 10,867 source/code
files and passed the 54 combined parser/review tests. Old source files, v1 logic,
quarantines and model cohorts remain unchanged.

### Real measurement checkpoint

The [first real experiment result](analytics-first-neutral-experiment-result-20260906.md)
and [machine proof](analytics-first-neutral-experiment-proof-20260906.json) record
actual source-replayed fitting and evaluation. Training, later calibration and
retrospective test use 541067 / 117884 / 116506 eligible attempts; 93 / 24 / 32
source-quarantined games remain excluded. All six raw/calibrated prevalence,
geometry and context variants are retained on identical event membership.
Calibrated context expects 8673.43 goals against 8348 observed; calibration remains
unaccepted. Historical test data are now explicitly inspected and cannot be reused
as untouched evidence.

Complete pipelines were separately reserved at 2026-09-06 07:03:25 UTC for
2026-09-15–2027-08-31. No future observations were supplied and no winner or serving
promotion was selected. Local clock/hash closure is not an independent timestamp
or proof of future quality. The original pre-fit declaration remains unchanged;
this checkpoint supersedes its historical execution status.

The [completed-experiment archive](analytics-completed-experiment-archive-20260906.json)
retains 29788 selected evidence files and 909 tracked source/proof/doc files at
commit `d84d3f585885093535be9d00c6510b7d2e8b9931`. Every archived file was byte-hash
compared to its retained original, and complete selected file membership was
checked independently. No originals were removed. Both archives remain local;
they are not an off-machine backup or an inventory of every external input.

The original 32 goal/SOG conflicts now have source-specific statistical evidence
and a separately pinned local overlay. Root replayed every exact original receipt;
the source bytes and goal credit remain unchanged. Newly observed revisions do
not inherit approval: all 32 new HTTP revisions required an additional explicit
review and separate pinned manifest. Neither overlay is silently activated in
this experiment. See `analytics-goal-sog-adjudication-20260906.md`.

Whole-transaction testing reproduced a real two-writer source-lock upgrade
deadlock that individual function tests could not expose. A tenth unapplied
migration coordinates sixteen reviewed entrypoints before their first writes.
It passed nine isolated protocol checks and two native PostgreSQL 17.6 runs,
each with three independent backends and three witnessed gate/lock observations.
The exact native fixtures and their explicit synthetic dependencies are retained;
full nightly dependency integration and hosted blocking/load remain unverified.
See `analytics-nightly-lock-audit-20260906.md`. No global arbitrary-SQL
deadlock-freedom claim is made.

The earlier root-run full offline Python suite passed 1321 tests, with 16 network
tests deselected and 34 warnings in 7.21 seconds. Warnings comprise 33 existing
datetime deprecations and one physical-core detection fallback; actual model
fit/predict/scoring pools are fixed to one thread. The suite count is not
predictive-quality evidence. Root independently rehashed 9186 coverage evidence/code
files, all eleven inner experiment files and all 17 inventoried tracked legacy
joblib artifacts. Those legacy bytes are unchanged and were never deserialized by
the new path. Earlier complete-system suite counts remain historical checkpoints.

The historical collector preserves each scheduled game's exact response bytes,
receipt, final-game evidence and every quarantine, with end-of-run source/code
drift checks. A separate bounded collection retains 2017/2018 official reports
because their JSON event order/orientation is not silently repaired. Report
parse failures retain the complete available response for offline review. These
collections now retain all 11870 scheduled official PBP responses across season
IDs 2017–2025, including 182 quarantines and no unavailable captures. The separate
2017/2018 report collection retained 2713 HTTP-200 bodies; 1956 passed its existing
header/stream validator and 757 remained unavailable to that validator. It exits
incomplete and is not training-ready. Completed capture is not validation or model
acceptance. Public research families and prior model artifacts remain preserved;
no unknown pickle/joblib artifact or MoneyPuck file is loaded by the new path.

The completed [older-report review](analytics-historical-report-proof-20260906.json)
rehashed all 2713 receipt/body pairs against the finished capture inventory. Its
69 exact PEND/GEND/GOFF candidates remain review-only; 688 other cases remain
unresolved. No terminal rows, punctuation or clocks were silently repaired.

### Earlier complete-system verification

The current local implementation contains typed immutable publication, complete-
population TOI contracts and narrow writer handling, actual nullable consumer
transitions, shared-output access restrictions, projection season/population
fixes, strict corpus evidence, raw receipt binding and native race harnesses.
All changes remain local; no push, merge, deployment or production data mutation.

Full suites: web 4471 passed; server 1833 passed / 6 skipped; shared 244 passed;
offline Python 1015 passed / 16 network tests deselected (33 existing deprecation
warnings). Web build and
server/web/shared TypeScript pass; web lint has 9 existing warnings, 0 errors.
A server freshness fixture initially failed at a millisecond boundary; it now
uses one observation clock, and the entire server suite passed again. No
freshness validation was relaxed. Isolated SQL: publication 25, canonical sealing
22, shared-output security 25, legacy GSAx guard 14, era/playoff exclusions 15,
xG season-refresh guard 20, on-ice guard 46, GAR candidate guard 66, archive
boxscore fill 65. The validator now runs natively as ESM and recognizes
only single explicitly `pg_temp`-qualified scratch drops; public/unqualified,
multi-table and CASCADE drops remain errors. Fifteen dedicated validator checks
pass. Nine unapplied migrations pass without errors or warnings.

Native PostgreSQL 17.6: publication/canonical 17 checks across 3 connections and
6 witnessed lock waits, repeated successfully; GSAx guard 16 checks across 3
connections and 5 witnessed lock waits, repeated successfully. Both harnesses
verified zero remaining fixture objects/roles. This closes the native concurrency
correctness gap, not hosted load or deployment-capacity acceptance.

The new xG season-refresh guard additionally passes twice on native PostgreSQL
17.6 with three independent backends and eight exact relation-lock witnesses per
run. Source corrections, invalid commits, source rollback, each output writer and
overlapping refreshes serialize. Rejection snapshots and other-season rows remain
exact. Successful replay float8 sums varied by at most 2.220446049250313e-16 after
tuple-order changes; an explicit 1e-12 tolerance applies only to the small
fixture's finite aggregate float fields, never identities/counts/nulls or
failure-preservation snapshots. The initial exact-float assertion failed; no
migration was changed to make it pass. Both disposable test containers were
removed, and successful runs verified zero fixture objects/roles. Evidence:
`analytics-native-xg-refresh-races-20260906.json`.

On-ice and GAR guards each passed twice on native PostgreSQL 17.6 with three
independent backends: ten and twelve exact relation-lock witnesses per run,
respectively. Invalid source commits preserve prior outputs (including on-ice
completion markers); successful rebuilds preserve unrelated games/seasons.
Both guards retain captured eligible formulas and reject caller temp-table
collisions. GAR no longer recomputes unrelated seasons implicitly. Exact
limitations and cleanup are in their native proof/guard records; broad outer-
transaction locks still need whole-pipeline and hosted-load validation.

The legacy archive writer now requires exact requested identities, paired final
responses and original source provenance. It retains old actuals and refuses
corrections. Testing an entire PBP document in a conditional-update URL exposed a
real transport failure; a new unapplied service-only RPC now performs that exact
comparison using POST body arguments and fills only SQL NULL boxscores. Real
Python/REST/PG tests cover full-sized synthetic PBP, replay and interleaved source
correction/insertion conflicts. They are not overlapping lock-wait tests or
official-stat adjudication. Missing RPC deployment fails closed. See
`analytics-archive-writer-proof-20260906.md` and its retained REST proof.

The chronological manifest planner has 69 synthetic tests. It binds source and
feature receipts, every source-event membership/exclusion, canonical game dates
and strictly ordered whole-game windows. Future reservations pin the previous
data manifest and caller-supplied pipeline/criteria digests. It cannot certify
source authenticity, historical availability, actual fitted-pipeline freezing,
untouched history or predictive quality. No real split/evaluation was run.

The full-system preservation map is `analytics-method-preservation-20260906.md`.
It covers database, organization and all discovered model/research dimensions,
including explicit distinctions between wired methods, optional/manual paths and
specifications. The narrow rink-CDF callable bug is fixed without changing default
behavior, empirical fitting logic or activating an unvalidated adjustment.

Independent sequence/rebound mathematics and source-only full-stream extraction
now have a shared nonpublishing shadow stage at both actual Python writer
boundaries. Synthetic boundary tests preserve the complete existing column set,
raw source bytes, context and existing attributes. Legacy callers without source/
prediction evidence withhold diagnostics. Neither supplied attestation nor the
green structural tests establish calibration. No model artifacts were loaded.
The full schedule-bound source sequence audit yields 1362 verified / 32 retained
quarantined games; it exits 2. Nine historical/current source pairs preserve both
versions and original timestamps. `analytics-sequence-archive-proof-20260906.json`
identifies their local retained archive; no full historical acceptance is claimed.

The real Python publisher, PostgREST and actual TypeScript publication reader
passed all four phases against 940 values: initial publication (939 available /
1 withheld), idempotent replay, a clearly labeled correction on a disposable
local copy (940 available), and explicit rollback to the original batch. Every
phase checked exact values and stale-to-NULL behavior. Original evidence stayed
unchanged; three publication events remained. No live appearance was corrected.

Capacity finding: a 42,905,547-byte compact snapshot caused a PostgreSQL backend
OOM under a 512 MiB container limit; after recovery all publication tables were
empty. The same test passed with PostgreSQL capped at 2 GiB and PostgREST at
1 GiB. This does not establish a minimum or production capacity. Explicit sizing
or bounded evidence-artifact storage is required before hosted rollout. Both
disposable containers, their gateway and task network were removed; Docker
Desktop and downloaded images were retained.

Proofs: `analytics-corpus-full-proof-20260906.json` records all 1394 games;
`analytics-goal-sog-adjudication-20260906.md` distinguishes awarded-goal evidence
from a shot-type heuristic; `analytics-toi-replay-proof-20260906.json` records the
unchanged-input replay. Native concurrency and actual REST integration have
separate `analytics-native-*-races-20260906.json` and
`analytics-local-publication-e2e-20260906.json` proof files.
`analytics-evidence-archive-20260906.json` identifies the retained local archive.
`analytics-schedule-proof-20260906.json` records independent completed-game
coverage and unchanged 61-receipt offline replay. The source window and byte
hashes are preserved; schedule agreement does not clear event-level quarantine.

`analytics-writer-lineage-audit-20260906.md` records captured live definitions,
actual writer paths and permission proof. Legacy score and fit labels are not
immutable lineage. Historical-as-of claims remain blocked by missing as-of
source/model evidence. The newer result above establishes a limited current-revision
retrospective baseline with explicit source exclusions, not full predictive-quality
acceptance. Tests of structural contracts alone do not establish predictive quality.

## Earlier implementation log

The entries below preserve the sequence of work. Counts and "pending" statements
describe their checkpoint; the current matrix and verification above supersede
them. Live observations are read-only SQL measurements, not mock-test results.
Matrix refreshed at implementation resumption, HEAD b8aa3243. Targeted local
verification at resumption: 46 Python tests (including three uncommitted
canonical-event normalizer tests), 15 isolated publication SQL checks. These
results do not establish live consumer correctness, concurrency or model quality.

Resumption implementation: canonical official-feed normalization, correction-
preserving observation writer, exact event-set sealing, and read-only receipt
collection are implemented. Fifteen targeted Python tests (canonical/acquisition/
publication candidates) and 16 isolated canonical SQL checks pass. Both unapplied
migrations pass the repository static validator. A live read-only conflict scan
produced a 498-game manifest (regular and playoff); receipt collection is running,
not yet a full-corpus acceptance claim.

Hosted staging: a uniquely named synthetic-test schema was temporarily committed
to attempt independent-connection races. Different backend IDs were observed, but
no overlapping lock wait was captured (the second request elapsed only 0.008s),
so this is NOT concurrency proof. Canonical incomplete/sealed rejection and
repeatable-read refusal were verified in rollback transactions. All six synthetic
tables, six functions and the test schema were explicitly removed without CASCADE;
follow-up count of matching schemas was zero. No production writes or persistent
staging changes. A native PG 17.6 test harness exists; sandbox shmget permission
denial prevents running it here. This gate remains OPEN.

Freshness correction: a newer computation cutoff no longer refreshes old evidence.
Prepared batches carry `validation.freshness_observed_at`; TOI uses the oldest
receipt conservatively. The reader rejects missing/future freshness and returns
NULL for stale source evidence. Six targeted reader tests pass. This is not yet
the real-consumer transition.
Fresh official NHL endpoint check for player 8476453: landing regular-season GP
and game-log length both 76; stored regular-season game rows count 77. Game
2025020538 is absent from that official game log. Stored TOI totals 92728 seconds.
This disproves the assumption that every stored zero row is an official appearance.
No production row was modified. End-to-end reconciliation must compare identities.

Implemented next: snapshot shot identity/quarantine CLI with deterministic source
hashes; rollup page reads now require exact counts and stable game/player or
game/event ordering. A failed xG page raises before publishing partial totals.
Local evidence: 27 tests pass across identity, rollup, exact reads and key groups.

TOI follow-up: the publication path now compares exact official game identities
and every per-game TOI value, including positive values. Equal counts with a
different event fail; late corrections fail. Historical single-team NHL season
GP is supported via exact seasonTotals; ambiguous multi-team historical rows
remain unavailable. Invalid skater season rows are not published, new xG/60 is
withheld, and unavailable average TOI is explicitly NULL. Withheld rows make the
job exit 2 after its health report. Existing stale season values remain untouched
and are not yet furnished with field-level availability to consumers: this gate
still requires versioned publication metadata before production acceptance.

Publication schema milestone: migration 20260906005705 is still UNAPPLIED.
Four service-only RLS tables hold immutable snapshots/batches/values/publication
events. Publication serializes with row insertion and checks completeness,
validation status and source observation cutoff. Local Postgres/WASM: 14 checks
passed. Hosted staging rollback-only transaction: incomplete publication was
rejected; complete fixture published once; ROLLBACK executed; follow-up query
confirmed zero remaining test tables. Production untouched. Multi-connection
race behavior and integration of field-level availability into consumers remain
open gates; the single-connection local test cannot prove concurrency behavior.

Fresh NHL PBP spot checks: game 2025021165/event 1088 is a goal (NHL-shot row
agrees; raw row says false). Game 2025020535/event 258 shooter is 8479336
(NHL-shot row agrees; raw row says 8477499). These two checks do not resolve the
whole corpus. Both legacy acquisition save paths now run event replay preflight
before coordinate dedup/upsert, and partial-save errors propagate. The actual
saver boundary test demonstrates quarantine before dedup or DB write without
loading unrelated model binaries. Existing source revisions remain quarantined;
they need a versioned correction publication, not naive coordinate-key replay.

Further publication evidence: expected entity IDs now must match exactly, not
merely count equally. Isolated Postgres: 15 checks; hosted staging rollback test
also rejected an equally sized wrong-identity batch and left zero tables.
Python candidate/publisher covers source receipts, availability, resumable
inserts and correction-as-new-batch behavior. Server background reader covers
exact variant/version, truncation/identity checks and stale-source null output.
Local tests: 42 Python tests plus 4 reader tests; server TypeScript clean.
Adapters are intentionally not enabled against absent production tables.

Read-only ledger capture: `analytics-migration-drift-20260906.json`: 450 prod
versions, 405 tracked local versions at capture, 41 overlap. No history repair
was attempted. RLS is enabled on inspected raw/NHL shots, game/season/talent
stats and goalie season tables; policy semantics still need separate review.

Extended identity check: among 118746 unique season-2025 pairs, current live
queries found 43 clock disagreements, 76 absolute-geometry disagreements and
150 missing/different shot types (categories overlap). Identity v2 now quarantines
these cases as well. Absolute geometry is only a source consistency check; it
does not establish equal orientation or feature transformations.

Live regular-season NHL-shot → player_xg_season reconciliation: 937 players,
zero missing players and zero shot-count/xG-total mismatches at 1e-5 tolerance.
Consumer inspection found the prior traded-player fix covered the separate
history endpoint but NOT the dashboard payload. Dashboard now sums stints,
recomputes G−xG and xG/attempt, and orders pagination by team as well as season
and game type. Multi-stint average distance is unavailable because the source
does not provide per-stint non-null distance sample counts. Actual dashboard
service regression verifies one season row and separate playoff output.

Inspected legacy policies admit public/authenticated reads of hockey stats and
restrict mutations to service_role (some use legacy auth.role expressions).
No unconditional anonymous-write policy was found in these six tables. This
does not certify other tables or SECURITY DEFINER functions.
Source research: user-provided audit, next steps, calibration investigation and
hockey blueprint dated 2026-09-05. Stored probabilities are retrospective until
the complete fit/calibration lineage proves otherwise. No novelty or superiority
claim follows from structural tests.

Withdrawn migration 20260906002239 was never applied; Git retains it. A future
backfill must use a frozen verified input snapshot and pass staging/rollback.

Broader blueprint remains in scope after foundation: opportunity/participation,
goalie starts, coherent attempt outcomes, expected finishing, context-aware GAR,
uncertainty, prospective forecast archives, FPAR, lineup/draft/multi-day decisions.
Actor-linked xA/tracking/action value require verified input coverage and usage
rights; missing historical inputs must not be invented.

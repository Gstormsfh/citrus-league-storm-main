# Analytics implementation acceptance record

Priority: foundation → metric validation → benchmarked quality → fantasy extensions.
Status: foundation NOT accepted. Local work only; no production rollout authorized.

| Gate | Source → writer → consumer | Acceptance evidence | Current state |
|---|---|---|---|
| Event identity | NHL/raw shots → scoring/season aggregates → player/goalie surfaces | Unique game/event plus shooter, period, outcome, population reconciliation; quarantine every conflict | BLOCKED: all 1394 stored games have current official receipts. NHL: 1362 matched / 32 quarantined; raw: 783 matched / 611 quarantined. Frozen non-shootout reconciliation has 814 cardinality and 226 semantic conflicts. The 32 goal/SOG cases require explicit statistical adjudication; awarded goals are not automatically another SOG. No silent repair |
| TOI provenance | NHL summary/game log → game/season/talent writers → deployment metrics | Exact event sets and every TOI value; official GP; historical seasons; source timestamps; late corrections | PARTIAL: strict raw/derived receipt binding and complete official population replay pass: 940 expected, 939 available, 1 withheld for an extra stored appearance. All 953 frozen input hashes unchanged. No production correction or publication. Future export-manifest provenance is being tightened |
| Season boundaries | NHL game identity → all writers | Explicit regular/playoff/shootout contract, ordered complete pagination | PARTIAL: rollup regular range + local guard; consumers already select variants; remaining writers unverified |
| Traded players | Team stints → season aggregator → charts | Sum exposures/counts, recompute rates, no duplicate totals | PARTIAL: history and actual dashboard aggregation tested; unknown multi-stint distance denominator returns NULL. Live regular-season shot/xG totals agree for 937 players; remaining consumer/exposure coverage pending |
| Availability/freshness | Field source → publication → consumers | Missing is unavailable; field-level age and reason, no stale row timestamp inference | LOCAL INTEGRATION COMPLETE: opt-in background reader feeds actual dashboard/detail/UI boundaries; refresh, revision, rollback, stale evidence and failed reads return verified values or explicit NULL. Flag remains OFF; hosted tables remain unapplied |
| Ownership/idempotence | Ingest/calculation → shared tables | Narrow writes, stable identities, replay and corrections, atomic publication | PARTIAL: native independent-connection publication/canonical races pass, including commit and rollback lock witnesses. Real Python publisher → local PostgREST → actual TypeScript reader passes publication, replay, new correction and explicit rollback. Historical acquisition conflicts remain quarantined; hosted capacity is not proven |
| Version lineage | Features/model/calibrator → scores → aggregates | Same variant/version/population, immutable evidence, reversible serving selection | PARTIAL: new publication contract pins source/feature/model/code/variant and supports explicit rollback. Existing model families and stored-score lineage remain unverified |
| Migration/security | Local migrations/live schema → readers/writers | Compare actual definitions/ledger; scoped RLS, staging, backup/rollback | PARTIAL: live definitions captured. Ordinary-user writes to global GSAx/projection tables confirmed; narrow restriction passes synthetic and actual staging rollback checks. Rollout unapplied. GSAx native races pass; hosted load, season-key redesign and broader writer lineage remain open |
| Health | Source expectations → completed batches | Affirmative expected/actual/withheld; partial read failure cannot publish | PARTIAL: exact-page failure propagation, TOI withholding, landing/per-game caller failures and publication manifests tested. Official PBP collector preserves partial receipts and emits failed health on disk/import errors. Remaining jobs and operational coverage pending |
| Chronological quality | Frozen earlier fit → later calibration → untouched test | Proper scores, reliability, game-cluster uncertainty, subgroups, fixed lineage | BLOCKED by foundation; stored-score replay is not independent evaluation |
| Expected finishing/GAR/forecasts | Versioned history/context → persistent estimates | Observed G−xG distinct from persistent talent; exposure/units/opportunity/interval validation | Pending foundation and chronological evidence |
| Fantasy and database integration | ScoringCalculator + feasible roster/waiver state → versioned outputs | League/horizon/eligibility, joint allocation, non-additive move value separate, RLS | Deferred until earlier gates pass |

## Current local verification (2026-09-06)

Local commits through `1da74905` contain typed immutable publication, complete-
population TOI contracts and narrow writer handling, actual nullable consumer
transitions, shared-output access restrictions, projection season/population
fixes, strict corpus evidence, raw receipt binding and native race harnesses.
All changes remain local; no push, merge, deployment or production data mutation.

Full suites: web 4471 passed; server 1833 passed / 6 skipped; shared 244 passed;
offline Python 574 passed / 16 network tests deselected. Web build and
server/web/shared TypeScript pass; web lint has 9 existing warnings, 0 errors.
A server freshness fixture initially failed at a millisecond boundary; it now
uses one observation clock, and the entire server suite passed again. No
freshness validation was relaxed. Isolated SQL: publication 25, canonical sealing
22, shared-output security 25, legacy GSAx guard 14. Four unapplied migrations
pass the static validator without errors or warnings.

Native PostgreSQL 17.6: publication/canonical 17 checks across 3 connections and
6 witnessed lock waits, repeated successfully; GSAx guard 16 checks across 3
connections and 5 witnessed lock waits, repeated successfully. Both harnesses
verified zero remaining fixture objects/roles. This closes the native concurrency
correctness gap, not hosted load or deployment-capacity acceptance.

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

`analytics-writer-lineage-audit-20260906.md` records captured live definitions,
actual writer paths and permission proof. Legacy score and fit labels are not
immutable lineage. Chronological quality remains blocked by unresolved source
conflicts and missing historical as-of source/model evidence. Tests of structural
contracts do not establish predictive quality.

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

# Analytics implementation acceptance record

Priority: foundation → metric validation → benchmarked quality → fantasy extensions.
Status: foundation NOT accepted. Local work only; no production rollout authorized.

| Gate | Source → writer → consumer | Acceptance evidence | Current state |
|---|---|---|---|
| Event identity | NHL/raw shots → scoring/season aggregates → player/goalie surfaces | Unique game/event plus shooter, period, outcome, population reconciliation; quarantine every conflict | BLOCKED: live 2026-09-06 season 2025: 119357 NHL rows, 118746 unique raw key matches, 598 unmatched, 13 ambiguous; unique matches include 53 shooter and 1 outcome disagreements (may overlap) |
| TOI provenance | NHL landing/game log → game/season/talent writers → deployment metrics | Exact event sets and every TOI value; official GP; historical seasons; source timestamps; late corrections | PARTIAL: local null/zero/GP checks; live talent 940 rows, 0 averages; one stored zero at player 8476453/game 2025020538. Positive-value and event-set reconciliation pending |
| Season boundaries | NHL game identity → all writers | Explicit regular/playoff/shootout contract, ordered complete pagination | PARTIAL: rollup regular range + local guard; consumers already select variants; remaining writers unverified |
| Traded players | Team stints → season aggregator → charts | Sum exposures/counts, recompute rates, no duplicate totals | Existing regression coverage; live corpus recheck pending |
| Availability/freshness | Field source → publication → consumers | Missing is unavailable; field-level age and reason, no stale row timestamp inference | BLOCKED: season TOI NOT NULL/default 0; omission preserves prior value without field freshness |
| Ownership/idempotence | Ingest/calculation → shared tables | Narrow writes, stable identities, replay and corrections, atomic publication | PARTIAL: narrow talent writes and REST key grouping tests; atomic publication/rollback pending |
| Version lineage | Features/model/calibrator → scores → aggregates | Same variant/version/population, immutable evidence, reversible serving selection | BLOCKED: legacy/new model families not yet reconciled |
| Migration/security | Local migrations/live schema → readers/writers | Compare actual definitions/ledger; scoped RLS, staging, backup/rollback | Production and staging discovered; no blanket replay. Current schema verified NOT NULL/default 0 for game and season TOI. Detailed drift/security capture pending |
| Health | Source expectations → completed batches | Affirmative expected/actual/withheld; partial read failure cannot publish | PARTIAL: talent counts present; existing xG partial-read catch still needs repair |
| Chronological quality | Frozen earlier fit → later calibration → untouched test | Proper scores, reliability, game-cluster uncertainty, subgroups, fixed lineage | BLOCKED by foundation; stored-score replay is not independent evaluation |
| Expected finishing/GAR/forecasts | Versioned history/context → persistent estimates | Observed G−xG distinct from persistent talent; exposure/units/opportunity/interval validation | Pending foundation and chronological evidence |
| Fantasy and database integration | ScoringCalculator + feasible roster/waiver state → versioned outputs | League/horizon/eligibility, joint allocation, non-additive move value separate, RLS | Deferred until earlier gates pass |

Live observations above are read-only SQL measurements, not mock-test results.
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

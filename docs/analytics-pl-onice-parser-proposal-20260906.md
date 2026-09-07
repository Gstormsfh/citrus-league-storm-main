# Proposed retained-PL on-ice parser — awaiting parent review

Do not implement or fit until this plan is reviewed. This is a new offline
measurement family, not a modification of any frozen parser or experiment.

## Scope and new artifacts

Proposed new `projections/pl_onice_membership.py`, separate tests, and create-only
proof runner. Start with at most 45 deterministic successful retained PL/PBP
source pairs, selected from receipt inventory before examining memberships.
No network, database writes, source edits, model fitting or deployment.

Input: exact PL HTML body plus receipt, exact PBP body plus receipt, explicit
game/date/away/home identities. Verify individual body digests and parent
inventory bindings; `captured_header_verified` is necessary but not sufficient.
Do not reinterpret unavailable/truncated reports as missing player lists.

## Extraction contract

1. Parse bounded HTML with nesting-aware table depth. Identify complete outer
   event rows and away/home `On Ice` columns from their explicit headers,
   respecting existing documented team-label aliases. Nested player tables must
   not become spurious event rows. Reject malformed/incomplete outer structure.
2. Preserve raw report-row number, period, elapsed/remaining text, event type,
   description, strength annotation and both raw membership cells. Within each
   cell preserve each sweater number, displayed position letter and title text.
   Example retained `2018020059-PL.HTM` has nested `<font title="Left Wing -
   ILYA KOVALCHUK">17</font>` followed by position `L`: retain these as recorded
   annotations; title names are not a primary identity key.
3. Use `(game_id, team_id, sweater_number)` against that game's PBP `rosterSpots`.
   Exactly one player ID is required. Missing/duplicate jersey mapping, duplicate
   listed player, malformed jersey/position or conflicting team header withholds
   the affected membership cell with a reason, never an arbitrary match. Preserve
   raw positions separately from roster positions; disagreement is evidence,
   not a silent correction. Empty cells mean unavailable, not zero skaters.
4. Join only uniquely corresponding unblocked-shot report/PBP rows initially:
   period, elapsed second, event type, explicit actor team and actor sweater
   resolved to player ID. Require bidirectional uniqueness. Do not equate report
   row numbers with PBP event IDs, greedily zip same-clock rows, or infer from
   goals/assist outcomes. Ambiguous rows remain in the artifact, unmatched.
5. Output per event: each side's recorded raw entries, resolved player IDs and
   position annotations, source/report row IDs, source hashes, match status and
   per-cell reasons. Emit an unordered canonical membership set for comparison,
   while preserving original HTML order as evidence. No continuous shift age,
   interval start/end, possession or goalie location is inferred.

## Verification gates

- Synthetic nesting, blank cells, duplicated jerseys, malformed positions,
  conflicting headers, shared sweater numbers across teams, same-clock duplicate
  shot identities, period changes and missing rosters.
- Exact source prefix and current goal/non-goal checks for any predictor view;
  preserve event-type-dependent join metadata separately from admitted features.
  Current membership annotations may reflect report conventions: until pre-shot
  timing is verified, mark them retrospective annotations, not automatically
  causal predictors.
- Deterministic retained-body replay; record all matched/unmatched rows and
  per-season/team/reason coverage. Validate player counts plausibility without
  assuming missing players are goalies or enforcing fabricated five-skater teams.
- Separate independent parser/sample inspection. Source hashes, raw cells and
  withheld cases must survive. No acceptance based solely on parsing success.

Decision requested: approve this bounded parser and evidence-only pilot, then
review coverage/timing before any feature or model experiment.

# Matchup projection rows and totals

September13 2026, captures around04:44–04:47 UTC. Current public client `index-CcLobiPW.js` / `Matchup-C3-l2DQ0.js` from release2fe9c493; all nonempty captured daily forecasts share runtime `30e04ff11722a7f311bea5fe6753abc680b5eeac9fc5c35da1ad0ad2347173ce` and run `06f1e1b4-8742-4cc5-bead-bfd1a63dd4d9`.

**Finding: the two sampled weekly headers add up to the saved active starter forecasts, but the screen hides contributing players and their daily projections.** These are confirmed sampled display defects, not proof of the user's still-ambiguous reported screen or every projection's correctness.

| Week1 captured side | Independent saved-starter total | Existing header | Sum for players occupying rendered slots before repair |
|---|---:|---:|---:|
| Test night9th, user |224.1964469218182|224.2|203.13671396992262|
| Test night9th, opponent |223.96524698962574|224.0|194.83293963612903|
| Finalsz, user |128.56934365772|128.6|111.74235592773906|
| Finalsz, opponent |108.86757147648852|108.9|85.60614822298467|

Independent Python arithmetic uses each captured league's saved scoring weights against the latest captured per-date category counts and saved active membership, excluding benches. These weeks are future weeks with banked actuals0. The last column is a computed membership comparison, **not a sum of numeric values seen on screen**: Oct3 visible scheduled rows instead showed TBD/Probable. Header scope is banked points plus remaining starter-days; player rows are the selected day. One-decimal row rounding is not used for aggregation.

## Confirmed defects and bounded repair

1. Both leagues configure two UTIL slots but active saved records retain duplicate `slot-UTIL` IDs. Renderer expects `slot-UTIL-1/2`, so the two utility rows appeared empty. Test omits Scheifele/Schmaltz and Dahlin/Dobson; Finalsz omits Schmaltz/Keller and Thompson/Necas. Compatibility resolution fills available configured utility slots, reserving explicit placements. One captured September28 active Necas row has no slot at all; partial missing slots use the existing position/UTIL fallback constrained to available slots. No saved assignments or membership are rewritten, and no bench player is promoted.
2. The page's saved/frozen starter and bench selectors attach earned stats but bypass the already-enriched date projections. They now attach the exact selected-date, league-scored expected row. Missing rows clear stale projection objects; no rescore, exposure multiplication or invented zero is added. Earned points and historical membership are retained separately.
3. Both default-day effects treated deliberate null (Full Week) as uninitialized. A small date-selection hook distinguishes initialization, explicit day/full-week selection, and reset when changing matchups. Defaults no longer override Full Week.

No source rates, counts, policies, model refresh, cron, saved scoring, roster records or native artifacts were changed. Season84, MODEL83, rate×exposure once, manual status adoption and unknowns remain unchanged. Correcting the rendered eligible set also corrects client earned-total selection for these previously hidden active rows; no historical earned values themselves are edited. Overflow or contradictory explicit assignments outside the captured compatibility cases remain separate data questions.

## Evidence and verification

Browser owner receipt: `/Users/gstorms/.codex/worktrees/8265/citrus/output/projection-total-reconciliation/RECEIPT.md`. Adjacent files: `test-browser-evidence.json`, `finalsz-browser-evidence.json` (42 retained relevant response bodies each), `oct3-visible-rows.json`, `util-slots-visible.json`, `util-membership-check.json`, and `manifest.json`. Initial static network history was truncated; relevant captured bodies all retrieved successfully. Browsing triggered ordinary page-owned ensure/backfill/score calls; no explicit roster/settings/draft mutation or model refresh was invoked by the investigator.

Independent arithmetic and script: `/Users/gstorms/.codex/worktrees/matchup-load-critical-path/citrus/outputs/projection-total-reconciliation/`. Retained runtime artifact count check also found no disagreement in5624 numeric rate×exposure components; missing components remain missing. This artifact-only check is not a new live full-season consumer certification.

A sanitized fixture keeps exact public player category values, saved per-date active/bench membership, slots, scoring weights and independent totals; it excludes league owner IDs and join codes. Tests run shared scoring, actual slot organization, date projection attachment and PlayerCard rendering against it. The page's four actual saved-roster selector callbacks are AST-extracted and executed to verify wiring and membership, alongside existing route-lifetime tests. Additional cases cover explicit-slot reservations, constrained missing-slot fallback, zero/negative/missing projections, and day→Full Week→day plus next-matchup initialization.

This receipt records local repair evidence. Production repair acceptance and release remain pending exact review and CI; no deployed-fix claim is made here.

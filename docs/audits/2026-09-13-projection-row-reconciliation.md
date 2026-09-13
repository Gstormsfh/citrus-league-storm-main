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

## Production release

PR479 head `7b476a0ec3dffa5e31a0fd71af729a3f545f152c` passed all16 normal CI checks ([CI34738982418](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34738982418), conventions34738982354) and coordinator exact-diff review. Local focused suite passed41 tests across6 files; full web TypeScript passed, targeted lint had0 errors and3 existing page warnings.

Normal squash merge `951d9b4c9a0a163634715711713d9284ad340b4d` at04:58:49 UTC has the exact reviewed tree. Normal push [Production34739158860](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34739158860) succeeded. Draft guard passed04:59:25–26 UTC without an exception. API-first serving verification identified `citrus-api-00322-qzk` with serving=expected digest `sha256:fdaabf929e883eb7440c15ad0f46bb2ecfc9b0ca02cf4b6524764a9756b56655`. Firebase hosting version is `2d96cd350e5ca6ce`.

Independent public check05:09:41.507743 UTC matched all8 selected assets to the workflow artifact and health/root returned200. New client assets: `index-Cki4FUhO.js`, `index-CIJw1wsI.js`, `Matchup-BVq4HfSJ.js`. Matchup SHA256 `8ad77933f2f3323a2c1d2b18222284c2f2815ba82232f92fea74981c560b8732`; index HTML `5a99b0050dd86ba1b9418d69f61213b442e66490796948ce4011d4da4e22ae64`; sw `86af33cb3b7d7d599256eba9a172aa1673489c240a51976cf220ad6331b0ef94`. Index/sw retain no-cache,no-store,must-revalidate.

Independent database read05:09:47.284071 UTC confirms unchanged sourceaa5/runtime30e/run06f1e1b4, inherited September12 10:02:13.183476 UTC refresh, initial_activation and null error. This application repair did not refresh or edit forecast data. Raw release log, workflow metadata, exact web artifact and independent public result remain in `outputs/projection-total-reconciliation/release/` in the integration worktree.

Evidence attribution correction: retained Finalsz team metadata confirms G Daddy/89a2b930 is128.6 (Thompson/Necas), AI Team3/4d9238e5 is108.9 (Schmaltz/Keller). The guide corrected an inverted team-ID join in its derived membership report and preserved the earlier version. Raw captures, all8 missing-player findings, fixture arithmetic and implementation are unchanged.

## Actual browser acceptance of951d

Browser owner completed acceptance05:11:48–05:13:41 UTC on exact `index-CIJw1wsI.js` / `Matchup-BVq4HfSJ.js` in both leagues. A real Update ready→Reload transition reached the new client after the normal30-second interval; no cache bypass or clearing. All8 formerly hidden UTIL players appeared exactly once in their correct side's utility rows. Independent displayed category×league-weight checks passed69/69 numeric forecasts, including8 goalies; workload was already included and not applied again. Bench cards are included in this row-value check but excluded from starter-header arithmetic.

Fresh42-body captures per league independently reproduce all four full-precision weekly totals in the table. Deep normalized before/after equality passed for saved scoring, configured slots, complete captured dated player/team/slot-type/slot-ID membership, and every latest-per-date daily response object. See integration `outputs/projection-total-reconciliation/post-release/before-after-equality.json` and arithmetic records. Their legacy-slot-only comparison is an explicitly old-renderer counterfactual, not the repaired visible membership.

Test week1→2→1 preserved projected224.2/224.0→294.8/280.0→224.2/224.0; Finalsz128.6/108.9→142.2/151.0→128.6/108.9. URL, week selector, dates and opponent remained coherent. Full Week remained selected and returning to Oct3 restored daily values. The Full Week projection-panel message still said “No game today”; this is an exposed wording limitation, **not accepted weekly player forecast display**. A separate minimal follow-up is under review to explicitly request day selection. No aggregate weekly player projection feature is implied.

Final browser receipt: `/Users/gstorms/.codex/worktrees/8265/citrus/output/projection-total-reconciliation/ACCEPTANCE-951d.md`, with adjacent `acceptance-951d-{evidence,observations,numeric-check,state-summary,manifest}.json` and `verify-951d.py`. Browser owner stopped after the bounded checks. Three original defects are accepted on the live release within this scope; the wording follow-up remains separate.

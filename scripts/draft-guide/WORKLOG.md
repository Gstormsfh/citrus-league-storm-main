# Draft guide worklog — 12 September 2026

Current status: FINAL reconciled707-player guide and configurator validated. Source SHA-256 `8beb3a8a86bf431a99f012cb4bf100db1d72362f835c3876cd5f343b3c33f7fc`. The sections below preserve the chronological audit trail, including superseded intermediate counts.

## Base and scope

- Isolated branch `codex/draft-guide-configurable`, based on fetched `origin/master` 6aef8ab7. Fast-forward check was up to date. Saved-checkout analytics/draftkit WIP left untouched.
- Standalone source import, league-scoring UI, shared-scorer adapter and PDF renderer only. No production mutations, deployments or App Store submission changes.
- User target: finish ASAP, tonight if possible; launch Monday 14 September. Notes track readiness rather than authorize automatic deployment.

## Source decisions

- Original local workbook `Citrus_Draft_Kit_2026-27.xlsx`, SHA-256 `8f2324b6708c85f316914742577e8e06df1bf916be258aff264481a18e4abf3c`:580 skaters,75 goalies,24 rookie profiles,32 team tabs.
- Source rates/totals, volume and roster probabilities remain separate. No projection numbers edited here. Intentional83 model-GP ceiling retained.
- Read Backend Work Order and Reasoning Log before any numeric change. Saved text in `source-context/`. Their historical export counts are not evidence of current production defects.
- Seven original rookie profiles lack a matching main-board player. Render unavailable until reconciliation supplies supported coverage. Original goalie rookie formulas use inconsistent column mappings; renderer joins semantic Goalies data by name instead.
- Separate reconciliation task `01a09448-f484-72c2-9005-457563579c1d` reports production coverage broader than historical workbook subset and11 missing workbook goalie rows/57starts. Await its cached, revised authoritative workbook and decision log. Do not infer additional production bugs from workbook omissions.
- Never ingest the historically mislabeled override `rates_per_game` values as literal per-game rates. Live reader/writer/job lineage is owned by the reconciliation task.

## Implementation and evidence

- Complete initial workbook edition:131pages. Main boards contain655 unique rows;24rookie profiles;32team guides including706 source roster slots and192 LD/RD slots.
- All11 unique original photo subjects featured exactly once. Orange rows match their same-page feature; all feature numbers/bars use league weights. Removed duplicate callouts from original PDF.
- Full team player notes preserved. Fixed initial LD/RD omission and dropped notes. Consolidated structural boilerplate, removing near-empty continuation pages.
- Eight scorer integration tests pass: every cached source FPTS, custom contributions/reordering, source immutability, competition ties, zero/negative weights and malformed settings. Inherited JavaScript property keys now rejected with Object.hasOwn.
- Two baseline cached near-ties normalized to competition ranks: D'Astous/Mintyukov337.83, Parssinen/Nesterenko293.21. Hockey projections unchanged.
- Browser QA passed desktop/mobile, live scoring, save/reset/load, custom PDF download, invalid blank input and no console errors. Fixed detail persisting across filters/tabs and disabled settings while PDF generation runs; follow-up browser regression passed.
- Independent PDF audit confirmed no missing team names or source note cells, all features correct, bounds/glyph scan clean; coherent two-page team layout. Automated dynamic verifier passes:1,238 exact rendered ranking rows,24 rookie profiles,32teams/706slots,11highlight/card matches,131bookmarks and7contents links. Custom scoring (goals20,hits2,goals-against−4) also passes the full verifier after reordering/reflow:130pages,1,236rendered ranking rows,all655players and11features. UI-saved settings format works through CLI.

## Pending / launch dependencies

- Completed: imported reconciled workbook, rebuilt and verified default/custom guides, restarted configurator with final fingerprint.
- Live application cards, draft-room scoring, scheduler and production projection validation are separate source/app work. Guide validation does not certify those paths.
- Build18 under review: this local artifact requires no submission change. Any native UI integration/build19 work must be identified separately. No automatic launch deployment authorized.
- Confirm commercial permissions for original supplied player photos/team marks before sale. Added photos carry explicit CC BY-SA2.0 credits.
- Legacy19-page Premium.pdf moved to output/pdf/archive/Premium-superseded naming; Complete.pdf is the current deliverable. Historical import assets remain useful for source reconstruction; no production cleanup or data deletion performed.

## Reconciliation handoff in progress

- Data task reports revised workbook being cached:707main players/52supported additions; canonical accented names;6audit tabs; existing skater rates/GP unchanged. These counts are awaiting import verification.
- Missing roster probability deliberately stays blank. New cohort-prior GP is already unconditional: do not apply probability again or infer100%. Renderer preserves null adjusted points when no probability is supplied.
- Caleb Desnoyers remains without a supported forecast. Data task reports Hart/Hill47/37starts and Vikman corrected toWSH0, with existing WSH allocation retained. These are source-owner decisions, not adjustments made by the guide renderer.

## Final contract and usability corrections

- Mixed source exposure bases found before revised import: existing rows store season totals, additions may store per-game categories with baseline1. Board category columns now show comparable projected season totals (`raw / baseGames × games`), while raw snapshot fields and fantasy scores remain unchanged. Updated verifier passes this display contract.
- Rookie threshold discrepancy escalated to source owner for Rookies rows5,52,60,64 and overly absolute A2 wording. Official NHL rule uses more than25 games, not25-or-more: https://www.nhl.com/info/hockey-operations-guidelines . Exactly25 alone does not resolve the other eligibility tests. Historical count claims must not be silently recomputed without evidence.
- Launcher now verifies and reopens an existing local configurator, rejects conflicting/stale services with guidance, and never kills unrelated processes. Reuse/free-port/conflict checks passed.
- README clarified blocking server lifecycle and workbook-only season setting. Independent credits/instructions review found no blocking mismatch.


## Reconciled deliverable validation

- Imported verified reconciled workbook from the source task:618skaters+89goalies=707. Current fingerprint `770acfd17ac1bb59b6f3752e5bee1fad2ba281f864fb640dca87723c30693988`; final formatting-only fingerprint pending.
- Eight integration tests pass against the new source. Independent contract review confirms52baseline1 rows scale once,127blank probabilities remain unavailable, all32NHL goalie teams total84starts, FA0. OnlyCaleb Desnoyers lacks a rookie forecast.
- Final guide183pages. Verifier checks1,328exact rendered ranking rows,707unique main players,24rookie profiles,32teams/706lineup slots,11unique highlights/callouts,183bookmarks,7contents links andbounds/glyphs.
- Expanded source player-provenance notes account for the longer guide. Fixed orphan special-teams headings and sparse final fragments by keeping paragraph groups together and rebalancing whole paragraphs. Final visual re-audit found no actionable defects.
- Browser validated new canonical Viggo Björck projection, correct24GP/default111.1FPTS, unknownprobabilityhandling, Caleb unavailable, and customPDF generation. Removed empty SOURCE TIER label for untiered additions.
- Final source disposition supersedes earlier interim Vikman note: FA/0NHLstarts, AHL-onlyTucson contract; VGKHart47/Hill37. No forecast invented for unsupportedcase.

- Final immutable workbook fingerprint verified: `8beb3a8a86bf431a99f012cb4bf100db1d72362f835c3876cd5f343b3c33f7fc`. Compared all players, rookie data/narrative, team rows, weights and season input against prior verified snapshot: identical. Final PDF records this source hash.

- Final custom-settings run passes:182pages,1,326rendered ranking rows,707players and11features. Live configurator API confirms finalfingerprint/707rows. DEFAULT source label is explicitly documented as cohort-prior provenance.

## 2026-09-12 canonical review interface and artifact bridge

- Added `scripts/projection-review`: localhost8766 reads an explicit canonical v1 path, validates its hash, serves no-store snapshots and refuses writes. The interface keeps edits in memory, preserves source IDs/evidence/team-note coordinates, separates availability from forecast coverage, shows review history and exports revision-bound patches with reason/evidence. It shows league-neutral category counts, no FPTS/ranks.
- Browser exercise covered all1325players/32teams, rate0, exposure/availability changes and team-note edit/add. Exported fixture passed reconciliation-owned `canonical_review.apply_patch` entirely in memory. No canonical source, DB or publication was changed. Final boundary review prompted stronger UI validation for rates/null exposure/team schedule and forecast-aware count previews.
- Added explicit-revision canonical guide import into a separate DRAFT snapshot. Canonical per-exposure rates use adapter baseline1; original baseline/evidence survive separately.63unavailable forecasts retain null scores/ranks; probability metadata is never reapplied. Stable IDs drive canonical team joins. Existing707-player completed workbook guide and data remain intact.
- Separate canonical PDF:197pages,1262ranked+63unavailable,32teams/706stable-ID slots. Dedicated PDF verifier passed2435displayed scoring rows, selected-weight fingerprint, visible draft/revision labels on every page, navigation and page bounds. Eight original scorer regressions, ten adapter tests and three workbook export tests pass; two read-only HTTP/revision boundary tests and the actual-script UI regression harness pass.
- Extended actual matchup lineage from official player stats through eligible lineups/league rules, SQL and browser actual-score paths, API/cache/poll, exact frontend state and desktop/phone/player-row/league-strip display components. Actual points remain separate from expected-start forecasts. Timing is configured, not a measured SLA. Reconciler owns performance changes and removal of duplicated actual arithmetic.
- Target map makes selected league/scoring revision a shared input to actual and projected points. Derived cache invalidation must follow league switches/settings edits while raw hockey inputs remain reusable. Generic guide default is explicitly selected/labeled; no live league identity is inferred.
- Publication metadata is still unavailable; these canonical artifacts are review drafts. Runtime activation, deployed cache behavior, build19 release and required legacy retirement after migration proof remain the runtime owner's workstream.

- Canonical workbook export verified37tabs,1325FPTS caches against shared scorer,63unavailableblank, all32teamtabs with fullcanonicalnotes and visible scoringidentity/revision. Formula error scan returnedzero; representative roster and notes previews were visually inspected.

- Final preview parity: localhost8765 now uses canonical adapter revision6a71c8db63eb (1325 players), matching8766/editor and finalreviewPDF/XLSX. Added explicit server `--data` and launcher `CITRUS_GUIDE_DATA`; edition/source/selectedweight fingerprints remain visible, null ranks render as dashes. Default scoring fingerprint10ea21e260b75036 verified; custom weights fingerprintfe546a33eddcfb5f matched all1325 sharedscorer rows, preserved651 unavailable, and generated188-page canonical-stamped PDF. Actual UI render harness verified identity and null displays. Original workbook and all immutable exports preserved.

- Published-source refresh: editor8766 uses a verified published-view envelope for source1fb82cffbb61/run73c867f6; scorer8765 and newPDF/XLSX use its exact adapter. All1325scores/ranks/contributions unchanged from6a71,674ranked+651unavailable,706slots.189-pagePDF fullQA and XLSX allformulas/caches/notesQA passed; custompreviewall1325scores matchsharedscorer. Minimal text correction distinguishes local scoring preview from sourcepublication. Both realleague savedsettings preserved; postactivation canonicalcontributions verified once percount. Allpriorartifacts retained. Receipt/map: output/canonical-review/LATEST-REVIEW.json and CURRENT-LINEAGE.md.

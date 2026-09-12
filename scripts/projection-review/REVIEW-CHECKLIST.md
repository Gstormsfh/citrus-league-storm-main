# Canonical review contract checklist

Read-only QA of the canonical review surface. Only this checklist is authored here. No canonical JSON, rates, exposure, notes, guide dataset or implementation was changed. In-memory patch probes below did not write output files.

## Inspected baseline

- Source: `/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/canonical/canonical.json`.
- Review implementation: `/Users/gstorms/.codex/worktrees/4304/citrus/data-pipeline/draftkit/canonical_review.py`; associated canonical_inputs.py defines field vocabulary and numeric handling.
- Validated revision: `1ca49b4864550ccc0db20240df5e1a8a1487b066a3a5e8859bd68771586e5bcd`.
- Actual validated population:1325 unique canonical player identities;32 team records; status counts1262 projected,62 rates_only,1 unresolved. Current directory coverage is1312, a different population. Do not label1325 as all projected.
- Availability:1299 unknown/unknown-authority,16 day_to_day imported_scenario,7 out imported_scenario,2 suspended imported_scenario,1 ltir imported_scenario. Imported scenarios must not render as independently verified current injury news.
- Publication readiness is false. Review/export is not activation or publication; existing blockers must remain visible after edits.
- The current707-player publication source is a separate validated release snapshot. This review UI must not replace it or update the guide automatically.

## Full coverage and identity

- [ ] Fetch the complete source, not a paginated subset. Clear filters returns exactly1325 unique IDs for this revision; changing filters never modifies the underlying array or omits records from downloaded source.
- [ ] All32 team choices exist. Team panel renders lineup slots, unassigned/unresolved rows, special teams, structured notes and ledger. Non-directory retained identities remain reachable by ID/search.
- [ ] Search canonical accents/apostrophes safely; display strings are escaped. Key edits by stable player_id, never display name or rank.
- [ ] Display1262/62/1 forecast-status distinction. Rates-only goalies have no allocated starts/counts; Caleb's unresolved forecast is not a fabricated zero. Zero-volume projected rows remain valid distinct records.
- [ ] Coverage assertions compare exact identity sets, not just counts; current-directory set and all-source set retain their separate meanings.

## Rate, volume and availability semantics

- [ ] Rate editors explicitly say per-game/per-start. Counts are derived rate×used exposure once, not editable totals. Never multiply roster_probability into counts.
- [ ] All original raw basis/provenance/source locators remain accessible. User sees whether current exposure came from workbook override/model prior/unallocated and its probability semantics.
- [ ] Changing availability alone leaves rates, exposure, counts and rank unchanged. Changing a role alone does not pretend measured role conditioning occurred.
- [ ] Projected GP/starts uses nullable numeric state: blank means null where allowed; literal0 stays0. A missing numeric input must never become Number('')=0.
- [ ] Per-player exposure must not exceed that team's schedule; valid fractional starts/GP retain precision. Goalie budget and skater scenario ledger warnings remain, not silently normalized.
- [ ] Verified availability requires meaningful dated evidence. Imported scenario vs unknown vs verified badge is explicit; source/reason/return_window/review_after are independently visible.
- [ ] Metadata-only probabilities and already-in-exposure probabilities cannot be collapsed into a single extra multiplier. Source MODEL ceiling83 is preserved unless an explicitly reasoned supported review changes exposure; season84 is not an automatic replacement.

## Patch schema and immutable source

- [ ] Export shape exactly `{base_revision, reason, evidence, player_updates?, team_updates?}`. Each update uses `{player_id|team, changes}`. Reason is nonempty string; evidence nonempty array of nonempty strings.
- [ ] Allowed player fields:rates,exposure,availability,role,status,rate_policy,exposure_policy. Never patch name/team/ID/counts/source records/revision directly.
- [ ] Nested exposure/availability/role objects merge their allowed members. **Rates replaces the entire dictionary.** UI must export every retained rate key, not only the edited stat. Test editing goals preserves assists,shots,PPP,SHP,hits,blocks,PIM and optional plus_minus exactly.
- [ ] Goalie rate vocabulary is wins,saves,shutouts,goals_against. Skater vocabulary is goals,assists,shots_on_goal,power_play_points,short_handed_points,hits,blocks,penalty_minutes plus optional plus_minus. No negative non-plus_minus rate, nonfinite value, boolean-as-number or numeric string.
- [ ] Exposure.unit/baseline are not editor fields. Explicit manual rate edit causes preserve_override/MANUAL; used exposure edit causes preserve_season_override. Other unrelated policies remain intact.
- [ ] Team notes retain all original records/order/coordinates/source evidence; text editing must be intentional and validated. Appended notes require manual_review authority. Displaying only first-column strings would drop source notes.
- [ ] Team lineup/special-team editors, if exposed, preserve source coordinates and unresolved placeholders and enforce player/team membership. Exporting an empty array by default must never erase source lineup slots.
- [ ] Reset/discard restores in-memory source; patch export neither writes source nor activates a run. Saved downloaded patch remains tied to its original revision.
- [ ] Apply actual UI patch with canonical_review.apply_patch against an in-memory source copy. Confirm source deep equality unchanged, result revision changes, full1325/32 identities remain, review history records reason/evidence/before/changes, counts/ledgers rebuild, publication_ready stays false.

## Revision and server behavior

- [ ] On load expose exact source revision/as-of, and include base_revision in patch. Do not derive independent fantasy/source truth in another editable JSON store.
- [ ] Source changed while reviewing: refresh/reload must warn or preserve old source+patch coherently. Old patch applied to new revision must be rejected, never silently rebased.
- [ ] Tamper source without changing revision: load/apply rejects hash mismatch. Existing output path refuses overwrite; source path may not be used as output.
- [ ] Source endpoint is no-store and rereads current file; stale response must not replace a newer editing session. Non-GET cannot mutate source; no endpoint launches DB calls or writer commands.
- [ ] Server listens only on loopback and rejects unexpected Host headers; no permissive CORS, arbitrary file paths or raw HTML insertion from source notes.
- [ ] Server errors from malformed source/patch are bounded validation errors, not process crashes. Paths/error text should not expose credentials.

## In-memory probes already performed

canonical_review.validate accepted the stated baseline. The following are actionable contract findings, not proposed source changes:

1. Partial `rates:{goals:0.1}` is accepted and replaces8stats with1. This follows current replacement semantics; UI must send the full dictionary. Prefer explicit replacement affordance or backend completeness guard where appropriate.
2. Team `lineup_slots:[]` is accepted, removing the entire imported lineup. Source-note preservation guards do not currently cover lineup coordinates. Do not expose destructive defaults; backend owner should validate intended retention/review semantics.
3. Replacing every existing team note's text with null is accepted while preserving its coordinates. Validate text type and intentional blank policy before exposing note editing.
4. `availability.return_window:{anything:true}` is accepted. Validate nested field types so structured evidence is not accidentally rendered as `[object Object]` or treated as a dated status.
5. `exposure.used:'80'` reaches rebuild and raises TypeError (sum int+str), rather than ContractError. UI must serialize numbers as numbers; canonical owner should reject or normalize numeric strings consistently before arithmetic.

Server draft reviewed as it arrived: GET/api/source checks schema/hash and list shape, serves canonical source directly with no-store; POST rejects405. It does not yet reuse full canonical validator (important distinction: a self-consistent hash does not prove semantic validity). Unexpected Host guard was not present at this first inspection; request loopback Host validation consistent with the existing guide server. UI was not yet present, so UI checklist items are pending rather than claimed passed.

## Meaningful regression bundle after UI arrives

Use actual exported patch payloads, not a hand-constructed mock of the UI implementation: (a) one-rate edit preserving all others; (b) used:null/0/fractional handling; (c) availability-only change leaves counts intact; (d) preserved team note coordinates; (e) stale revision rejection; (f) unsupported direct counts/provenance/name edit rejection; (g) full identity and notes source unchanged. Browser proof additionally covers all-player/all-team filters, mobile table/detail access, imported-scenario labels, evidence requirement, dirty-state reset and error recovery. Do not change the existing validated guide as part of these tests.


## Final independent review checkpoint

- Independently ran projection-review/test_server.py:2tests passed. Tests cover fresh source reread, POST405 and traversal404; source schema/hash helpers also tested. Code now has a localhost/127.0.0.1 Host guard. README correctly distinguishes digest/list checks from authoritative semantic CLI validation.
- UI code sends a full rates map for one-rate edits, keeps original source copy and edits a separate in-memory draft, keys patch records by stableID, preserves team note coordinates, and re-fetches revision before download. Primary reports a browser-exported fixture passed canonical apply_patch in memory; that browser evidence is owner-reported, not independently rerun here.
- Network/convergence diagrams inspected: earned actuals have no projection-rate/goalie-probability edge; target actual and forecast scorers share selected league/scoring identity; target/not-deployed boundary is explicit. All local links in these two documents resolve at this checkpoint.
- Canonical owner reports earlier backend hardening complete. Do not interpret the initial probes as unresolved current backend defects without rerunning; the following newly probed UI/CLI mismatch is still actionable at inspection.

### Remaining UI validation alignment reported to primary

UI validate currently accepts null rate, null exposure on a projected player, and exposure85 against schedule84. All three corresponding patches were independently rejected by the current canonical CLI with ContractError. Download must be blocked with field-specific feedback instead of letting user discover this later. Numeric-rate blanks are not nullable rate values; nullable exposure must respect forecast status.

Counts preview multiplies rates×used without checking forecast status. A rates_only player edited to positive exposure still has canonical counts=null unless a supported status transition is included; preview must remain unavailable or explicitly show a hypothetical calculation. Availability source objects are displayed through string coercion, producing [object Object]; preserve structured display/edit semantics rather than unknowingly replacing object evidence with arbitrary text.

No canonical source, patch output, guide dataset or runtime file changed during these checks.

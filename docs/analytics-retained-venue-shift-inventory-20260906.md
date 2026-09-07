# Retained venue and on-ice source inventory

Read-only local inventory; no network or database operations. Numeric sample
results below came from the 100 exact PBP paths/hash checks retained in
`scripts/proof/results/penalty-source-audit-20260906-systematic100/report.json`.
That prior proof additionally records 8,726 eligible shots, 44,972 independent
annotation comparisons and 300 prefix/current-goal checks.

| Source / provider | Retained evidence and measured scope | Recovery boundary |
|---|---|---|
| NHL API-web frozen PBP | `historical-official-freeze-20260906/{season}/pbp/{game}.body.json`, with individual receipts and movement replay hashes. All 100 sampled games have `venue.default` and `rosterSpots`; 36 distinct venue names. None has `venueId` or `venue.id`; none of their event-detail keys explicitly names on-ice membership. | Venue labels are real retained inputs, not durable physical IDs. Resolve renames/relocations/shared venues with effective dates before fitting rink corrections. Roster membership is not shot-time ice membership. Counts are sampled, not full freeze coverage. |
| NHL official PL HTML event reports | `historical-feature-reports-20260906/request-inventory.json`, `health.json`, `{game}.receipt.json`, `{game}-PL.HTM`. Health reports 2,713 requested/captured attempts: 1,956 `captured_header_verified`, 757 unavailable; overall incomplete. Example `2018020059-PL.HTM` lines 160–161 explicitly labels `L.A On Ice` / `OTT On Ice`. | Existing retained HTML can supply per-event on-ice player lists after exact row/sweater/team joining. Header verification does not validate those membership cells. Audit successful bodies independently; preserve failed bodies, never treat them as empty lineups. |
| Existing PL parser/join | `projections/report_feature_source.py` and `report_feature_source_v2.py` parse event actor/sweater and join `rosterSpots` by team/player/sweater. | Current code does not parse the report's on-ice membership columns. New separate parser/schema needed; do not modify frozen original feature reports or pretend current row matches validate all new columns. |
| NHL JSON shiftcharts | `acquisition/ingest_shiftcharts.py`: provider `https://api.nhle.com/stats/rest/en/shiftcharts`; filters actual shift records (`typeCode=517`) and maps player/team/game/period/start/end/duration. `acquisition/backfill_shifts.py` is a separate existing recovery path. | Provider integration already exists; this audit did not execute it. No shift-named interval receipts or bodies found in the bounded `scripts/proof/results` filename inventory. Database interval availability is unqueried, not declared absent. |
| NHL TV / TH HTML shift reports | `acquisition/backfill_shifts_html.py`: provider `https://www.nhl.com/scores/htmlreports/{season}/TV{code}.HTM` and `TH{code}.HTM`; resolves sweater/team identities with game rosters. | No retained TV/TH-named shift report files found in the bounded proof-results inventory. Source comments claiming historic coverage are not freshly verified coverage. Do not infer lack of underlying data from lack of local receipts. |
| Official aggregate TOI | `toi-stored-20260906/manifest.json` and parts; columns are season/player/game/is_goalie/nhl_toi_seconds. Existing `analytics-toi-replay-proof-20260906.json` validates aggregate exposure with a withheld mismatch. | Useful independent interval-sum reconciliation target, not a source of shift starts or exact shot-time membership. |

## Concrete next recovery order

1. Parse on-ice columns from already-retained, successful PL bodies into a new
   create-only exact-event membership artifact. Require roster disambiguation,
   explicit home/away labels, unique player IDs, row order and timestamp checks;
   retain unknown/malformed cells without dropping their shot rows. Measure
   completeness before trying an on-ice-context ablation.
2. Inventory actual existing interval storage through a separately authorized
   read-only snapshot when in scope; freeze exact raw interval rows and receipts.
   Do not start new downloads simply because this local proof inventory lacks
   intervals. Reconcile interval sums with aggregate official TOI and membership
   at selected PL events. Sparse PL observations alone cannot identify all shift
   boundaries or duration since last player change.
3. Produce a full frozen-game venue-label inventory and dated alias review.
   Existing labels allow progress now; stable physical identity must be explicit
   before the venue becomes a grouping key for fitted rink transforms.

No tracking-data claim follows from any of these sources. Per-event membership
does not measure player/goalie coordinates, pass reception, screens or fatigue.
No existing sources, model bytes, scripts or production state were changed.

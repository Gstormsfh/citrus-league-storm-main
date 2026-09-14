# Position governance process audit

Audit boundary: primary identity and fantasy positional eligibility. No forecast rates, roles, clubs, injury/IR policy, ownership or native changes.

## Verified source-priority failure

At 2026-09-14T00:52:37Z ordinary curl requests to the ingestion endpoints returned HTTP200, after redirecting `current` to `20262027`:

| Endpoint | Exact player | Raw positionCode | Response SHA256 |
|---|---|---|---|
| https://api-web.nhle.com/v1/roster/LAK/current | Mats Zuccarello8475692 | C | cae13a9416d2754a525721f39f5e2edb3284050e29b49bb5addfb3d8e8df79f4 |
| https://api-web.nhle.com/v1/roster/COL/current | Jaden Schwartz8475768 | C | 86b434016ee7c824e2f09c80386e3928ebb19b4634743a29971c485562b476b8 |

Body IDs, names and birthdates match. HTTPDate is September14 UTC; season is explicit in the redirect, not inferred from a team label. The retained September13 roster capture also has C/C. Raw JSON and headers are retained in the audit output under `official-*-current.*` and `official-current-roster-receipts.json`. The earlier urllib403 and browser client-block did not establish an NHL value; the successful ordinary curl response does.

The two original events cited only undated NHLPA profiles. That comparison was insufficient to replace the NHL baseline. Historical RW/LW reporting can inform a separately approved fantasy eligibility decision; it does not prove the current NHL response is a parsing error. No C→RW/LW parser bug was found.

## Current process and target

Current: NHL roster/current → `populate_player_directory.py` raw directory → latest primary event overlay → current directory → shared eligibility reader → API/web slots and displays. Legacy `sync_rosters.py` can separately replace raw eligible_positions from listed-position counts.

Required: retained exact-ID NHL response with season/time/hash → raw baseline → explicit owner-reviewed primary override or return-to-feed event → protected owner secondary additions → one normalized effective position set → API, display and server slot checks. Third-party disagreement enters review, never automatic preference. Automated secondary sourcing is future work.

## Checks and gaps

| Area | Result |
|---|---|
| Normal ingestion | Verified `.github/workflows/refresh-player-directory.yml` invokes `scripts/utilities/populate_player_directory.py`. Existing-row refresh reads positionCode/position and only converts L/R to LW/RW. Sep13 run34759454624 refreshed COL2026 at13:19:41 and LAK2026 at13:19:44, matching raw update times. |
| Original C lineage | Latest response and retained capture affirm C. No per-field retained payload proves the first historical C write. This is not evidence of a default/parser defect. |
| Source priority | Failed in the manual correction operation, not an automatic NHLPA integration. Corrected operational policy requires NHL comparison and explicit owner exception. |
| Raw provenance/staleness | Gap: routine ingestion does not retain each raw position response or per-field timestamps. source_last_fetched_at can remain old while the cheap roster refresh changes position. No production disagreement/age monitor verified. |
| Primary protection | Existing append-only events survive ingestion; RLS blocks client writes. New restore_feed action preserves history while following subsequent official feed changes. |
| Secondary protection | Gap: approved manual policy has no protected secondary event store/resolver. Direct raw-cell editing is not protected. Legacy five-game/max-three listing logic remains code, not an industry rule or approved automatic role detector. No automatic grants authorized. |
| Downstream consistency | PR487 shared union/normalization, goalie-family separation, filters, labels and maximum slot matching tested; server enforcement uses the same predicate. No production multi-position record exists, so synthetic regressions do not establish live granted eligibility. |
| Cache | PlayerService uses a two-minute cache; fresh reads/reload required after an event. A data change does not update old bundled native JavaScript. |
| Reversal | New restore_feed event avoids deleting audit history or pinning C permanently. Fresh roster-impact gate must pass; Zuccarello's pre-existing RW starter is a known conflict, pending owner decision. Schwartz has no active slots at audit. |
| Tests | Actual migrations tested in PGlite: protected override, family guard, future event handling, permissions, historical preservation, return-to-feed, and a later feed change flowing through after restoration. |

No assertion that the whole process is complete: protected manual secondary inputs, raw-field provenance retention and conflict/staleness detection remain concrete gaps. Do not activate an automatic eligibility source as part of this audit.

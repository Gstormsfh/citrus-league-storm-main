# Current player affiliation and card availability

Current club identity reads `player_current_directory` for the projections season. Actual statistics retain their metrics/game season; fantasy ownership remains in roster_assignments. `projection_team` is the immutable scenario club and never supplies a missing current club.

Reviewed current affiliations are append-only `player_affiliation_events`, inserted only through a trusted service/operator context. A correction inserts a new event with `supersedes` pointing to the previous event; it does not update or delete history. Record the primary source URL, actual evidence date, specific reason, reviewer and raw feed team seen during review. Missing evidence means unknown; FA is not evidence of free agency. An organization contract/camp appearance does not establish an NHL lineup role.

The September 13 ledger resolves 20 discrepancies: 8 affiliated, 7 unsigned free agents, 3 retired, 1 AHL-only contract and 1 unconfirmed (Matt Dumba). Chris Kreider's September 12 Montreal signing supersedes both the retained FA scenario and stale Anaheim feed. All 1,325 published players have effective identities. The 1,435-row current identity population also preserves historical players who may remain on fantasy rosters; an absent current feed row never carries an old club forward.

The daily directory refresh runs `scripts/utilities/check_player_affiliations.py`. It emits an affirmative JSON health report and workflow summary. A missing/ineffective reviewed event or a new feed club that differs from both the reviewed club and the feed observed during review fails the job for review. Expected stale-feed disagreements are reported separately. The raw feed never silently replaces a reviewed event. Feed-only rows have no transaction evidence date; bio-fetch and database-write timestamps are not relabeled as factual observations.

Local rollback SQL covers current overrides, missing feed identities, retirement supersession, historical preservation and grants. Live post-application checks matched these pre-application fingerprints:

- Projection payload: `aba7094278dbd5424f8c833225de3f2a`
- Fantasy membership: `f9c07a136c79aa126a1e3efae408f52a`
- Scoring settings: `cf34144c8f657ae2e2840d2c5bde6cc8`
- Historical directory: `441fd02de5521be69ebccf906bc3360e`

A live single-player governed lookup took 1.843 ms execution after predicate pushdown optimization. Bulk reads remain paginated behind the existing two-minute server cache and shared in-flight request. This is query evidence, not a draft-night load-test claim.

## Availability and IR

Card explanations read published, dated per-player availability evidence. The complete September 13 injury set is 13 players (10 OUT, 2 INJ, 1 LTIR), including 11 owner-adopted baseline records and 2 reviewed reports. The explanation displays the complete reason and labels historical workload assumptions separately from current return timing. No medical dates or IR eligibility are inferred from workload.

Finalsz has two standard IR slots. On September 13 the user explicitly authorized fresh manual/reviewed IR, LTIR, OUT and INJ as eligible for fantasy IR. The shared `isFantasyIrEligible` resolver drives server placement validation, the API flag and the periodically refreshed roster move controls. Healthy, unknown, DTD and suspended status do not qualify. Expired evidence and projection-only workload scenarios do not qualify. Slot counts, ownership checks and game locks remain enforced; no IR+ slot type or league settings were added.

All 13 current injury records qualify under that explicit fantasy policy, including the owner-adopted baseline records. The retained source reasons may describe the earlier absence of an eligibility decision; the card now separately states the current fantasy policy. No official NHL designation or medical fact was invented. Existing IR occupants remain tolerated after activation so they can be moved out; failed eligibility/history reads refuse unverified placement. Tests verify all four statuses through manual and reported evidence, persistence, live status clears/expiry, noneligible status rejection and capacity. No production roster moves were performed for QA.

## Remote refresh and build boundary

The player index refreshes visible clients every two minutes and on stale foreground use, with a two-minute server cache. These can compound; this is bounded polling, not instant push. Published revision changes invalidate canonical snapshots and prevent mixed revision projections/context. Open-card server writeups poll every 60 seconds and re-fetch on news, scoring, league or canonical revision changes; late responses from the previous context are discarded. The server rebuilds prose from current inputs. Tests change returned data in an already mounted client; no fake production injury update is used.

Affiliation events, published availability, news, workload and league scoring can update remotely once the client supports the corresponding API fields/refresh paths. New client rendering and move-affordance code requires a web deployment or native build. Existing native Build 18 does not acquire newly bundled code from a server deployment.

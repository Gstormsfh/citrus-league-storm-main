# Matchup and Roster loading audit — 14 September 2026

The measured problem is request sequencing and payload volume, not a demonstrated missing roster index. The largest avoidable request is Roster's full dashboard index: approximately 22.14 MB to maintain IR affordances. About 18.9 MB of that index is repeated per-team canonical notes. The complete dashboard contract remains useful to cards and draft tools; Roster only needs current availability for its own players.

## Production observations before these changes

Normal navigation used the existing authenticated Finalsz and Test night 9th leagues. No picks, trades, ownership, lineup or league-setting actions were invoked. The pages themselves call normal maintenance endpoints. Captured explicit maintenance responses reported zero initialized/backfilled/locked rows; daily-scores also persists derived explanation lines. These are ordinary page-view observations, not a claim that every underlying request is a read-only transaction.

| Navigation | Visible lineup observed | API requests observed by that point |
|---|---:|---:|
| Finalsz Roster, existing application caches | 3.323 s | 35 |
| Finalsz Roster, application reload | 2.300 s | 40 |
| Finalsz Matchup, existing application caches | 5.017 s | 39 |
| Test night 9th Matchup, application navigation | 5.055 s | 51 |

These are individual desktop Chrome observations, with 250 ms DOM sampling, ordinary network/server cache variability, and background requests included. A visible player is not proof that every projection or enrichment has settled. They are not native measurements, a statistical benchmark, or evidence that cold loading is faster than warm loading. Invalid/interrupted timing attempts were excluded. The website served index-CVDZ6BKQ.js during the observations.

The Roster dashboard-index request transferred 22,140,179 and 22,139,466 encoded bytes in the two samples, taking 2.589 and 1.931 seconds. A cold Roster load also started the provisional guest/demo branch before authentication settled, then loaded Finalsz; this caused unnecessary demo requests and three subsequent authenticated demo requests returning 403.

Matchup's main path remains league/team/week validation → ensure-rosters → player IDs → enriched players → lineups and stats/projections → daily scores/records → saved week rosters and missing-player recovery. Observed by-IDs requests took roughly 0.53–0.71 seconds, daily scores 0.58–0.64 seconds, and frozen-roster batches 0.74–0.93 seconds. Several stages include multiple serial PostgREST round trips.

## Database evidence

Production EXPLAIN ANALYZE SELECT used existing indexes. No index or schema optimization was applied as a result of this audit.

| Representative SELECT | Rows | PostgreSQL execution |
|---|---:|---:|
| One-team roster | 21 | 1.743 ms |
| Week-1 frozen roster | 287 | 1.994 ms |
| Test league week-1 joined matchups | 2 | 1.709 ms |
| Latest team lineup | 1 | 0.713 ms |
| 57 player IDs through current directory | 57 | 10.753 ms |
| Daily projections | 41 | 36.686 ms initial / 0.785 ms warm |

The privileged audit connection excludes browser/PostgREST transport and caller RLS overhead. Cumulative production statement statistics support the distinction: active frozen-roster reads averaged 1.78 ms over 232 calls; backfill existence checks averaged 0.36 ms over 566 calls. Those statistics span multiple releases.

The full current-directory view costs more: a warm first-page query took 103.697 ms. A standalone direct-field comparison reduced that to 45.521 ms with zero selected-field differences across 1,453 rows. Replacing the entire view requires broader all-column, identity fallback and RLS validation; it is not part of this change.

## Bounded corrections

- Roster waits for authentication and the signed-in user's league context before starting a load. Resolved guests still receive the demo path.
- Roster starts transactions after validating the team/league/completed draft, overlaps roster-ID/player work, and consumes the result at its original state/error boundary.
- Player by-IDs enrichment starts its canonical availability read alongside stats/talent/GSAx, after directory success. It reuses that captured result once; publication guards, cache identity, failure fallback and response mapping remain unchanged.
- Roster IR evidence is refreshed for its roster IDs, without downloading the full dashboard index. Current healthy/unknown/expired evidence must continue to override stale roster flags; source freshness cannot be traded for payload savings.
- Dashboard JSON transport compression is limited to that authenticated endpoint. Clients receive the same decoded contract; unrelated streams are outside this change.

Deferred/fake-clock tests establish dependency overlap and result/error parity. They do not establish production speedup: a representative by-IDs fixture changes 450 → 300 ms; the independent transaction fixture changes 1,500 → 900 ms. Production acceptance and exact native build receipts are recorded separately after deployment.

## Retained correctness and remaining work

Daily-scores cannot be moved earlier merely because its HTTP method is GET: it backfills and persists derived lines. Saved roster hydration, live scores, custom scoring, signed/zero values, expected goalie exposure, IR rules, and route cancellation boundaries must remain intact.

The second seven-day projection batch follows recovery of additional saved-roster players. It requests an expanded ID set and is needed for their coverage. Build 18's date-only cache could suppress that necessary update; restoring that cache would be a correctness regression. A future per-player/date cache would need publication identity, expiry and in-flight coverage tests before replacing these requests.

Remaining significant work includes consolidating the server's maintenance/read stages and reducing repeated team-note representation in the dashboard's versioned contract. This audit does not establish that the pages are as fast as possible.

## Native evidence

The actual Build 18 archive was inspected at `~/Library/Developer/Xcode/Archives/2026-09-11/App 2026-09-11, 8.19 PM.xcarchive`. Its plist confirms 1.0 (18); its exact Git SHA is unestablished. Roster-CoTmKqC-.js contains the eager full-player request and serial transaction wait. Matchup-C12II86e.js uses the older date-only projection cache. Hashes match the existing build18-cutover-compatibility-20260912.md receipt.

Build 19/current code already includes prior navigation overlap, route lifetime and projection semantics corrections. Build 20 must be freshly built from the final merged performance/audit source to include the new client changes. Native installation/launch alone does not prove interactive matchup, roster or draft acceptance.

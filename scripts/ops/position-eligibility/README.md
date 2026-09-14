# Position eligibility review — 2026-09-13

PR487 merged as `0bfd7dfc0e686bf4b0f92c20cf8e980b70a4b609`. The propagation patch reads existing primary plus secondary evidence consistently. The primary-correction migration and reviewed two-player SQL were **applied to production on 2026-09-13 at 23:19 UTC**. No secondary eligibility was granted and no forecasts were modified. See [the activation receipt](activation-receipt.md). Web/API deployment is tracked separately from database activation.

## Source priority audit — 2026-09-14 UTC

The original two NHLPA-derived primary corrections were a source-priority error. Fresh HTTP200 NHL roster responses at 00:52:37 UTC explicitly report `positionCode: C` for Zuccarello8475692 and Schwartz8475768. `/roster/LAK/current` and `/roster/COL/current` redirect to the exact `20262027` season. NHLPA and historical wing reports do not authorize replacing that official baseline. The original events and activation receipt remain historical evidence, not current source-preference guidance. See [the process audit](process-audit.md).

NHL official roster/landing data is the primary identity baseline. A conflicting third-party profile is a review signal only. A primary override requires an explicit owner decision plus a recorded comparison with the exact-ID official response, season, capture time and body hash. Manual secondary eligibility is a separate owner decision and must not be inferred from a primary conflict. Return to the feed uses an append-only `restore_feed` event; it must not delete history or pin today's feed value as a new manual primary. Every correction/revocation requires fresh starter and daily-roster impact review.

## Live read-only evidence

Production `player_current_directory`, season 2026: 1,453 identities, 1,391 NULL eligibility cells, 62 non-NULL cells, **zero multi-position cells**. This supersedes the earlier saved 1,435-row snapshot.

`player_game_stats` has 55,913 rows/1,046 players for 2024 and 55,758 rows/1,063 players for 2025, with no NULL/invalid listed position codes. The date ranges include playoffs. Restricting 2025 to regular-season NHL game IDs (type `02`) gives **zero players with multiple distinct listed positions**. 1,050 current directory identities have that prior-season regular evidence. Complete static listing coverage is not demonstrated positional-role or positional-minute coverage.

Comparing those listings with 2026 primaries flags 8, 7, 6 and 6 players at 3, 5, 10 and 20 listed games respectively. These are discrepancy-review counts, **not eligibility grants**. The current sync uses five listing rows and a maximum of three entries, without a regular/playoff distinction. This patch changes only its unsupported Yahoo attribution, not that production rule.

## All seven five-game discrepancies

Current primary means the Citrus 2026 read at review; historical listing counts are 2025 regular-season distinct games. None establishes dual eligibility by itself.

| Player (NHL ID) | Citrus / historical listing | Authoritative evidence checked | Disposition |
|---|---|---|---|
| Brandon Duhaime (8479520) | RW / LW, 82 | [NHLPA lists LW](https://www.nhlpa.com/player/392/brandon-duhaime/); [NHL July 29 preview lists RW](https://www.nhl.com/news/toronto-maple-leafs-roster-changes-for-2026-27-season) | Conflicting current sources. Retain pending role review; no automatic LW grant. |
| Victor Olofsson (8478109) | RW / LW, 78 | [NHLPA lists LW](https://www.nhlpa.com/player/716/victor-olofsson/) | Additional primary-correction candidate; current club/role and roster-impact review still required. Outside the two-player activation operation. |
| Jonathan Marchessault (8476539) | C / RW, 62 | [NHLPA lists RW](https://www.nhlpa.com/player/612/jonathan-marchessault/); [NHL media profile labels C](https://media.d3.nhle.com/image/private/t_document/prd/cbwciv7kaaub49e7xdi8.pdf) | Conflicting authoritative labels; no presumed C/RW grant or primary write. |
| Mats Zuccarello (8475692) | C / RW, 59 | [Current NHLPA profile: RW](https://www.nhlpa.com/player/701/mats-zuccarello/) | Applied C→RW primary correction. One fantasy owner, already saved at RW; no future daily rows. |
| Jaden Schwartz (8475768) | C / LW, 50 | [Current NHLPA profile: LW](https://www.nhlpa.com/player/742/jaden-schwartz/) | Applied C→LW primary correction. Unowned; no saved/future active rows. |
| Cole Schwindt (8481655) | C / RW, 29 | [Panthers April 4 report identifies center role](https://www.nhl.com/panthers/news/he-wants-to-finish-strong-schwindt-to-return-vs-penguins); [January 29 playing roster lists R](https://www.nhl.com/scores/htmlreports/20252026/RO020852.HTM) | Current C has actual role support; RW listing does not establish current dual eligibility. Review role evidence separately. |
| Patrik Laine (8479339) | RW / LW, 5 | [NHLPA lists LW](https://www.nhlpa.com/player/13/patrik-laine/); [NHL playoff preview identifies RW](https://www.nhl.com/news/montreal-canadiens-2026-stanley-cup-playoff-roster-at-a-glance) | Conflicting current labels. No primary write or automatic LW grant. |

This is a bounded seven-player discrepancy audit, not a manual role audit of all NHL players. Source disagreement is explicit; a third-party profile is not used to break a tie.

## Approved manual policy and implementation boundary

Owner decision on 2026-09-13: maintain secondary eligibility manually, with protected owner records and audit/provenance, until a reliable role/appearance process is available. Do not grant secondary positions automatically from game-count thresholds. Each concrete addition still needs the approved player, season, position and supporting record; this policy approval itself grants no positions.

Implementation is incomplete for secondary records: `player_position_events` protects primary corrections only. The existing roster sync still computes listing-based secondary cells and can replace `eligible_positions`, including with a single primary. Directly editing that raw field is therefore not a protected manual workflow. A secondary event store/resolver and sync protection remain required before claiming the approved policy is enforced in production. No migration, sync behavior or player eligibility changed in this documentation-only audit.

## Evidence requirements for manual review

Adopt reviewed eligibility events, not automatic thresholds over this static feed. First correct independently verified primaries. For secondary additions require a dated official lineup/role statement or reviewed game-role evidence that actually distinguishes C/LW/RW/D. Record the player ID, effective season/date, added position, source URL, observation dates/game IDs, reviewer, reason and superseded event. A starting lineup label, faceoff count or shift interval alone does not prove positional minutes.

Maintained secondary events should be separate from raw feed cells; resolution unions validated approved additions with the governed primary, keeping goalie/skater domains separate. In-season removals need explicit impact review; sync must not erase owner-maintained records. The necessary next input is **an approved set of dated role evidence and the season carry-forward/removal policy**, or a licensed role feed with a documented schema and coverage audit. A numerical threshold can be chosen only after that evidence distinguishes role changes. Yahoo's [official NHL policy](https://help.yahoo.com/kb/SLN7058.html) and ESPN's [position policy](https://support.espn.com/hc/en-us/articles/360054126392-Position-Eligibility) do not supply a numeric NHL threshold for Citrus to copy.

The new migration protects **primary corrections only**. It does not yet implement the proposed maintained-secondary event store, and no unsupported secondary records are seeded.

## Concrete primary correction operation

1. Applied `supabase/migrations/20260913231943_governed_primary_position_corrections.sql`: append-only `player_position_events`, RLS SELECT for authenticated global identity readers, service-only INSERT, no service UPDATE/DELETE, latest effective event overlay in `player_current_directory`. The view retains raw secondary evidence, current clubs and projection payloads. A goalie row cannot receive a skater override. Season/player/indexed lookup keeps the existing filtered identity read.
2. Applied `reviewed-primary-corrections.sql`: two evidence inserts only, Zuccarello C→RW and Schwartz C→LW. A bounded transaction locks relevant source/lineup tables, verifies the reviewed preimage, and rejects newly incompatible current/future active slots. No roster or projection records are updated. Re-running after application fails its preimage gate, requiring a fresh receipt rather than a blind retry.
3. The identity publisher delegated this reviewed database activation to the eligibility owner. The identity publisher retains canonical projection publication ownership; API cache refresh follows the production deployment. Do not mutate canonical role/rate/team fields. Re-read effective directory, roster slots and API output after activation. Raw feed position may remain C by design; the audited current identity is the override.

The reviewed impact contains no C-slot conflict. Historical frozen rosters remain unchanged. Reverting a primary correction uses another reviewed event, not deleting audit history. Monitor source/override disagreements and age of the last reviewed position so ingestion drift is visible.

## Native and release boundary

Compared exact signed Build 19 source `af576c3c083d4d3a8c2c0cd07d8ee1329009b6c9`. Its Free Agents, player filters, draft depth chart and adapters still contain the old bundled JavaScript. Capacitor ships `apps/web/dist` (`webDir: dist`). API/identity rollout can change returned data but cannot replace those client consumers. These UI fixes require a rebuilt, signed candidate binary. No Build 18 change, archive, submission or upload was performed. The local web build is compilation evidence, not native certification.

## Validation

Shared unit suite: 482 tests. Targeted server suite: 232 tests, including IR eligibility and locked changes. Web draft/roster/free-agent/player/matchup/Best Ball regression selection: 607 tests, plus targeted service/header/preload regressions. Guide suite: 42 tests; synthetic C/LW and C/LW/RW PDF board rendered and visually checked with sufficient position-column width. Web/server/shared typechecks and web production build passed. `node --test scripts/ops/position-eligibility/primary-overrides.test.mjs` applies the actual migration in PGlite and verifies feed overwrite resistance, future-event handling, family protection, access rules, atomic correction rejection on an incompatible C slot, and unchanged roster slots after the accepted correction.

The two reviewed primary corrections were executed after merge and fresh draft-freeze and roster-impact checks. No live draft pick, roster transaction, threshold change or secondary grant was executed. Autopick preference policy remains owned by PR486; it is not converted into a hard eligibility constraint.

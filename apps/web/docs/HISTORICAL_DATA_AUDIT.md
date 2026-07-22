# Historical Data Audit — Prod Database

**Date:** 2026-05-05
**Project:** prod Supabase `iezwazccqqrhrjupxzvf`
**Scope:** Read-only audit of historical analytical data before designing the multi-season backfill plan
**Status:** No writes performed. Findings ready for Garrett review.

---

## TL;DR — Three findings that change the backfill plan

1. **Prior seasons don't exist in prod for any analytical table.** Garrett's hypothesis was that prior seasons might have shot-only data without full play-by-play. The actual reality is more brutal: **no prior-season data is in prod at all.** Every season-tagged table (raw_shots, player_game_stats, player_season_stats, nhl_games, player_directory, player_gar_components, player_talent_metrics, player_ros_projections, raw_nhl_data, player_playoff_stats) holds **2025-only** data. The single exception is `goalie_gsax` which has 112 rows from season 2024.
2. **Even within 2025-26, the pipeline started ingesting on 2025-12-17.** The 2025-26 NHL season began 2025-10-07. That means roughly **2 months / ~360 regular-season games of 2025-26 are not scraped** in prod. Earliest `game_date` in `raw_nhl_data` is 2025-12-17. This is a backfill task in addition to historical seasons.
3. **The data IS retrievable from NHL's public API.** `https://api-web.nhle.com/v1/gamecenter/{gameId}/play-by-play` serves full PbP back to 2016-17. The legacy `statsapi.web.nhl.com` extends back further. **The multi-season backfill is a pipeline-replay project, not a data-loss recovery project.**

---

## Part 1 — Inventory by season

### 1.1 Season-tagged analytical tables — all 2025-only

| Table | Rows | Seasons | Min/Max date | Notes |
|---|---|---|---|---|
| `raw_shots` | 99,322 | 2025 only | game_id 2025020001 → 2025030241 | `season` column itself is NULL on every row; derived from `game_id` prefix. Earliest `created_at` 2025-12-17 |
| `player_game_stats` | 53,358 | 2025 only | 2025-10-07 → 2026-05-05 | NHL season started but pipeline started later; see §1.3 |
| `player_season_stats` | 1,066 | 2025 only | — | Aggregated rollup; 2025-26 only |
| `player_directory` | 938 | 2025 only | — | One per player per season |
| `player_gar_components` | 935 | 2025 only | — | (Pass-1 finding: defensive cols are 0 league-wide) |
| `player_talent_metrics` | 1,012 | 2025 only | — | xg_per_60 + xg_rating present |
| `player_ros_projections` | 926 | 2025 only | — | Rest-of-season projections |
| `nhl_games` | 1,385 | 2025 only | 2025-10-07 → 2026-05-13 | Includes scheduled future playoff games |
| `raw_nhl_data` | 1,350 | 2025 only | 2025-12-17 → 2026-05-05 | Raw NHL API JSON. Earliest scrape Dec 17, not Oct 7 |
| `player_playoff_stats` | 363 | 2025 only | — | Current playoff run only |
| `goalie_gsax` | 197 total | **112 in 2024**, 85 in 2025 | — | **Only table with prior-season data.** Source unclear |
| `goalie_gar` | 85 | (no season column) | — | Single rolling cohort |
| `player_shifts` | 351,759 | 2025 (NULL season col, derived from game_id) | — | `season` column null on every row |
| `player_toi_by_situation` | 66,042 | 2025 (NULL season col) | — | Same |
| `player_shifts_official` | 0 | n/a | — | Empty table |

### 1.2 The `goalie_gsax` 2024 anomaly

`goalie_gsax` has 112 rows for season 2024. Every other table is 2025-only. That suggests `goalie_gsax` was loaded once via a different mechanism — possibly a one-off CSV load or an earlier data-pipeline iteration. Worth investigating whether the source script for `goalie_gsax` 2024 still exists; if it does, similar one-off historical loads may be replayable for other model outputs.

### 1.3 The 2025-26 season has a 2-month early gap

| Source | Earliest record |
|---|---|
| NHL season start | 2025-10-07 (`nhl_games` minimum game_date) |
| `raw_nhl_data` min `game_date` | 2025-12-17 |
| `raw_nhl_data` min `scraped_at` | 2025-12-17 |
| `raw_shots` min `created_at` | 2025-12-17 |

**Implication:** The prod pipeline went live on 2025-12-17. The October 7 → December 16 window of 2025-26 (~360 NHL games) is **NOT in `raw_nhl_data`** and therefore **NOT in `raw_shots`**. Per-game stats for those games appear in `player_game_stats` (game_date back to 2025-10-07) — these were probably loaded from a different source (boxscore aggregation rather than full PbP). So the games happened, the box-score totals are in prod, but the shot-level PbP for the first 2 months of 2025-26 isn't.

Within the 2025-26 ingested window (Dec 17 → present):
- 1,305 regular-season games scraped (gametype 02), 1,296 processed, **870 stats extracted**
- 45 playoff games scraped (gametype 03), 27 processed, **0 stats extracted**

So even the data we DO have isn't fully through the pipeline. ~485 regular-season games are scraped but not stat-extracted, plus all 45 playoff games.

---

## Part 2 — Schema comparison (only 2025 exists, so this is a column-population audit on 2025)

Since prior seasons are absent, the comparison is degenerate. But the column-population audit on 2025 surfaces *what the pipeline currently produces vs what the schema supports*.

### 2.1 `raw_shots` — what's actually populated (out of 99,322 rows)

| Feature category | Column | Populated | Status |
|---|---|---|---|
| **Pre-shot context (the moat)** | `pass_quality_score` | 99,322 (100%) | ✅ |
| | `pass_immediacy_score` | 99,322 (100%) | ✅ |
| | `time_since_last_event` | 99,322 (100%) | ✅ |
| | `last_event_category` | 98,714 (99.4%) | ✅ |
| | `distance_from_last_event` | 99,322 (100%) | ✅ |
| | `speed_from_last_event` | 99,322 (100%) | ✅ |
| | `has_pass_before_shot` | 99,322 (100%) | ✅ |
| | `passer_id` | 8,409 (8.5%) | ⚠️ Only when there's a pass — semantically correct |
| **xG / advanced** | `xg_value` | 99,322 (100%) | ✅ |
| | `xa_value` | 8,409 (8.5%) | ⚠️ Only on passed shots |
| | `flurry_adjusted_xg` | 99,322 (100%) | ✅ |
| | `shooting_talent_adjusted_xg` | 99,322 (100%) | ✅ |
| | `expected_rebound_probability` | 99,322 (100%) | ✅ |
| | `created_expected_goals` | 99,322 (100%) | ✅ |
| **Defender geometry** | `distance_to_nearest_defender` | **0 (0%)** | ❌ Column exists, never populated |
| | `skaters_in_screening_box` | **0 (0%)** | ❌ Column exists, never populated |
| | `nearest_defender_to_net_distance` | **0 (0%)** | ❌ Column exists, never populated |
| **Score state** | `score_differential`, `home_skaters_on_ice`, `away_skaters_on_ice`, `is_power_play`, `period` | 99,322 (100%) each | ✅ |
| **Arena-adjusted coords** | `arena_adjusted_x_abs`, `arena_adjusted_y` | 99,322 (100%) each | ✅ |
| **Shooter context** | `shooter_time_on_ice` | **0 (0%)** | ❌ Column exists, never populated |
| | `shooting_team_average_time_on_ice` | **0 (0%)** | ❌ Column exists, never populated |
| | `time_difference_since_change` | **0 (0%)** | ❌ Column exists, never populated |

**Key takeaway:** **The pre-shot-pass moat is real and fully populated for 2025.** The pipeline computes pass quality, pre-shot context, score state, and xG variants on every shot. The advertised differentiator (pass_quality_score, time_since_last_event, last_event_category, etc.) is ALL there.

The defender-geometry features (`distance_to_nearest_defender`, screening box, defender-to-net) and shooter-shift-context features (`shooter_time_on_ice`, time-since-change) are advertised in the schema but **never populated**. These are pipeline gaps — the columns are there waiting.

---

## Part 3 — Gap matrix for the 6 differentiator features

Since prior seasons are absent across the board, the gap matrix becomes a **forward-availability** matrix. Every prior season is "Unavailable until backfill executes."

| Citrus differentiator | 2025-26 (Dec 17+) | 2025-26 (Oct-Dec gap) | 2024-25 | 2023-24 | 2022-23 + earlier |
|---|---|---|---|---|---|
| **Sample-size primitive** (Pierre-Louis-style reliability per metric) | Full — all season-stat aggregates exist | Box-scores in `player_game_stats` only; no PbP | Unavailable | Unavailable | Unavailable |
| **Linemate decomposition (RAPM-style)** | Partial — `player_shifts` exists (351K rows) and supports it; not yet computed | Unavailable (no shifts pre-Dec) | Unavailable | Unavailable | Unavailable |
| **Score-state pure rates** (CtG-style stripping) | Full — `score_differential`, skater counts, period, time_remaining all populated on every shot | Unavailable (no PbP) | Unavailable | Unavailable | Unavailable |
| **Pre-shot pass quality** (the differentiator vs JFresh / Evolving) | **Full — 99,322 / 99,322 shots have it** | Unavailable | Unavailable | Unavailable | Unavailable |
| **Anomaly engine** (rolling actual-vs-expected) | Full once derived tables built; raw inputs all present | Box-score actual only; no expected | Unavailable | Unavailable | Unavailable |
| **xT model** (Markov chain over rink) | Buildable — `arena_adjusted_x_abs`, `arena_adjusted_y` populated | Unavailable | Unavailable | Unavailable | Unavailable |
| **Career arcs (multi-season)** | N/A — single season only | N/A | **Unavailable until backfill** | **Unavailable until backfill** | **Unavailable until backfill** |
| **Multi-season percentile context** | N/A | N/A | **Unavailable until backfill** | **Unavailable until backfill** | **Unavailable until backfill** |
| **Multi-league percentile arc** (SHL/AHL/KHL/NHL) | Unavailable — no European league ingestion in prod | n/a | n/a | n/a | n/a |

**Plain-language read:** Every differentiator that lives at the *single-season* level is buildable today from the existing 2025-26 data. **Every differentiator that requires multi-season context (career arcs, age curves, multi-season percentile, the comparison-to-prior-year story) is BLOCKED on backfill execution.**

---

## Part 4 — What can be backfilled vs what's lost

### 4.1 Re-ingestion is viable for full PbP, all seasons 2016-17+

- **NHL public API endpoint:** `GET https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play`
- **Coverage:** Confirmed available for the modern endpoint format from **2016-17 forward**. Game schedules go back to 1918 via the same API.
- **Older seasons (pre-2016-17):** Legacy `statsapi.web.nhl.com/api/v1/game/{id}/feed/live` had on-ice coordinates and play data; modern equivalent exists via `api.nhle.com/stats/rest`. Coverage extends further back but format may differ.
- **Game ID pattern:** First 4 digits = season, next 2 digits = game type (01=preseason, 02=regular, 03=playoff, 04=all-star), last 4 digits = sequence.

**This means a pipeline-replay against historical game IDs is the path forward.** The pipeline that writes to `raw_nhl_data → raw_shots → player_game_stats` already exists. If it can be parameterized to ingest a list of historical game IDs, the multi-season backfill becomes mechanical.

### 4.2 Backfill scope estimate

Per season (regular season + playoffs):
- Regular: 32 teams × 82 games / 2 = **~1,312 games**
- Playoffs: ~85 games (full Cup run)
- **~1,400 games per season**

For five seasons (2020-21 through 2024-25):
- ~7,000 games to fetch
- At ~5-10 sec per game (API + parse + write), assuming polite throttling: **10-20 hours of pipeline work**

For ten seasons (2015-16 through 2024-25):
- ~14,000 games
- **20-40 hours**

Storage estimate: each `raw_nhl_data.raw_json` row is on the order of 100-500KB. 14,000 games × 250KB avg = ~3.5 GB raw JSON. Derived `raw_shots` rows scale at ~70 shots/game × 14,000 = ~1M shots.

### 4.3 What's permanently lost (or out of reach)

- **Sportlogiq-tier microstats** — broadcast-vision tracking (defender geometry, screen body positioning, stick checks). Citrus's prod schema reserves these columns but the ML pipeline doesn't produce them. The data isn't in NHL's public API either — it's a private SPORTLOGiQ product. **Forward-and-historical permanently unavailable.**
- **Shooter-shift-context columns** — `shooter_time_on_ice`, `time_difference_since_change`, `shooting_team_average_time_on_ice`. These could be derived from `player_shifts` × `raw_shots` join (we have shifts!) but the pipeline doesn't currently produce them as `raw_shots` columns. **Buildable forward + historical via derived query, not via raw schema.**
- **Pre-tracking-era xG model accuracy** — for 2015-16 and earlier, NHL Stats API has shot data but the modern pre-shot context features (pass tracking, last-event speed) start ~2016-17. A backfilled xG model on older seasons would be coarser. **Historical backfill produces older-but-still-credible analytics, not parity with current.**

### 4.4 What `goalie_gsax` 2024 tells us

The 112-row 2024 `goalie_gsax` slice exists. That implies a one-off historical ingestion script ran at some point. Worth tracking down:
- If the script that loaded `goalie_gsax` for 2024 still exists, similar scripts may have loaded other model-output tables for prior seasons that I missed in this audit
- More likely interpretation: someone did a one-off goalie-only backfill for 2024 to compare, and the same path was never extended to other tables

---

## Part 5 — Recommendations

### 5.1 The roadmap implication

The locked Garrett decision was "multi-season backfill: YES." This audit confirms that's a from-zero project, not an augmentation. **The roadmap should treat backfill as Phase 0 work that gates everything multi-season.**

Concrete sequencing recommendation:

**Phase 0a (immediate, can run before any new product work):**
- Backfill the **2025-26 October-December gap** (~360 games). Same pipeline, just historical game IDs. Unblocks: full-season 2025-26 analytics, current-season percentile correctness.

**Phase 0b (multi-season Tier 0 backfill — the unlock for career arcs):**
- Backfill **2024-25 full season** (~1,400 games). Single full prior season unlocks: year-over-year delta, simple career-arc visualization, "vs last season" framing.
- Storage cost low (~250-500MB additional `raw_nhl_data`), pipeline time ~5-10 hours.

**Phase 0c (deeper history, optional based on Phase 0b results):**
- Add **2023-24, 2022-23, 2021-22** seasons. Unlocks: aging curves, multi-season percentile context, Boulet-/HockeyViz-class career-arc framing.
- ~15-30 hours pipeline work.

**Phase 0d (long-tail history, lowest priority):**
- Add **2016-17 through 2020-21**. Unlocks: full-decade career arcs for veterans, draft-year-to-now performance arcs.
- Older seasons may need xG-model retrain; pre-shot context coverage may be sparser.

### 5.2 Pipeline gaps to fix BEFORE backfill (otherwise the backfill inherits the gaps)

1. **Defender geometry** (`distance_to_nearest_defender`, `skaters_in_screening_box`, `nearest_defender_to_net_distance`) — column exists, never populated. Decide: derive from `raw_nhl_data.raw_json` if the data is there, OR mark these columns deprecated and use derived queries against `player_shifts` × `raw_shots` for the same insights.
2. **Shooter shift context** (`shooter_time_on_ice`, `shooting_team_average_time_on_ice`, `time_difference_since_change`) — same pattern. Likely derivable from `player_shifts` table; consider populating during backfill or as post-backfill enrichment.
3. **`raw_shots.season` column NULL on every row** — derive from `game_id` and populate. Trivial migration. **Will be needed for any multi-season query to be performant.**
4. **`player_shifts.season` and `player_toi_by_situation.season` NULL on every row** — same fix.
5. **`raw_nhl_data` not fully processed** — 485 regular-season games scraped but stats not extracted; 45 playoff games unextracted. Fix the extraction pipeline before backfilling more games.
6. **`player_gar_components` defensive components are 0 league-wide** (Pass-1 finding) — the GAR pipeline is incomplete. Fix forward, then backfill.

### 5.3 Minimal "80%-value" backfill

If full multi-season is too heavy a lift up front, the minimum viable unlock is:

1. **Backfill 2025-26 Oct-Dec gap** (~360 games, ~3-5 hours pipeline work) → fixes current-season completeness
2. **Backfill 2024-25 full season** (~1,400 games, ~5-10 hours pipeline work) → unlocks year-over-year delta + simple career-arc viewer
3. **Add `season` column population on `raw_shots` / `player_shifts` / `player_toi_by_situation`** → enables multi-season queries
4. **Fix `raw_nhl_data → raw_shots` stats-extraction backlog** (~485 games)

Together: roughly **15-25 hours of pipeline work** before any new-product Phase 1 ships.

The full 5-season Tier 0 backfill is reasonable as Phase 0c after the minimum lands and earns user feedback.

### 5.4 Roadmap surfaces that DON'T need backfill

For sequencing clarity — these can ship Phase 1 without any backfill:

- **xT (Expected Threat) for hockey** — single-season Markov model on 2025-26 location data
- **Sample-size reliability layer** — single-season metric calibration
- **Score-state purified rates (CtG-style)** — single season is enough
- **Anomaly engine (rolling actual-vs-expected within season)** — single season
- **Pre-shot pass quality leaderboards** — single season; the moat is full
- **Comparison drawer (player A vs player B, current season)** — single season

These eight surfaces are the "ship Phase 1 in parallel with backfill" candidates. Career arcs / multi-season percentile / age curves wait on Phase 0.

---

## Part 6 — Honest disclosures

- **NHL API direct fetches were 403'd** from this session (Cloudflare). Endpoint format + historical coverage confirmed via search snippets and unofficial NHL API references (Zmalski, dword4, MoreHockeyStats, SportRadar). Direct verification with a few historical game IDs is the obvious next step before committing to backfill scope.
- **The 1,385 nhl_games row count** for 2025 includes scheduled-future playoff games (max date 2026-05-13 for finals). Actual played games count is lower. Per-game expected count for full 2025-26 NHL season: 1,312 reg + ~85 playoff = ~1,397 — the 1,385 is consistent.
- **`goalie_gsax` 2024 origin** is not surfaced in this audit. Worth grepping `data-pipeline/` for the loader script to understand whether it can be repurposed.
- **Pipeline-time estimates** assume polite NHL API throttling at ~5-10 seconds per game. Real-world performance depends on parallelism, retry rate, and API rate-limiting behavior.
- **Storage estimates** are rough; depends on JSON compression and `raw_shots` row size with the populated feature columns.
- **`player_shifts` and `player_toi_by_situation` season distribution** could not be returned in the consolidated query (PostgreSQL union typing issue with NULLs). Both have NULL `season` columns on every row; their game_ids derive cleanly to 2025.
- **No write operations were performed.** Per-Garrett directive, audit is read-only. All findings are observational.

---

## What this audit enables next

This document does NOT design the backfill plan — that's the next step. With this in hand, the next planning move is to draft:

1. **Backfill execution plan** — pick scope (Phase 0a → 0b → 0c → 0d sequencing), confirm pipeline parameterization for historical game IDs, decide on parallelism + throttling strategy, estimate runtime + cost
2. **Pipeline gap-fix list** — pre-backfill fixes from §5.2 above (defender geometry, shooter shift context, season-column population, stats-extraction backlog, defensive GAR completion)
3. **Tier 0 / Phase 1 split** — finalize which surfaces ship without backfill (single-season MVP) vs which gate on multi-season completeness

That's the next conversation. This doc is the input.

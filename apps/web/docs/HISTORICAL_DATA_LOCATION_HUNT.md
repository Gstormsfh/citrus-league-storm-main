# Historical Data Location Hunt

**Date:** 2026-05-05
**Trigger:** Garrett's pushback on the prior audit's "no prior data exists" finding. xG models were trained on full-season data, which would not have happened with 99K rows from one partial season.
**Method:** Read-only investigation across 6 location classes (Supabase projects, schema-wide prod scan, local file system, xG training script lineage, git history, and search for any miscellaneous archive).
**Status:** No writes performed. Findings ready for review.

---

## TL;DR — Garrett's hypothesis is correct, with one critical caveat

**The historical multi-season data exists.** It was the source of training the xG v3 model. Locations:

- **`C:\Users\garre\Downloads\shots_2018-2024.csv`** — 447 MB, **786,244 rows** spanning seasons **2018, 2019, 2020, 2021, 2022, 2023, 2024** (NHL seasons 2018-19 through 2024-25). Source: MoneyPuck.com bulk download. This is what Garrett remembers and is exactly what `data/TRAINING_DATA_MANIFEST.md` calls for.
- **The data is `.gitignore`d on purpose** — `data/shots_2018-2024.csv` and `data/shots_2018-2024.zip` are explicitly excluded. The intent was always "store locally for training, don't bloat Git, only commit the trained `.joblib`."
- **The earlier audit's "no prior data exists in Supabase" is correct, but was the wrong question.** The prior data was never persisted to Supabase because Supabase isn't where training data lives — it lives in MoneyPuck's CSV bulk download, downloaded once locally, fed to the training script.

**The critical caveat — and it's a big one for the multi-season backfill plan:**

> **The 7 Citrus moat features (pass-context: `pass_quality_score`, `pass_immediacy_score`, `goalie_movement_score`, `pass_zone_encoded`, `pass_lateral_distance`, `pass_to_net_distance`, `has_pass_before_shot`) DO NOT EXIST in the MoneyPuck historical 2018-2024 data.** They're set to 0 / "no_pass" placeholders during model training, per the explicit comment in `train_xg_v3.py`:
>
> *"The 7 pass-context features (our moat) are set to 0 / 'no_pass' for historical MoneyPuck data because that source does not contain pass info."*

**Implication:** The Citrus pre-shot-pass differentiator is **2025-26 forward only**. Any visualization or metric that relies on `pass_quality_score` for past seasons either:
- (a) Cannot be computed for prior seasons at all, or
- (b) Requires re-deriving pass-context from raw NHL play-by-play for 2018-2024 — which is the original PbP-replay project the prior audit recommended.

For metrics that don't need the moat features (xG output, location heatmaps, finishing %, basic shot-quality, last-event speed/category, score-state context, rebounds), **786K shots × 7 seasons of MoneyPuck-grade data is fully available** to backfill into Supabase or use in derived analyses.

---

## Part 1 — Supabase project inventory

`mcp__Supabase__list_projects` returned **two projects** under the `zgxmcbfbwwbspmtxjmtk` organization:

| Project | ID | Created | Status | Purpose |
|---|---|---|---|---|
| **CitrusFantasySports (prod)** | `iezwazccqqrhrjupxzvf` | **2025-09-01** | ACTIVE_HEALTHY | Primary prod |
| **citrus-staging** | `jjgspcpvqaiitloglxbb` | **2026-04-23** | ACTIVE_HEALTHY | Staging (only 2 weeks old) |

**Critical observation:** the prod project was created 2025-09-01, **before the 2025-26 NHL season started (2025-10-07)**. The staging project is only ~2 weeks old as of audit. Neither project predates the 2024-25 NHL season; therefore, neither could have been the original storage for prior-season PbP. Whatever historical data Garrett remembers existed must have lived OUTSIDE Supabase — and it does (see Part 3 / Part 4).

**Prod schema-wide scan** (`information_schema.tables` excluding pg_catalog/information_schema/pg_toast):

The full table list includes:
- `auth.*` — Supabase auth tables (23)
- `cron.*` — pg_cron tables (2)
- `extensions.pg_stat_statements*` (2)
- `net._http_response`, `http_request_queue` (2)
- **`public.*` — 88 application tables** (every one previously identified in the Phase 0 audit; no hidden archive tables)
- `realtime.*` — Supabase realtime + day-rotated message tables (10)
- `storage.*` — file storage tables (8)
- `supabase_migrations.schema_migrations`
- `vault.decrypted_secrets`, `vault.secrets`

**No `historical_*`, `archive_*`, `*_v1`, `*_v2`, `raw_pbp_*`, `nhl_pbp_*`, `shots_archive`, `shots_historical`, `training_data`, `ml_data`, `model_training_*`, `*_backfill`** tables exist in any schema. Schema-wide search returned only the public tables previously inventoried. **Conclusion: no hidden historical tables in prod.**

**Staging snapshot** (`citrus-staging`, `jjgspcpvqaiitloglxbb`):

Mostly empty.
- `raw_shots` — **0 rows**
- `raw_nhl_data` — 0 rows
- `player_game_stats` — 0 rows
- `player_shifts` — 0 rows
- `player_toi_by_situation` — 0 rows
- `player_directory` — 938 rows (synced from prod; same 2025 cohort)
- `player_season_stats` — 1,066 rows (same)
- `player_talent_metrics` — 1,012 rows (same)
- `player_ros_projections` — 926 rows (same)
- `nhl_games` — 1,336 rows
- `goalie_gsax_primary` — 82 rows (no `season` column on this table; can't directly distribute by season)
- `nhl_teams` — 33, `players` — 801, `playoff_bracket_picks` — 9, etc.

Staging has **draft-engine v2 tables** (`draft_events`, `draft_picks_v2`, `draft_metrics_*`, `autopick_failures`, `draft_queues`) that don't exist in prod — these are an in-progress feature, all empty. **No historical PbP.**

**Conclusion (Part 1): both Supabase projects together contain only 2025-26 PbP. No prior-season PbP in any schema, in any project.**

---

## Part 2 — Schema-wide search within prod

Already covered in Part 1 schema-wide scan. Every table in `public` is either:
- A 2025-only analytical table (raw_shots, raw_nhl_data, player_game_stats, etc.)
- App-domain tables (leagues, teams, draft_picks, etc. — app data, not analytics)
- Empty tables that exist as schema definitions for forward use (player_shifts_official, projections, projection_cache, etc.)

**No suspicious-named tables matching the patterns I searched for.** The schema is clean. The data is just only-2025.

---

## Part 3 — Local file system scan

This is where the historical data actually lives.

### 3.1 `data/` directory at the repo root

```
data/
├── MoneyPuck_Shot_Data_Dictionary.CSV   15 KB   schema reference
├── TRAINING_DATA_MANIFEST.md            2 KB    THE smoking gun
├── game_level_comparison.csv            38 KB   529 rows
├── goalie_gar_all_configs.csv           14 KB   83 rows
├── goalie_gsax.csv                      6 KB    86 rows
├── matched_shots_2025.csv               1.3 MB  6,081 rows
├── moneypuck_shots_2025.csv.csv         22 MB   39,519 rows  (MoneyPuck 2025-26 partial)
├── nhl-schedule-2025.csv                324 KB  7,876 rows
├── our_shots_2025.csv                   9.9 MB  76,878 rows  (our 2025-26 PbP export)
├── player_game_comparison.csv           76 KB   783 rows
├── player_gar_components_raw.csv        96 KB   913 rows
├── player_season_comparison.csv         98 KB   783 rows
├── shot_level_stats.csv                 448 B   8 rows
└── shots_full_features_2025.csv         25 MB   76,878 rows  (training input — 2025 PbP)
```

**Every file is 2025-tagged.** No prior-season CSV in this directory.

### 3.2 `TRAINING_DATA_MANIFEST.md` — the smoking gun

The manifest reads:

> # Training Data Manifest
>
> Files required for xG v3 model training. Large files are `.gitignore`d and stored locally.
> Only the trained model binary (~2.5 MB) gets committed to Git.
>
> ## Required Files
>
> | File | Size | Rows | Source | How to Obtain |
> |------|------|------|--------|---------------|
> | `shots_2018-2024.csv` | ~447 MB | 786,244 | MoneyPuck 2018-2024 | `curl -L -o data/shots_2018-2024.zip https://peter-tanner.com/moneypuck/downloads/shots_2018-2024.zip && cd data && unzip shots_2018-2024.zip` |
> | `shots_full_features_2025.csv` | ~25 MB | 76,877+ | Our PBP pipeline | `python scripts/utilities/export_raw_shots_csv.py --training` |

The training pipeline expects `shots_2018-2024.csv` to be at `data/shots_2018-2024.csv` (gitignored, downloaded fresh on the training machine).

### 3.3 Where the historical CSV actually lives

A `find` across `/c/Users/garre/...` surfaced multiple copies:

```
/c/Users/garre/Downloads/shots_2018-2024.csv             447 MB   ← THE master copy
/c/Users/garre/Downloads/shots_2018-2024/shots_2018-2024.csv 447 MB   ← extracted into folder
/c/Users/garre/Downloads/shots_2018-2024.zip                 ← original zip
/c/Users/garre/Downloads/shots_2018.zip                      ← (separate / partial download)
/c/Users/garre/AppData/Local/Temp/.../shots_2018-2024.csv    ← temp extract
/c/Users/garre/AppData/Roaming/Microsoft/Office/Recent/shots_2018-2024.LNK   ← Office shortcut
```

File metadata (the master Downloads copy):
- Size: **447 MB** (matches manifest exactly)
- Modified: **2026-02-17 22:48** (downloaded ~2.5 months ago)

### 3.4 Season distribution of the historical CSV

Counted from the actual CSV:

| Season | Rows | Note |
|---|---|---|
| **2018** | 117,622 | 2018-19 NHL regular season + playoffs |
| **2019** | 104,172 | 2019-20 (COVID-shortened, 2020 playoffs in Toronto/Edmonton bubble) |
| **2020** | 78,611 | 2020-21 (56-game COVID-shortened, no QC/CGY/EDM playoffs) |
| **2021** | 121,471 | 2021-22 |
| **2022** | 122,026 | 2022-23 |
| **2023** | 122,472 | 2023-24 |
| **2024** | 119,870 | 2024-25 |
| **Total** | **786,244** | matches manifest |

**Conclusion:** seven full NHL seasons of MoneyPuck shots, 786,244 rows, exists locally on disk. Garrett's recollection is verified.

### 3.5 What's in the local `data/` 2025 files vs the historical CSV

The **moat features** are in `our_shots_2025.csv` and `shots_full_features_2025.csv`:
- `pass_lateral_distance`, `pass_to_net_distance`, `pass_immediacy_score`, `goalie_movement_score`, `pass_quality_score`, `pass_zone_encoded`, `has_pass_before_shot` — all populated for the 76,878 2025 shots

The **MoneyPuck CSVs** (both `moneypuck_shots_2025.csv.csv` and `shots_2018-2024.csv`) have:
- `arenaAdjustedShotDistance`, `shotAngle`, `shotType`, `shotRebound`, `shotRush`, `shotOnEmptyNet`, `homeSkatersOnIce`, `awaySkatersOnIce`, `shooterTimeOnIce`, `xGoal`, `lastEventCategory`, `timeSinceLastEvent`, `speedFromLastEvent`, score, period, etc.
- **NO** pass-context features. MoneyPuck doesn't expose them.

### 3.6 Other possibly-relevant directories

- `apps/web/src/data/` — only `nhlContracts.ts` (154 KB, unrelated)
- `data-pipeline/models/` — 18 `.joblib` model artifacts (xg_model, xg_model_moneypuck, xg_model_moneypuck_v2, rebound_model, xa_model, shot_type_encoder, last_event_category_encoder, pass_zone_encoder, player_shooting_talent, etc.). **No historical data files**, just trained models.
- `node_modules/` — irrelevant fixtures only.
- No `archive/`, `backup/`, `snapshots/`, `training_data/`, `datasets/`, `fixtures/` directories at the repo root.

---

## Part 4 — xG model training data lineage

### 4.1 Training script: `scripts/utilities/train_xg_v3.py`

Header docstring (verbatim):

> ```python
> """
> train_xg_v3.py  --  xG Model v3 Training Pipeline
> ===================================================
> Trains on ~863K real NHL shots:
>   - 786K MoneyPuck historical  (data/shots_2018-2024.csv)
>   -  77K from our PBP pipeline (data/shots_full_features_2025.csv)
>
> Key design principle:
>   Every feature MUST be derivable from live NHL play-by-play data.
>   The 7 pass-context features (our moat) are set to 0 / "no_pass" for
>   historical MoneyPuck data because that source does not contain pass info.
> """
> ```

The script defines `MOAT_FEATS = {has_pass_before_shot, pass_lateral_distance, pass_to_net_distance, pass_immediacy_score, goalie_movement_score, pass_quality_score, pass_zone_encoded}` and explicitly stubs them with placeholders for the historical 786K rows.

The 31 v3 features (full list) span:
- Core geometry (3): `distance`, `angle`, `is_slot_shot`
- Shot context (6): `shot_type_encoded`, `is_rebound`, `is_rush`, `is_empty_net`, `is_power_play`, `score_differential`
- Game state (3): `defending_team_skaters_on_ice`, `period`, `time_since_powerplay_started`
- Spatial (5): `east_west_location_of_shot`, `north_south_location_of_shot`, `east_west_location_of_last_event`, `arena_adjusted_shot_distance`, `distance_angle_interaction`
- Last event (7): `last_event_category_encoded`, `time_since_last_event`, `distance_from_last_event`, `speed_from_last_event`, `speed_from_last_event_log`, `shot_angle_plus_rebound_speed`, `shot_angle_rebound_royal_road`
- **Pass context / MOAT (7)**: `has_pass_before_shot`, `pass_lateral_distance`, `pass_to_net_distance`, `pass_immediacy_score`, `goalie_movement_score`, `pass_quality_score`, `pass_zone_encoded`

**Of the 31 features, 24 are computable from MoneyPuck historical and 7 (the moat) are 2025-26-only.**

### 4.2 Data flow per the manifest

```
NHL Games Scraped (data_acquisition.py)
        |
        v
Supabase raw_shots table (grows with each game — 2025-26 only)
        |
        v
export_raw_shots_csv.py --training
        |
        v
data/shots_full_features_2025.csv (our PBP shots, 76K)
    +
data/shots_2018-2024.csv (MoneyPuck historical, 786K — local-only)
        |
        v
train_xg_v3.py (combines 863K shots, trains XGBoost — AUC 0.817)
        |
        v
models/xg_model_moneypuck.joblib (production model, ~2.5 MB)
```

The training pipeline never persists the 786K historical shots to Supabase. They're loaded into memory, fed to XGBoost, and discarded after the model fits. The trained `.joblib` artifact carries the learned parameters; the CSV stays on disk.

---

## Part 5 — Git history of acquisition + training

### 5.1 Acquisition scripts

`git log -- data-pipeline/acquisition/` shows recent commits (last 25):
- `1fd19ac` fix(playoff-sync): NHL schedule API needs YYYY-MM-DD with hyphens
- `c93f15c` fix: map UTA team_id 68→59 in playoff schedule ingestion
- `44c930b` feat: playoff schedule ingestion + roster autosave + copy softening
- `593c7b2` Fix xG model path — look in data-pipeline/models not acquisition/models
- `dbdf0e9` Harden nightly pipeline: remove time window, add catch-up, staleness alerts

**No commits suggest a prior era of multi-season historical PbP ingestion via the scraper.** All historical commits are 2025-26-season-relevant or general scraper hardening. The acquisition pipeline was always 2025-26-forward.

### 5.2 Training scripts + manifest

`git log -- 'scripts/utilities/train_xg*' 'scripts/utilities/export_raw_shots*' 'data/TRAINING_DATA_MANIFEST.md'` returned exactly 4 commits:

```
3d6adc9  Update all docs for v3 model (863K shots, AUC 0.817), add training manifest
d6be75d  xG v3: Train on 863K real shots (786K MoneyPuck + 77K PBP), AUC 0.776->0.817
6e18851  Add per-shot-type isotonic calibration for xG model accuracy
8b2042e  Major codebase reorganization and critical fixes
```

The story:
- `8b2042e` — reorg
- `6e18851` — calibration improvement
- **`d6be75d` — the v3 leap.** Trained on 786K MoneyPuck + 77K PbP = 863K. AUC 0.776 → 0.817.
- `3d6adc9` — manifest committed for reproducibility

**The trained-on-multi-season model is real, the training data file is real (locally), the manifest documents the workflow.** Garrett's memory is exactly correct.

### 5.3 `.gitignore` confirms intent

```
# Large training data files (too big for Git, train locally)
data/*.csv.gz
data/moneypuck_shots_2018*.csv
data/moneypuck_shots_historical*.csv
data/shots_2018-2024.csv
data/shots_2018-2024.zip
```

The team explicitly chose "store the 447MB historical training data locally, only commit the trained model artifact." That's why the prior audit didn't surface it — the audit checked Supabase + the committed repo, neither of which holds the data.

---

## Part 6 — Synthesis + recommendations

### 6.1 What was found

✅ **Multi-season MoneyPuck shots dataset exists locally** at `C:\Users\garre\Downloads\shots_2018-2024.csv`, 447 MB, 786,244 rows across NHL seasons 2018-19 through 2024-25.
✅ **xG v3 model was trained on this data** (commit `d6be75d`, AUC 0.776 → 0.817).
✅ **Training manifest, scripts, and `.gitignore`** all confirm the local-only-training-data architecture is intentional, not accidental.
✅ **Citrus's 2025-26 PbP-derived shots** in Supabase have all 31 v3 features populated, including the 7-feature moat.
❌ **No prior-season Citrus-grade PbP exists.** Anywhere. Not Supabase, not local files, not git history.

### 6.2 Gap analysis revised

The prior audit's "Phase 0 backfill" was framed as "ingest from scratch via NHL public API." With the historical-MoneyPuck-CSV finding, the picture is more nuanced:

| Backfill target | Source | Effort | Citrus moat features available? |
|---|---|---|---|
| **Multi-season standard analytics** (xG totals, shot maps, finishing %, last-event speed) | Load `shots_2018-2024.csv` into Supabase as a `historical_shots` table | Hours (one bulk insert) | ❌ Pass-context features absent |
| **Multi-season Citrus-moat analytics** (pass-quality leaderboards, pre-shot context history, full xT model) | Re-derive from NHL PbP API (api-web.nhle.com) for historical game IDs | Days (pipeline replay) | ✅ Available after re-derivation |
| **Multi-league percentile arc** (SHL/Liiga/KHL → NHL) | Separate ingestion pipeline; not in scope of this audit | Weeks | n/a |

### 6.3 Recommended Phase 0 sequence — REVISED

The earlier audit recommended a five-phase backfill. With the local CSV finding, the sequence becomes:

**Phase 0a — quick win (1-2 days work):**
- Load `shots_2018-2024.csv` into a new Supabase table (e.g., `raw_shots_historical` or schema-merged with `raw_shots`). 786K rows, MoneyPuck-format columns. **Unlocks: career arcs based on standard MoneyPuck features (xG, finishing %, shot location, last-event), age curves on standard metrics, multi-season percentile context for the 24-of-31 features that exist.**
- Pre-shot moat features stay zero / null. Communicate this in UI as "pre-shot context: 2025-26 only" or similar.

**Phase 0b — fix the 2025-26 Oct-Dec gap** (~360 games, 3-5 hrs pipeline work):
- Same approach as the prior audit recommended. Replay the existing scraper against historical 2025-26 game IDs that pre-date the Dec 17 ingestion start.

**Phase 0c — moat backfill** (THE expensive option):
- For 2024-25 and earlier, re-fetch full PbP from `api-web.nhle.com/v1/gamecenter/{id}/play-by-play` and re-derive the 7 moat features.
- ~14,000 historical games × 5-10 sec each = 20-40 hours pipeline work + storage.
- Unlocks moat-feature visualizations for prior seasons.
- **Open question:** is the value worth it? For most career-arc / aging-curve / percentile-context use cases, the standard-feature backfill (Phase 0a) is enough. Moat features matter for present-day decisions, not historical retrospective.

**Phase 0d — pipeline gaps (carry forward from prior audit):**
- Populate `season` column on `raw_shots`, `player_shifts`, `player_toi_by_situation`
- Fix defender-geometry + shooter-shift-context columns that are 0 league-wide
- Drain the `raw_nhl_data` → `raw_shots` extraction backlog (~485 games)
- Fix `player_gar_components` defensive components that are 0 league-wide

### 6.4 The "minimum 80%-value" backfill is now MUCH cheaper than thought

Phase 0a (load the local CSV into Supabase) + Phase 0b (Oct-Dec gap) + Phase 0d (pipeline gap fixes) is roughly **2-3 working days** instead of the previously-estimated 15-25 hours of bulk pipeline replay. Phase 0c is optional and gates only the deepest analytical surfaces.

This re-frames the multi-season Tier 0 unlock: **it's NOT a from-zero ingestion project. It's a CSV-to-Supabase load + a fill-in for a 2-month gap. Days, not weeks.** Career arcs, multi-season percentile context, age curves all unlock at Phase 0a completion.

### 6.5 What the prior audit got right vs wrong

| Prior audit claim | Status now |
|---|---|
| "No prior-season data exists in prod" | ✅ Correct (in Supabase). Just incomplete because Supabase was the wrong place to look. |
| "The data IS retrievable from NHL public API" | ✅ Correct, but expensive. The cheaper local CSV path eclipses this for most use cases. |
| "Backfill is a from-zero project" | ❌ Wrong. The MoneyPuck training data IS the multi-season backfill source for 24 of 31 features. |
| "Multi-season unlocks gate on hours of pipeline replay" | ❌ Wrong. They gate on a CSV load + schema merge. |
| "The pre-shot moat features are 2025-26 only" | ✅ Correct. Confirmed by `train_xg_v3.py` source comments. |
| "Pipeline gaps (defender geometry, shooter shift context, season-column population, extraction backlog)" | ✅ Correct. Still need to fix. |

The prior audit's value-add: surfaced the pipeline-gap fixes that need to happen regardless. Its blind spot: didn't check the local file system for training data; assumed Supabase was the only data home.

---

## Part 7 — Open hypotheses + remaining unknowns

### 7.1 Why didn't the team load `shots_2018-2024.csv` into Supabase originally?

Plausible explanations:
- Storage cost — 786K rows × 100+ MoneyPuck columns is a few hundred MB in Postgres. Probably acceptable.
- Pipeline mismatch — the scraper writes its own derived schema; loading MoneyPuck's 100+ columns into the same table requires schema reconciliation
- Prioritization — model training only needed the data once, so a local CSV was good enough

### 7.2 Is the `goalie_gsax_primary` 82-row staging discrepancy meaningful?

Staging has 82 rows in `goalie_gsax_primary`; prod has 0. Possibly leftover from a one-off dev-environment seeding. The table has no `season` column. Worth a follow-up but not on the critical path of the multi-season backfill.

### 7.3 Could MoneyPuck CSVs be re-downloaded to extend coverage?

Yes — `https://peter-tanner.com/moneypuck/downloads/` publishes annual updates. The current local copy stops at 2024-25. When 2025-26 wraps, MoneyPuck will publish that as `shots_2018-2025.csv` or similar. Re-running the backfill is a single re-download + re-load.

### 7.4 What about NHL Stats API for older seasons (pre-2018)?

The MoneyPuck CSV starts at 2018-19. For pre-2018 history (the deep career-arc territory: McDavid's 2015-16 rookie year, Crosby's 2005-06, etc.), MoneyPuck doesn't have it. NHL's `statsapi.web.nhl.com` legacy endpoint had play data going back further; coverage and API stability for pre-2017-18 is the open question. Not on the critical path; flag for future.

---

## Part 8 — Honest disclosures

- **NHL public API direct fetches** were 403'd from this session (Cloudflare). Confirmation of historical PbP availability from earlier audit relied on third-party reference docs.
- **The two `staging_2024_*` tables** (goalies + skaters) in prod have 0 rows. The naming suggests they were intended as 2024-25 staging tables and never loaded. Not on the critical path.
- **Read-only investigation.** No writes, no migrations, no data movement. The `shots_2018-2024.csv` lives untouched at `C:\Users\garre\Downloads\`.
- **The 786K row count is verified** by direct `awk` counting against the season column. Exact distribution by season documented in §3.4.
- **The `train_xg_v3.py` philosophy quote** is verbatim from the script's docstring; not paraphrased.

---

## What this hunt enables next

This document does NOT design the backfill plan — that's the next step. With this in hand, the next planning move is to draft:

1. **CSV-to-Supabase load plan** — schema decision (separate `raw_shots_historical` table OR merged with `raw_shots` via column-superset), storage estimate, deduplication keys, ingestion pipeline (one-shot Python or `\copy`)
2. **UI-side feature-availability matrix** — for every dashboard surface, mark which feature dependencies are pre-2025-26-available vs 2025-26-only, surface this gracefully in the product (e.g., "career arcs use standard features; for pass-context history see 2025-26 forward")
3. **Phase 0c moat-backfill cost-benefit** — does the value of pre-shot pass quality for prior seasons justify the 20-40 hour pipeline replay? Probably no for v1; possibly yes for v2 if a competitor moves first.

That's the next conversation. This doc is the input. **Garrett's hypothesis was right; the prior audit's conclusion was incomplete.**

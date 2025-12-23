# Pipeline Cleanup & Consolidation Plan

## Current Problem
- 243 Python scripts accumulated from debugging/fixing attempts
- 110 SQL migrations with many redundant fixes
- No clear distinction between the two data silos

## Target Architecture: Two Data Silos

### SILO 1: PBP Data (Internal Only)
**Purpose:** Advanced analytics, projections, GSAx, xG calculations
**NOT for public display** - only backend calculations

| Script | Purpose | Run Frequency |
|--------|---------|---------------|
| `ingest_raw_nhl.py` | Fetch raw PBP data from NHL API | Every 15 min during games |
| `extractor_job.py` | Extract events to player_game_stats | After ingestion |
| `ingest_shiftcharts.py` | TOI data from shift charts | After extraction |
| `populate_raw_shots.py` | Shot data for xG model | After extraction |
| `calculate_goalie_gsax.py` | GSAx calculations | Daily |
| `calculate_daily_projections.py` | Player projections | Daily |

### SILO 2: NHL Official Stats (Public Facing)
**Purpose:** Matchup display, fantasy scoring, player cards
**Source of truth for what users see**

| Script | Purpose | Run Frequency |
|--------|---------|---------------|
| `scrape_per_game_nhl_stats.py` | NHL boxscore official stats | After games complete |

### SHARED/SUPPORT Scripts
| Script | Purpose |
|--------|---------|
| `supabase_rest.py` | Database client |
| `build_player_season_stats.py` | Aggregate game stats to season |
| `populate_player_directory.py` | Player metadata/names |
| `populate_league_averages.py` | League averages for projections |

---

## SCRIPTS TO DELETE (One-time fixes/debugging)

### Debug/Check Scripts (DELETE ALL)
```
check_*.py (all 30+ files)
debug_*.py (all files)
diagnose_*.py (all files)
find_*.py (all files)
investigate_*.py (all files)
monitor_*.py (all files except monitor_ingestion.py)
track_*.py (all files)
```

### Test Scripts (DELETE ALL)
```
test_*.py (all 20+ files)
```

### Verification Scripts (KEEP 1, DELETE REST)
```
KEEP: verify_stats_completeness.py
DELETE: verify_*.py (all others)
```

### One-time Fix Scripts (DELETE ALL)
```
fix_*.py (all files)
backfill_*.py (all files)
reset_*.py (all files)
force_*.py (all files)
manual_*.py (all files)
reprocess_*.py (all files)
```

### Duplicate/Old Versions (DELETE)
```
match_moneypuck_data_old.py
match_moneypuck_data_fixed.py
pull_season_data_optimized.py (keep pull_season_data.py)
calculate_goalie_gsax_primary.py (keep calculate_goalie_gsax.py)
```

### Obsolete Scripts (DELETE)
```
populate_goalie_stats_from_raw_shots.py (REPLACED by scrape_per_game_nhl_stats.py)
apply_migration*.py (one-time migration runners)
```

---

## RECOMMENDED FILE STRUCTURE

```
citrus-league-storm-main/
├── pipeline/
│   ├── __init__.py
│   ├── run_pipeline.py          # Master orchestrator
│   ├── silo_pbp/                # PBP/Internal silo
│   │   ├── ingest_raw_nhl.py
│   │   ├── extractor_job.py
│   │   ├── ingest_shiftcharts.py
│   │   └── calculate_goalie_gsax.py
│   ├── silo_official/           # NHL Official silo
│   │   └── scrape_per_game_nhl_stats.py
│   └── shared/                  # Shared utilities
│       ├── supabase_rest.py
│       ├── build_player_season_stats.py
│       └── populate_player_directory.py
├── analytics/                   # Internal analytics (not pipeline)
│   ├── calculate_daily_projections.py
│   ├── populate_league_averages.py
│   └── fantasy_projection_pipeline.py
├── archive/                     # Old scripts (before deletion)
│   └── (move all deletable scripts here first)
└── ...
```

---

## MIGRATION CLEANUP

### Keep These Core Migrations
- `20251218130000_create_player_game_stats.sql`
- `20251218100000_create_player_directory.sql`
- `20251218100001_create_player_season_stats.sql`
- `20251218160001_create_get_matchup_stats_rpc.sql`
- `20251225110000_create_get_daily_game_stats_rpc.sql`
- `20251228000003_bulletproof_goalie_stats.sql` (final fix)

### Consolidate These (Multiple attempts at same fix)
The following should be consolidated into single migrations:
- All `*_fix_get_matchup_stats_*.sql` -> one migration
- All `*_fix_goalie_*.sql` -> one migration
- All `*_add_nhl_stats_*.sql` -> one migration

---

## ACTION ITEMS

1. [ ] Create `archive/` directory
2. [ ] Move deletable scripts to archive (not delete yet, for safety)
3. [ ] Update `run_complete_pipeline.py` to include NHL official stats scraping
4. [ ] Test pipeline end-to-end
5. [ ] After confirmed working, delete archive folder
6. [ ] Squash redundant migrations into clean versions

---

## MASTER PIPELINE FLOW

```
┌─────────────────────────────────────────────────────────────────┐
│                    DAILY PIPELINE RUN                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │ SILO 1: PBP     │    │ SILO 2: OFFICIAL │                   │
│  │ (Internal)      │    │ (Public)         │                   │
│  └────────┬────────┘    └────────┬─────────┘                   │
│           │                      │                              │
│           ▼                      ▼                              │
│  ┌────────────────┐    ┌────────────────────┐                  │
│  │ ingest_raw_nhl │    │ scrape_per_game_   │                  │
│  │                │    │ nhl_stats          │                  │
│  └───────┬────────┘    └─────────┬──────────┘                  │
│          │                       │                              │
│          ▼                       │                              │
│  ┌────────────────┐              │                              │
│  │ extractor_job  │              │                              │
│  │ (skaters only) │              │ (creates goalies,            │
│  └───────┬────────┘              │  updates all nhl_*)          │
│          │                       │                              │
│          ▼                       │                              │
│  ┌────────────────┐              │                              │
│  │ shift_charts   │              │                              │
│  │ (TOI)          │              │                              │
│  └───────┬────────┘              │                              │
│          │                       │                              │
│          └───────────┬───────────┘                              │
│                      ▼                                          │
│          ┌────────────────────┐                                 │
│          │ player_game_stats  │                                 │
│          │ (unified table)    │                                 │
│          └─────────┬──────────┘                                 │
│                    │                                            │
│                    ▼                                            │
│          ┌────────────────────┐                                 │
│          │ build_player_      │                                 │
│          │ season_stats       │                                 │
│          └─────────┬──────────┘                                 │
│                    │                                            │
│          ┌────────┴────────┐                                   │
│          ▼                 ▼                                    │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │ Projections  │  │ Matchup      │                            │
│  │ (internal)   │  │ Display      │                            │
│  │              │  │ (public)     │                            │
│  └──────────────┘  └──────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

# COMPREHENSIVE SYSTEM DIAGNOSTIC AUDIT
**Generated:** 2026-01-03 14:34:51  
**Season:** 2025

---

## EXECUTIVE SUMMARY

### Overall System Health
- **Health Score:** 100.0%
- **Status:** ✅ EXCELLENT

---

## SECTION 1: DATA EXTRACTION AUDIT

### 1.1 Raw NHL Data (Play-by-Play)

- **Total Games:** 587
- **Extracted Games:** 584
- **Extraction Rate:** 99.5%
- **Status:** ✅ GOOD

### 1.2 Raw Shots (xG Model Input)

- **Total Shots in DB:** 0
- **Archived Shots (CSV):** 45,659 shots in `data/archive/raw_shots_backup.csv`
- **Note:** raw_shots was archived to save database space but data is still available in CSV
- **Status:** ⚠️ ARCHIVED

### 1.3 Player Game Stats (PBP)

- **Total Records:** 23,089
- **Skater Records:** 20,752
- **Goalie Records:** 2,337
- **Unique Players:** 925
- **Unique Games:** 587
- **Status:** ✅ GOOD

### 1.4 NHL Official Stats

- **Total Records:** 23,089 (Skaters: 20,752, Goalies: 2,337)
- **Records with NHL Stats Scraped:** 23,089 (100.0%)
- **Skaters with NHL Stats:** 20,752 (100.0%)
- **Goalies with NHL Stats:** 2,337 (100.0%)
- **Records with Points > 0:** 7,280 (31.5%) [Normal: ~30% - most players don't score each game]
- **NHL Shots Coverage:** 100.0%
- **Status:** ✅ GOOD

---

## SECTION 2: xG MODEL AUDIT


**Note:** raw_shots data has been archived to CSV (45,659 shots).
xG model analysis requires raw_shots data. To analyze xG model performance, either:
1. Restore raw_shots from `data/archive/raw_shots_backup.csv`, or
2. Re-extract shots from raw_nhl_data using the extraction pipeline.

### 2.1 Player-Season Level Performance
- **R² Score:** 0.0000 (0.00%)
- **Correlation (Pearson r):** 0.0000
- **MAE (Mean Absolute Error):** 0.000 goals/player
- **RMSE (Root Mean Squared Error):** 0.000 goals/player
- **Players Analyzed:** 0
- **Total xG:** 0.00
- **Total Goals:** 0
- **Calibration Ratio:** 0.00x
- **Mean xG/Player:** 0.000
- **Mean Goals/Player:** 0.000
- **Status:** UNKNOWN

### 2.2 Game-Level Performance
- **R² Score:** 0.0000 (0.00%)
- **Correlation (Pearson r):** 0.0000
- **MAE (Mean Absolute Error):** 0.00 goals/game
- **RMSE (Root Mean Squared Error):** 0.00 goals/game
- **Games Analyzed:** 0
- **Avg xG/Game:** 0.00
- **Avg Goals/Game:** 0.00
- **Median xG/Game:** 0.00
- **Median Goals/Game:** 0.00
- **Status:** UNKNOWN


---

## SECTION 3: GSAx MODEL AUDIT

### 3.1 Goalie GSAx Statistics
- **Total Goalies:** 194
- **Total Shots Faced:** 181,283
- **Total GA:** 13,249
- **Total xGA:** 15374.54
- **League SV%:** 0.9269
- **Mean GSAx:** 8.78
- **GSAx Range:** [-9.01, 79.56]
- **Status:** ✅ GOOD


---

## SECTION 4: PROJECTION PIPELINE AUDIT

### 4.1 Player Projected Stats
- **Total Projections:** 66,433
- **Unique Players:** 907
- **Unique Games:** 1,312
- **Unique Dates:** 167
- **Status:** ✅ GOOD

### 4.2 League Averages
- **Positions Configured:** 6
- **Status:** ✅ GOOD

### 4.3 Projection Accuracy
- **Matched Projections:** 0
- **Status:** ⚠️ INSUFFICIENT DATA (Need >10 matched projections for analysis)


---

## SECTION 5: DATA QUALITY KPIs

### Overall Data Completeness
- **Score:** 100.0%
- **Status:** ✅ EXCELLENT

### Overall Health Score
- **Score:** 100.0%
- **Interpretation:** ✅ EXCELLENT

---

## RECOMMENDATIONS

1. ✅ **No critical issues detected** - system is performing well

---

*End of Report*

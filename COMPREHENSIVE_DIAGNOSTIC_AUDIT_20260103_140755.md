# COMPREHENSIVE SYSTEM DIAGNOSTIC AUDIT
**Generated:** 2026-01-03 14:07:55  
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
- **Error:** division by zero

### 1.3 Player Game Stats (PBP)

- **Total Records:** 23,089
- **Skater Records:** 20,752
- **Goalie Records:** 2,337
- **Unique Players:** 925
- **Unique Games:** 587
- **Status:** ✅ GOOD

### 1.4 NHL Official Stats

- **Total Records:** 23,089
- **NHL Points Coverage:** 31.5%
- **NHL Shots Coverage:** 100.0% (nhl_shots_on_goal)
- **Status:** ⚠️ NEEDS ATTENTION

---

## SECTION 2: xG MODEL AUDIT

### 2.1 Player-Season Level Performance
- **R² Score:** 0.0000 (0.00%)
- **Correlation:** 0.0000
- **Players Analyzed:** 0
- **Calibration Ratio:** 0.00x
- **Status:** UNKNOWN

### 2.2 Game-Level Performance
- **R² Score:** 0.0000 (0.00%)
- **Correlation:** 0.0000
- **MAE:** 0.00 goals/game
- **Games Analyzed:** 0
- **Avg xG/Game:** 0.00
- **Avg Goals/Game:** 0.00
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

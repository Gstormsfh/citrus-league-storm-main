# COMPREHENSIVE SYSTEM DIAGNOSTIC AUDIT
**Generated:** 2026-01-03 14:06:09  
**Season:** 2025

---

## EXECUTIVE SUMMARY

### Overall System Health
- **Health Score:** 100.0%
- **Status:** ✅ EXCELLENT

---

## SECTION 1: DATA EXTRACTION AUDIT

### 1.1 Raw NHL Data (Play-by-Play)
- **Error:** Supabase select failed (raw_nhl_data): 404 {"code":"42883","details":null,"hint":"No operator matches the given name and argument types. You might need to add explicit type casts.","message":"operator does not exist: integer ~~ unknown"}

### 1.2 Raw Shots (xG Model Input)
- **Error:** Supabase select failed (raw_shots): 400 {"code":"42703","details":null,"hint":"Perhaps you meant to reference the column \"raw_shots.shot_x\" or the column \"raw_shots.shot_y\".","message":"column raw_shots.shot_id does not exist"}

### 1.3 Player Game Stats (PBP)

### 1.4 NHL Official Stats

---

## SECTION 2: xG MODEL AUDIT


---

## SECTION 3: GSAx MODEL AUDIT


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

1. ⚠️ **GSAx Model:** No goalie data found - run calculate_goalie_gsax.py

---

*End of Report*

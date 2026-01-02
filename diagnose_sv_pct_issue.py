#!/usr/bin/env python3
"""
Diagnostic script to investigate why league-wide SV% is 0.929 instead of ~0.900-0.905.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

# Set UTF-8 encoding for stdout (Windows compatibility)
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def diagnose_sv_pct(season: int = DEFAULT_SEASON):
    """Run comprehensive diagnostics on SV% calculation."""
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    print("=" * 80)
    print("🔍 DIAGNOSING LEAGUE-WIDE SV% ISSUE")
    print("=" * 80)
    print(f"Season: {season}")
    print()
    
    # 1. Check PBP-calculated stats (what we're currently using)
    print("1️⃣  PBP-CALCULATED STATS (current calculation)")
    print("-" * 80)
    goalie_stats_pbp = db.select(
        "player_season_stats",
        select="player_id,saves,shots_faced,goals_against,goalie_gp,games_played",
        filters=[
            ("season", "eq", season),
            ("is_goalie", "eq", True)
        ]
    )
    
    total_saves_pbp = 0
    total_shots_faced_pbp = 0
    total_goals_against_pbp = 0
    goalies_with_data = 0
    
    for g in goalie_stats_pbp:
        saves = int(g.get("saves", 0))
        shots_faced = int(g.get("shots_faced", 0))
        goals_against = int(g.get("goals_against", 0))
        
        if shots_faced > 0:
            total_saves_pbp += saves
            total_shots_faced_pbp += shots_faced
            total_goals_against_pbp += goals_against
            goalies_with_data += 1
    
    sv_pct_pbp = (total_saves_pbp / total_shots_faced_pbp) if total_shots_faced_pbp > 0 else 0
    
    print(f"   Goalies with data: {goalies_with_data}")
    print(f"   Total saves: {total_saves_pbp:,}")
    print(f"   Total shots faced: {total_shots_faced_pbp:,}")
    print(f"   Total goals against: {total_goals_against_pbp:,}")
    print(f"   Calculated SV%: {sv_pct_pbp:.3f}")
    print(f"   Expected SV%: 0.900-0.905")
    print(f"   ⚠️  DIFFERENCE: {sv_pct_pbp - 0.902:.3f} (should be ~0)")
    
    # Verify: saves + goals_against should equal shots_faced
    expected_shots = total_saves_pbp + total_goals_against_pbp
    if abs(expected_shots - total_shots_faced_pbp) > 10:
        print(f"   ⚠️  WARNING: saves + goals_against ({expected_shots:,}) != shots_faced ({total_shots_faced_pbp:,})")
        print(f"      Difference: {abs(expected_shots - total_shots_faced_pbp):,}")
    else:
        print(f"   ✅ Data integrity: saves + goals_against = shots_faced")
    print()
    
    # 2. Check NHL official stats (alternative source)
    print("2️⃣  NHL OFFICIAL STATS (alternative source)")
    print("-" * 80)
    goalie_stats_nhl = db.select(
        "player_season_stats",
        select="player_id,nhl_saves,nhl_shots_faced,nhl_goals_against,nhl_save_pct,goalie_gp",
        filters=[
            ("season", "eq", season),
            ("is_goalie", "eq", True)
        ]
    )
    
    total_saves_nhl = 0
    total_shots_faced_nhl = 0
    total_goals_against_nhl = 0
    goalies_with_nhl_data = 0
    
    for g in goalie_stats_nhl:
        saves = int(g.get("nhl_saves", 0))
        shots_faced = int(g.get("nhl_shots_faced", 0))
        goals_against = int(g.get("nhl_goals_against", 0))
        
        if shots_faced > 0:
            total_saves_nhl += saves
            total_shots_faced_nhl += shots_faced
            total_goals_against_nhl += goals_against
            goalies_with_nhl_data += 1
    
    sv_pct_nhl = (total_saves_nhl / total_shots_faced_nhl) if total_shots_faced_nhl > 0 else 0
    
    print(f"   Goalies with NHL data: {goalies_with_nhl_data}")
    print(f"   Total saves: {total_saves_nhl:,}")
    print(f"   Total shots faced: {total_shots_faced_nhl:,}")
    print(f"   Total goals against: {total_goals_against_nhl:,}")
    print(f"   Calculated SV%: {sv_pct_nhl:.3f}")
    if sv_pct_nhl > 0:
        print(f"   ⚠️  DIFFERENCE from PBP: {sv_pct_nhl - sv_pct_pbp:.3f}")
    print()
    
    # 3. Check for filtering bias
    print("3️⃣  CHECKING FOR FILTERING BIAS")
    print("-" * 80)
    all_goalies = len(goalie_stats_pbp)
    goalies_with_shots = len([g for g in goalie_stats_pbp if int(g.get("shots_faced", 0)) > 0])
    print(f"   Total goalies in table: {all_goalies}")
    print(f"   Goalies with shots_faced > 0: {goalies_with_shots}")
    
    # Check low-volume goalies
    low_volume_goalies = [g for g in goalie_stats_pbp 
                          if int(g.get("shots_faced", 0)) > 0 and int(g.get("shots_faced", 0)) < 100]
    print(f"   Goalies with <100 shots faced: {len(low_volume_goalies)}")
    if len(low_volume_goalies) > 0:
        low_volume_saves = sum(int(g.get("saves", 0)) for g in low_volume_goalies)
        low_volume_shots = sum(int(g.get("shots_faced", 0)) for g in low_volume_goalies)
        low_volume_sv_pct = (low_volume_saves / low_volume_shots) if low_volume_shots > 0 else 0
        print(f"   Low-volume goalies SV%: {low_volume_sv_pct:.3f}")
        print(f"   Low-volume goalies shots: {low_volume_shots:,} ({100*low_volume_shots/total_shots_faced_pbp:.1f}% of total)")
    print()
    
    # 4. Individual goalie SV% distribution
    print("4️⃣  INDIVIDUAL GOALIE SV% DISTRIBUTION")
    print("-" * 80)
    goalie_sv_pcts = []
    for g in goalie_stats_pbp:
        saves = int(g.get("saves", 0))
        shots_faced = int(g.get("shots_faced", 0))
        if shots_faced > 0:
            sv_pct = saves / shots_faced
            goalie_sv_pcts.append({
                "player_id": g.get("player_id"),
                "sv_pct": sv_pct,
                "shots_faced": shots_faced
            })
    
    goalie_sv_pcts.sort(key=lambda x: x["sv_pct"])
    print(f"   Total goalies analyzed: {len(goalie_sv_pcts)}")
    if goalie_sv_pcts:
        print(f"   Lowest SV%: {goalie_sv_pcts[0]['sv_pct']:.3f} (player_id: {goalie_sv_pcts[0]['player_id']}, shots: {goalie_sv_pcts[0]['shots_faced']})")
        print(f"   Highest SV%: {goalie_sv_pcts[-1]['sv_pct']:.3f} (player_id: {goalie_sv_pcts[-1]['player_id']}, shots: {goalie_sv_pcts[-1]['shots_faced']})")
        
        median_sv_pct = goalie_sv_pcts[len(goalie_sv_pcts)//2]['sv_pct']
        print(f"   Median SV%: {median_sv_pct:.3f}")
        
        weighted_avg = sum(g['sv_pct'] * g['shots_faced'] for g in goalie_sv_pcts) / sum(g['shots_faced'] for g in goalie_sv_pcts)
        print(f"   Weighted average (current calc): {weighted_avg:.3f}")
    print()
    
    # 5. Compare PBP vs NHL for same goalies
    print("5️⃣  COMPARING PBP vs NHL FOR SAME GOALIES")
    print("-" * 80)
    goalie_comparison = []
    for g_pbp in goalie_stats_pbp:
        player_id = g_pbp.get("player_id")
        pbp_saves = int(g_pbp.get("saves", 0))
        pbp_shots = int(g_pbp.get("shots_faced", 0))
        
        # Find matching NHL stats
        nhl_match = next((g for g in goalie_stats_nhl if g.get("player_id") == player_id), None)
        if nhl_match:
            nhl_saves = int(nhl_match.get("nhl_saves", 0))
            nhl_shots = int(nhl_match.get("nhl_shots_faced", 0))
            
            if pbp_shots > 0 or nhl_shots > 0:
                goalie_comparison.append({
                    "player_id": player_id,
                    "pbp_saves": pbp_saves,
                    "pbp_shots": pbp_shots,
                    "pbp_sv_pct": (pbp_saves / pbp_shots) if pbp_shots > 0 else 0,
                    "nhl_saves": nhl_saves,
                    "nhl_shots": nhl_shots,
                    "nhl_sv_pct": (nhl_saves / nhl_shots) if nhl_shots > 0 else 0
                })
    
    if goalie_comparison:
        print(f"   Goalies with both PBP and NHL data: {len(goalie_comparison)}")
        
        # Find goalies with significant differences
        large_diff_goalies = [g for g in goalie_comparison 
                             if abs(g['pbp_shots'] - g['nhl_shots']) > 50 or 
                             (g['pbp_shots'] > 0 and g['nhl_shots'] > 0 and 
                              abs(g['pbp_sv_pct'] - g['nhl_sv_pct']) > 0.05)]
        
        if large_diff_goalies:
            print(f"   ⚠️  Goalies with large PBP vs NHL differences: {len(large_diff_goalies)}")
            print("   Sample differences:")
            for g in large_diff_goalies[:5]:
                print(f"      Player {g['player_id']}: PBP SV%={g['pbp_sv_pct']:.3f} ({g['pbp_saves']}/{g['pbp_shots']}), "
                      f"NHL SV%={g['nhl_sv_pct']:.3f} ({g['nhl_saves']}/{g['nhl_shots']})")
        else:
            print("   ✅ PBP and NHL stats are similar for most goalies")
    print()
    
    # Summary
    print("=" * 80)
    print("📊 DIAGNOSTIC SUMMARY")
    print("=" * 80)
    print(f"Current PBP SV%: {sv_pct_pbp:.3f} (expected: 0.900-0.905)")
    print(f"Current NHL SV%: {sv_pct_nhl:.3f} (if available)")
    print()
    
    if sv_pct_pbp > 0.910:
        print("🔴 ISSUE IDENTIFIED: SV% is too high")
        print()
        print("Possible causes:")
        print("  1. Empty net goals excluded from goals_against but shots included")
        print("  2. Data filtering bias (only qualified/elite goalies)")
        print("  3. PBP calculation error (missing some goals)")
        print("  4. Using wrong data source (should use NHL official stats?)")
        print()
        print("Recommended fixes:")
        if sv_pct_nhl > 0 and abs(sv_pct_nhl - 0.902) < abs(sv_pct_pbp - 0.902):
            print("  ✅ Use NHL official stats (nhl_saves, nhl_shots_faced) instead of PBP")
        else:
            print("  ⚠️  Investigate PBP data quality - check for missing goals")
            print("  ⚠️  Verify empty net goal handling")
            print("  ⚠️  Check if low-volume/poor-performing goalies are being excluded")
    else:
        print("✅ SV% is within expected range")
    
    return {
        "pbp_sv_pct": sv_pct_pbp,
        "nhl_sv_pct": sv_pct_nhl,
        "total_shots_pbp": total_shots_faced_pbp,
        "total_shots_nhl": total_shots_faced_nhl
    }

if __name__ == "__main__":
    season = DEFAULT_SEASON
    if len(sys.argv) > 1:
        try:
            season = int(sys.argv[1])
        except ValueError:
            print(f"⚠️  Invalid season argument: {sys.argv[1]}. Using default: {DEFAULT_SEASON}")
    
    results = diagnose_sv_pct(season)


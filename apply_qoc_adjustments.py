#!/usr/bin/env python3
"""
apply_qoc_adjustments.py
Apply Quality of Competition (QoC) adjustments to fantasy projections using GAR components.

This script:
1. Loads player GAR components from player_gar_components table
2. For each player-opponent matchup, calculates QoC adjustment factor
3. Applies adjustment to base talent-adjusted xG projection
4. Returns adjusted projections for use in fantasy_projection_pipeline.py

QoC Adjustment Formula:
- For Even Strength: QoC_Factor = (Player_EVO - Opponent_EVD) × Adjustment_Strength
- For Power Play: QoC_Factor = (Player_PPO - Opponent_PPD) × Adjustment_Strength
- Adjusted_xG = Base_Talent_Adjusted_xG × (1 + QoC_Factor)

Where Adjustment_Strength is a tuning parameter (default: 0.1 = 10% adjustment)
"""

import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from typing import Dict, Optional, List, Tuple

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print("❌ Error: Supabase credentials not found in .env file")
    print("   Please ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set")
    exit(1)

supabase: Client = create_client(supabase_url, supabase_key)

# QoC adjustment strength (configurable)
# 0.1 = 10% adjustment, 0.05 = 5% adjustment, etc.
QOC_ADJUSTMENT_STRENGTH = 0.1


def load_gar_components(player_ids: Optional[List[int]] = None, season: int = 2025):
    """
    Load GAR components for specified players.
    
    Args:
        player_ids: List of player IDs to load (None = all players)
        season: Season year (default: 2025)
    
    Returns:
        DataFrame with player_id and GAR component rates
    """
    try:
        query = supabase.table('player_gar_components').select(
            'player_id, evo_rate_regressed, evd_rate_regressed, '
            'ppo_rate_regressed, ppd_rate_regressed'
        ).eq('season', season)
        
        if player_ids:
            query = query.in_('player_id', player_ids)
        
        result = query.execute()
        
        if not result.data:
            return pd.DataFrame()
        
        df = pd.DataFrame(result.data)
        return df
        
    except Exception as e:
        print(f"❌ Error loading GAR components: {e}")
        return pd.DataFrame()


def get_opponent_team_gar(opponent_team_id: int, component: str, season: int = 2025):
    """
    Get average GAR component rate for an opponent team.
    
    For defensive components (EVD, PPD), we average across all skaters on the team.
    For offensive components (EVO, PPO), we average across forwards only.
    
    Args:
        opponent_team_id: Team ID of opponent
        component: Component name ('evo', 'evd', 'ppo', 'ppd')
        season: Season year (default: 2025)
    
    Returns:
        Average component rate for the team
    """
    # TODO: This requires team_id mapping from player_id
    # For now, return a placeholder
    # In full implementation, we'd:
    # 1. Get all players on opponent_team_id
    # 2. Filter by position if needed (forwards for EVO/PPO, all for EVD/PPD)
    # 3. Average their regressed component rates
    
    # Placeholder: return 0.0 (no adjustment) if team data not available
    return 0.0


def calculate_qoc_adjustment(player_id: int, opponent_team_id: int, 
                             situation: str, df_gar: pd.DataFrame) -> float:
    """
    Calculate QoC adjustment factor for a player-opponent matchup.
    
    Args:
        player_id: Player ID
        opponent_team_id: Opponent team ID
        situation: Game situation ('5v5', 'PP', 'PK')
        df_gar: DataFrame with GAR components
    
    Returns:
        QoC adjustment factor (multiplier for xG projection)
    """
    # Get player's GAR component
    player_data = df_gar[df_gar['player_id'] == player_id]
    
    if len(player_data) == 0:
        return 0.0  # No adjustment if player data not available
    
    player_row = player_data.iloc[0]
    
    # Determine which components to use based on situation
    if situation == '5v5':
        # Even strength: Player EVO vs Opponent EVD
        player_component = player_row.get('evo_rate_regressed', 0.0)
        opponent_component = get_opponent_team_gar(opponent_team_id, 'evd')
        
    elif situation == 'PP':
        # Power play: Player PPO vs Opponent PPD
        player_component = player_row.get('ppo_rate_regressed', 0.0)
        opponent_component = get_opponent_team_gar(opponent_team_id, 'ppd')
        
    elif situation == 'PK':
        # Penalty kill: Player PPD vs Opponent PPO (inverted)
        player_component = player_row.get('ppd_rate_regressed', 0.0)
        opponent_component = get_opponent_team_gar(opponent_team_id, 'ppo')
        # For PK, we invert the adjustment (better opponent PPO = harder for player)
        opponent_component = -opponent_component
        
    else:
        return 0.0  # Unknown situation
    
    # Calculate adjustment factor
    # QoC_Factor = (Player_Component - Opponent_Component) × Adjustment_Strength
    qoc_factor = (player_component - opponent_component) * QOC_ADJUSTMENT_STRENGTH
    
    # Convert to multiplier (1 + factor)
    # Positive factor = increase xG, negative factor = decrease xG
    adjustment_multiplier = 1.0 + qoc_factor
    
    return adjustment_multiplier


def apply_qoc_to_projections(df_projections: pd.DataFrame, 
                             season: int = 2025) -> pd.DataFrame:
    """
    Apply QoC adjustments to a DataFrame of projections.
    
    Args:
        df_projections: DataFrame with columns:
            - player_id: Player ID
            - opponent_team_id: Opponent team ID
            - situation: Game situation ('5v5', 'PP', 'PK')
            - base_xg: Base talent-adjusted xG projection
        season: Season year (default: 2025)
    
    Returns:
        DataFrame with qoc_adjustment_factor and adjusted_xg columns added
    """
    print("=" * 80)
    print("APPLYING QUALITY OF COMPETITION ADJUSTMENTS")
    print("=" * 80)
    
    # Get unique player IDs
    player_ids = df_projections['player_id'].unique().tolist()
    
    # Load GAR components for all players
    print(f"Loading GAR components for {len(player_ids):,} players...")
    df_gar = load_gar_components(player_ids, season)
    
    if len(df_gar) == 0:
        print("⚠️  No GAR components found. Skipping QoC adjustments.")
        df_projections['qoc_adjustment_factor'] = 1.0
        df_projections['adjusted_xg'] = df_projections['base_xg']
        return df_projections
    
    print(f"✅ Loaded GAR components for {len(df_gar):,} players")
    
    # Apply QoC adjustment to each projection
    print("Calculating QoC adjustments...")
    
    qoc_factors = []
    for _, row in df_projections.iterrows():
        factor = calculate_qoc_adjustment(
            row['player_id'],
            row.get('opponent_team_id', 0),
            row.get('situation', '5v5'),
            df_gar
        )
        qoc_factors.append(factor)
    
    df_projections['qoc_adjustment_factor'] = qoc_factors
    df_projections['adjusted_xg'] = df_projections['base_xg'] * df_projections['qoc_adjustment_factor']
    
    print(f"✅ Applied QoC adjustments to {len(df_projections):,} projections")
    print(f"   Average adjustment factor: {df_projections['qoc_adjustment_factor'].mean():.4f}")
    print(f"   Adjustment range: [{df_projections['qoc_adjustment_factor'].min():.4f}, {df_projections['qoc_adjustment_factor'].max():.4f}]")
    
    return df_projections


def main():
    """
    Main function for testing QoC adjustments.
    """
    print("=" * 80)
    print("QUALITY OF COMPETITION ADJUSTMENTS")
    print("=" * 80)
    print()
    print("This script is designed to be imported and used by fantasy_projection_pipeline.py")
    print("For standalone testing, create a test DataFrame with player projections.")
    print()


if __name__ == "__main__":
    main()


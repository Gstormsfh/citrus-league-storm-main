#!/usr/bin/env python3
"""
validation_utils.py
Shared utilities for GSAx and GAR validation framework.

Provides common functions for:
- Loading data from Supabase with pagination
- Calculating correlations and statistical tests
- Generating plots and visualizations
- Exporting results to CSV/JSON
"""

import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from scipy.stats import pearsonr
from sklearn.metrics import r2_score
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
from typing import Dict, List, Optional, Tuple

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    raise ValueError("Missing Supabase credentials. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")

supabase: Client = create_client(supabase_url, supabase_key)


def load_shots_with_pagination(
    columns: List[str],
    filters: Optional[Dict] = None,
    batch_size: int = 1000
) -> pd.DataFrame:
    """
    Load shots data from raw_shots table with pagination.
    
    Args:
        columns: List of column names to select
        filters: Optional dictionary of filters (e.g., {'is_empty_net': False})
        batch_size: Number of records per batch
    
    Returns:
        DataFrame with all matching records
    """
    all_shots = []
    offset = 0
    
    while True:
        query = supabase.table('raw_shots').select(','.join(columns))
        
        # Apply filters if provided
        if filters:
            for key, value in filters.items():
                if value is not None:
                    if isinstance(value, bool):
                        query = query.eq(key, value)
                    elif isinstance(value, (int, float)):
                        query = query.eq(key, value)
                    elif isinstance(value, list):
                        query = query.in_(key, value)
        
        response = query.range(offset, offset + batch_size - 1).execute()
        
        if not response.data or len(response.data) == 0:
            break
        
        all_shots.extend(response.data)
        
        if len(response.data) < batch_size:
            break
        
        offset += batch_size
        if offset % 10000 == 0:
            print(f"  Loaded {len(all_shots):,} records...")
    
    if len(all_shots) == 0:
        return pd.DataFrame()
    
    df = pd.DataFrame(all_shots)
    return df


def calculate_correlation(
    x: pd.Series,
    y: pd.Series,
    method: str = 'pearson'
) -> Tuple[float, float]:
    """
    Calculate correlation coefficient and p-value.
    
    Args:
        x: First variable
        y: Second variable
        method: 'pearson' or 'spearman'
    
    Returns:
        Tuple of (correlation_coefficient, p_value)
    """
    # Remove NaN values
    mask = ~(x.isna() | y.isna())
    x_clean = x[mask]
    y_clean = y[mask]
    
    if len(x_clean) < 2:
        return np.nan, np.nan
    
    if method == 'pearson':
        corr, p_value = pearsonr(x_clean, y_clean)
    else:
        from scipy.stats import spearmanr
        corr, p_value = spearmanr(x_clean, y_clean)
    
    return corr, p_value


def calculate_r2(y_true: pd.Series, y_pred: pd.Series) -> float:
    """
    Calculate R² score.
    
    Args:
        y_true: Actual values
        y_pred: Predicted values
    
    Returns:
        R² score
    """
    mask = ~(y_true.isna() | y_pred.isna())
    if mask.sum() < 2:
        return np.nan
    
    return r2_score(y_true[mask], y_pred[mask])


def create_scatter_plot(
    x: pd.Series,
    y: pd.Series,
    xlabel: str,
    ylabel: str,
    title: str,
    filename: Optional[str] = None,
    show_regression: bool = True,
    show_correlation: bool = True
) -> None:
    """
    Create a scatter plot with optional regression line and correlation annotation.
    
    Args:
        x: X-axis data
        y: Y-axis data
        xlabel: X-axis label
        ylabel: Y-axis label
        title: Plot title
        filename: Optional filename to save plot
        show_regression: Whether to show regression line
        show_correlation: Whether to show correlation coefficient
    """
    # Remove NaN values
    mask = ~(x.isna() | y.isna())
    x_clean = x[mask]
    y_clean = y[mask]
    
    if len(x_clean) == 0:
        print(f"⚠️  No valid data points for plot: {title}")
        return
    
    plt.figure(figsize=(10, 8))
    plt.scatter(x_clean, y_clean, alpha=0.6, s=50)
    
    # Add regression line
    if show_regression and len(x_clean) > 1:
        z = np.polyfit(x_clean, y_clean, 1)
        p = np.poly1d(z)
        plt.plot(x_clean, p(x_clean), "r--", alpha=0.8, linewidth=2, label=f'Regression: y={z[0]:.4f}x+{z[1]:.4f}')
        plt.legend()
    
    # Add correlation annotation
    if show_correlation:
        corr, p_value = calculate_correlation(x_clean, y_clean)
        if not np.isnan(corr):
            plt.text(0.05, 0.95, f'r = {corr:.4f}\np = {p_value:.4f}', 
                    transform=plt.gca().transAxes, 
                    verticalalignment='top',
                    bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
    
    plt.xlabel(xlabel)
    plt.ylabel(ylabel)
    plt.title(title)
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    
    if filename:
        plt.savefig(filename, dpi=300, bbox_inches='tight')
        print(f"✅ Saved plot: {filename}")
    else:
        plt.show()
    
    plt.close()


def create_correlation_heatmap(
    df: pd.DataFrame,
    title: str,
    filename: Optional[str] = None
) -> None:
    """
    Create a correlation heatmap for a DataFrame.
    
    Args:
        df: DataFrame with numeric columns
        title: Plot title
        filename: Optional filename to save plot
    """
    # Calculate correlation matrix
    corr_matrix = df.corr()
    
    plt.figure(figsize=(12, 10))
    sns.heatmap(corr_matrix, annot=True, fmt='.3f', cmap='coolwarm', 
                center=0, square=True, linewidths=1, cbar_kws={"shrink": 0.8})
    plt.title(title)
    plt.tight_layout()
    
    if filename:
        plt.savefig(filename, dpi=300, bbox_inches='tight')
        print(f"✅ Saved heatmap: {filename}")
    else:
        plt.show()
    
    plt.close()


def export_results_to_csv(
    data: pd.DataFrame,
    filename: str,
    description: str = ""
) -> None:
    """
    Export results DataFrame to CSV.
    
    Args:
        data: DataFrame to export
        filename: Output filename
        description: Optional description for logging
    """
    try:
        data.to_csv(filename, index=False)
        print(f"✅ Exported {len(data):,} rows to {filename}")
        if description:
            print(f"   {description}")
    except Exception as e:
        print(f"❌ Error exporting to {filename}: {e}")


def export_results_to_json(
    data: Dict,
    filename: str
) -> None:
    """
    Export results dictionary to JSON.
    
    Args:
        data: Dictionary to export
        filename: Output filename
    """
    import json
    try:
        with open(filename, 'w') as f:
            json.dump(data, f, indent=2, default=str)
        print(f"✅ Exported results to {filename}")
    except Exception as e:
        print(f"❌ Error exporting to {filename}: {e}")


def calculate_gsax_regressed(
    total_shots_faced: int,
    raw_gsax: float,
    C: int = 1000
) -> float:
    """
    Calculate regressed GSAx using Bayesian regression formula.
    
    Formula: GSAx_reg = (S / (S + C)) × Raw_GSAx + (C / (S + C)) × 0
    
    Args:
        total_shots_faced: Number of shots faced (S)
        raw_gsax: Raw GSAx value
        C: Prior strength constant (default 1000)
    
    Returns:
        Regressed GSAx value
    """
    if total_shots_faced == 0:
        return 0.0
    
    weight = total_shots_faced / (total_shots_faced + C)
    regressed_gsax = weight * raw_gsax + (1 - weight) * 0.0
    
    return regressed_gsax


def calculate_raw_gsax_from_shots(
    shots_df: pd.DataFrame,
    xg_column: str = 'shooting_talent_adjusted_xg',
    goal_column: str = 'is_goal'
) -> Tuple[float, int, int]:
    """
    Calculate raw GSAx from a shots DataFrame.
    
    Args:
        shots_df: DataFrame with shots data
        xg_column: Column name for xG values
        goal_column: Column name for goal indicator
    
    Returns:
        Tuple of (raw_gsax, total_xGA, total_GA)
    """
    # Handle fallback for xG column
    if xg_column not in shots_df.columns:
        if 'flurry_adjusted_xg' in shots_df.columns:
            xg_column = 'flurry_adjusted_xg'
        elif 'xg_value' in shots_df.columns:
            xg_column = 'xg_value'
        else:
            raise ValueError(f"Could not find xG column in DataFrame")
    
    # Ensure numeric types
    shots_df = shots_df.copy()
    shots_df[xg_column] = pd.to_numeric(shots_df[xg_column], errors='coerce').fillna(0.0)
    shots_df[goal_column] = pd.to_numeric(shots_df[goal_column], errors='coerce').fillna(0).astype(int)
    
    # Filter out NaN values
    shots_df = shots_df[shots_df[xg_column].notna()].copy()
    
    total_xGA = shots_df[xg_column].sum()
    total_GA = shots_df[goal_column].sum()
    raw_gsax = total_xGA - total_GA
    
    return raw_gsax, total_xGA, total_GA


def get_game_dates() -> pd.DataFrame:
    """
    Load game dates from nhl_games table to enable season splitting.
    
    Returns:
        DataFrame with game_id and game_date columns
    """
    try:
        all_games = []
        offset = 0
        batch_size = 1000
        
        while True:
            response = supabase.table('nhl_games').select(
                'game_id, game_date'
            ).range(offset, offset + batch_size - 1).execute()
            
            if not response.data or len(response.data) == 0:
                break
            
            all_games.extend(response.data)
            
            if len(response.data) < batch_size:
                break
            
            offset += batch_size
        
        if len(all_games) == 0:
            return pd.DataFrame(columns=['game_id', 'game_date'])
        
        df = pd.DataFrame(all_games)
        df['game_date'] = pd.to_datetime(df['game_date'], errors='coerce')
        
        return df
        
    except Exception as e:
        print(f"⚠️  Error loading game dates: {e}")
        return pd.DataFrame(columns=['game_id', 'game_date'])


def print_validation_summary(
    test_name: str,
    correlation: float,
    p_value: float,
    n_samples: int,
    success_threshold: float = 0.50
) -> None:
    """
    Print a formatted validation summary.
    
    Args:
        test_name: Name of the validation test
        correlation: Correlation coefficient
        p_value: P-value
        n_samples: Number of samples
        success_threshold: Minimum correlation for success
    """
    print("\n" + "=" * 80)
    print(f"VALIDATION SUMMARY: {test_name}")
    print("=" * 80)
    print(f"Correlation coefficient (r): {correlation:.4f}")
    print(f"P-value: {p_value:.4f}")
    print(f"Sample size: {n_samples:,}")
    print(f"Success threshold: r > {success_threshold:.2f}")
    
    if np.isnan(correlation):
        print("❌ Invalid correlation (NaN)")
    elif correlation >= success_threshold:
        print(f"✅ PASS: Correlation ({correlation:.4f}) exceeds threshold ({success_threshold:.2f})")
    else:
        print(f"⚠️  WARNING: Correlation ({correlation:.4f}) below threshold ({success_threshold:.2f})")
    
    if p_value < 0.05:
        print(f"✅ Statistically significant (p < 0.05)")
    else:
        print(f"⚠️  Not statistically significant (p >= 0.05)")


def ensure_output_directory(directory: str = 'validation_results') -> str:
    """
    Ensure output directory exists, create if it doesn't.
    
    Args:
        directory: Directory name
    
    Returns:
        Full path to directory
    """
    if not os.path.exists(directory):
        os.makedirs(directory)
        print(f"✅ Created output directory: {directory}")
    
    return directory


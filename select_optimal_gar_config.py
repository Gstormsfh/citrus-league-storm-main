"""
Select optimal G-GAR configuration based on stability test results.

This script loads stability test results for all configurations and selects
the best one based on correlation with baseline (r > 0.1721).
"""

import pandas as pd
import os
from supabase import create_client, Client
from datetime import datetime

# Supabase connection
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def load_stability_results():
    """Load stability test results for all configurations."""
    summary_path = 'validation_results/goalie_gar_stability_summary.csv'
    
    if not os.path.exists(summary_path):
        print(f"ERROR: Stability summary not found at {summary_path}")
        print("Run validate_goalie_gar_stability.py first")
        return None
    
    df = pd.read_csv(summary_path)
    return df


def select_optimal_config(stability_df):
    """
    Select optimal configuration based on stability results.
    
    Criteria:
    1. Highest correlation r > baseline (0.1721)
    2. If multiple pass, select highest r
    3. Prefer configurations with reasonable weight distribution
    """
    baseline_r = 0.1721
    
    # Filter configurations that exceed baseline
    passing_configs = stability_df[stability_df['correlation_r'] > baseline_r].copy()
    
    if len(passing_configs) == 0:
        print("WARNING: No configurations exceed baseline (r = 0.1721)")
        print("Selecting configuration with highest correlation anyway...")
        passing_configs = stability_df.copy()
    
    # Sort by correlation (descending)
    passing_configs = passing_configs.sort_values('correlation_r', ascending=False)
    
    # Select best
    best_config = passing_configs.iloc[0]
    
    return best_config


def update_goalie_gar_table(optimal_config_name):
    """Update goalie_gar table to use optimal configuration as primary total_gar."""
    print("\n" + "=" * 80)
    print("UPDATING GOALIE_GAR TABLE WITH OPTIMAL CONFIGURATION")
    print("=" * 80)
    
    # Load all configurations from CSV
    gar_df = pd.read_csv('goalie_gar_all_configs.csv')
    
    # Map configuration name to column
    config_column_map = {
        'w30_raw': 'total_gar_w30_raw',
        'w30_c5000': 'total_gar_w30_c5000',
        'w30_c10000': 'total_gar_w30_c10000',
        'w10_c5000': 'total_gar_w10_c5000',
        'w10_c10000': 'total_gar_w10_c10000',
        'w5_c5000': 'total_gar_w5_c5000',
        'w5_c10000': 'total_gar_w5_c10000'
    }
    
    if optimal_config_name not in config_column_map:
        print(f"ERROR: Unknown configuration name: {optimal_config_name}")
        return False
    
    optimal_column = config_column_map[optimal_config_name]
    
    if optimal_column not in gar_df.columns:
        print(f"ERROR: Column {optimal_column} not found in goalie_gar_all_configs.csv")
        return False
    
    # Prepare records to update total_gar with optimal configuration
    records = []
    for _, row in gar_df.iterrows():
        record = {
            'goalie_id': int(row['goalie_id']),
            'total_gar': float(row[optimal_column]) if pd.notna(row[optimal_column]) else None,
            'calculated_at': datetime.now().isoformat()
        }
        records.append(record)
    
    # Upsert in batches
    batch_size = 100
    success_count = 0
    
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        try:
            supabase.table('goalie_gar').upsert(
                batch,
                on_conflict='goalie_id'
            ).execute()
            success_count += len(batch)
        except Exception as e:
            print(f"WARNING: Failed to upsert batch: {e}")
            # Try individual inserts
            for record in batch:
                try:
                    supabase.table('goalie_gar').upsert(
                        record,
                        on_conflict='goalie_id'
                    ).execute()
                    success_count += 1
                except Exception as e2:
                    print(f"   WARNING: Failed to upsert goalie_id {record['goalie_id']}: {e2}")
    
    print(f"\nUpdated {success_count:,} goalies with optimal configuration")
    return True


def generate_optimal_config_report(optimal_config):
    """Generate a report on the optimal configuration."""
    report_path = 'validation_results/optimal_gar_configuration.md'
    
    config_descriptions = {
        'w30_raw': 'Raw AdjRP, weights w1=0.3, w2=0.7 (baseline)',
        'w30_c5000': 'Regressed AdjRP (C=5,000), weights w1=0.3, w2=0.7',
        'w30_c10000': 'Regressed AdjRP (C=10,000), weights w1=0.3, w2=0.7',
        'w10_c5000': 'Regressed AdjRP (C=5,000), weights w1=0.10, w2=0.90',
        'w10_c10000': 'Regressed AdjRP (C=10,000), weights w1=0.10, w2=0.90',
        'w5_c5000': 'Regressed AdjRP (C=5,000), weights w1=0.05, w2=0.95',
        'w5_c10000': 'Regressed AdjRP (C=10,000), weights w1=0.05, w2=0.95'
    }
    
    config_name = optimal_config['configuration']
    description = config_descriptions.get(config_name, 'Unknown configuration')
    
    report = f"""# Optimal G-GAR Configuration

## Selected Configuration

**Configuration Name**: `{config_name}`

**Description**: {description}

## Stability Test Results

- **Correlation (r)**: {optimal_config['correlation_r']:.4f}
- **P-value**: {optimal_config['p_value']:.4f}
- **Sample Size**: {int(optimal_config['sample_size'])} goalies
- **Mean Absolute Difference**: {optimal_config['mean_difference']:.4f}
- **Median Absolute Difference**: {optimal_config['median_difference']:.4f}

## Comparison to Baseline

- **Baseline (single GSAx)**: r = 0.1721
- **Improvement**: {((optimal_config['correlation_r'] - 0.1721) / 0.1721 * 100):.1f}%

## Status

{'PASS' if optimal_config['correlation_r'] > 0.1721 else 'FAIL'}: {'Configuration exceeds baseline' if optimal_config['correlation_r'] > 0.1721 else 'Configuration does not exceed baseline'}

## Implementation

The `goalie_gar` table has been updated to use this configuration as the primary `total_gar` value.

Generated: {datetime.now().isoformat()}
"""
    
    os.makedirs('validation_results', exist_ok=True)
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"\nReport saved to {report_path}")


def main():
    """Main execution."""
    print("=" * 80)
    print("SELECTING OPTIMAL G-GAR CONFIGURATION")
    print("=" * 80)
    
    # Load stability results
    stability_df = load_stability_results()
    if stability_df is None:
        return
    
    print(f"\nLoaded stability results for {len(stability_df)} configurations")
    print("\nAll Configuration Results:")
    print("-" * 80)
    for _, row in stability_df.sort_values('correlation_r', ascending=False).iterrows():
        print(f"{row['configuration']:20s}: r = {row['correlation_r']:.4f} (n={int(row['sample_size'])})")
    print("-" * 80)
    
    # Select optimal
    optimal_config = select_optimal_config(stability_df)
    
    print(f"\nSelected Optimal Configuration:")
    print(f"  Name: {optimal_config['configuration']}")
    print(f"  Correlation (r): {optimal_config['correlation_r']:.4f}")
    print(f"  Sample Size: {int(optimal_config['sample_size'])}")
    
    baseline_r = 0.1721
    if optimal_config['correlation_r'] > baseline_r:
        improvement = ((optimal_config['correlation_r'] - baseline_r) / baseline_r * 100)
        print(f"  Improvement over baseline: {improvement:.1f}%")
    else:
        print(f"  WARNING: Does not exceed baseline (r = {baseline_r:.4f})")
    
    # Update database
    update_goalie_gar_table(optimal_config['configuration'])
    
    # Generate report
    generate_optimal_config_report(optimal_config)
    
    print("\n" + "=" * 80)
    print("OPTIMIZATION COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    main()


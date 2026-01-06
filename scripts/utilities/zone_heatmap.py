# zone_heatmap.py
# Create zone-based heatmaps showing xG/pass quality by zone

import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from visualization_utils import fetch_raw_shots, setup_rink, calculate_zone_statistics, get_zone_display_name

def plot_zone_heatmap(metric='xg', game_id=None, player_id=None, date_from=None, date_to=None, save_path=None):
    """
    Create heatmap showing metric values by zone.
    
    Args:
        metric: 'xg', 'pass_quality', 'goalie_movement', 'immediacy', 'lateral_distance'
        game_id: Filter by specific game ID
        player_id: Filter by specific player ID
        date_from: Filter from date
        date_to: Filter to date
        save_path: Path to save figure
    """
    # Fetch data
    df = fetch_raw_shots(game_id=game_id, player_id=player_id,
                        date_from=date_from, date_to=date_to)
    
    if df.empty:
        print("No data to visualize.")
        return
    
    # Filter to shots with passes (zones only meaningful for passes)
    df_passes = df[df['has_pass_before_shot'] == True].copy()
    
    if df_passes.empty:
        print("No shots with passes found.")
        return
    
    # Calculate zone statistics
    zone_stats = calculate_zone_statistics(df_passes)
    
    if zone_stats.empty:
        print("No zone statistics available.")
        return
    
    # Select metric to display
    metric_map = {
        'xg': ('avg_xg', 'Average xG', 'plasma'),
        'pass_quality': ('avg_quality', 'Average Pass Quality', 'viridis'),
        'goalie_movement': ('avg_goalie_movement', 'Average Goalie Movement', 'coolwarm'),
        'immediacy': ('avg_immediacy', 'Average Immediacy', 'YlOrRd'),
        'lateral_distance': ('avg_lateral_distance', 'Average Lateral Distance (ft)', 'YlGnBu')
    }
    
    if metric not in metric_map:
        print(f"Unknown metric: {metric}. Using 'xg'.")
        metric = 'xg'
    
    metric_col, metric_label, cmap = metric_map[metric]
    
    # Set up rink
    rink, ax, fig = setup_rink(display_range='ozone')
    
    # Define zone positions (approximate center of each zone for plotting)
    # These are rough estimates - you may want to adjust based on actual zone boundaries
    zone_positions = {
        'crease': (85, 0),  # Very close to net
        'slot_low_angle': (75, 5),  # Slot, low angle
        'slot_high_angle': (75, 20),  # Slot, high angle
        'high_slot_low_angle': (60, 8),  # High slot, low angle
        'high_slot_high_angle': (60, 25),  # High slot, high angle
        'blue_line_low_angle': (45, 10),  # Blue line, low angle
        'blue_line_high_angle': (45, 30),  # Blue line, high angle
        'deep': (30, 15)  # Deep zone
    }
    
    # Plot zone heatmap
    for idx, row in zone_stats.iterrows():
        zone = row['zone']
        if zone == 'no_pass':
            continue
        
        if zone in zone_positions:
            x, y = zone_positions[zone]
            value = row[metric_col]
            
            # Plot zone as circle with size/color based on metric
            scatter = ax.scatter(x, y, s=2000, c=[value], cmap=cmap,
                              alpha=0.7, edgecolors='black', linewidths=2, zorder=10)
            
            # Add zone label
            ax.text(x, y-5, get_zone_display_name(zone), ha='center', va='top',
                   fontsize=9, fontweight='bold', zorder=11)
            
            # Add value label
            if metric == 'lateral_distance':
                ax.text(x, y+5, f'{value:.1f}ft', ha='center', va='bottom',
                       fontsize=8, zorder=11)
            else:
                ax.text(x, y+5, f'{value:.3f}', ha='center', va='bottom',
                       fontsize=8, zorder=11)
    
    # Add color bar
    values = zone_stats[metric_col].values
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(vmin=values.min(), vmax=values.max()))
    cbar = fig.colorbar(sm, ax=ax, orientation='vertical', fraction=0.04, pad=0.04)
    cbar.set_label(metric_label, rotation=270, labelpad=20, fontsize=12)
    
    # Add title
    title_parts = []
    if game_id:
        title_parts.append(f"Game {game_id}")
    if player_id:
        title_parts.append(f"Player {player_id}")
    title = f"Zone Heatmap - {metric_label}" + (" - " + " | ".join(title_parts) if title_parts else "")
    ax.set_title(title, fontsize=16, fontweight='bold', pad=20)
    
    # Add statistics table
    stats_text = "Zone Statistics:\n"
    for idx, row in zone_stats.iterrows():
        if row['zone'] != 'no_pass':
            stats_text += f"{get_zone_display_name(row['zone'])}: {row['shot_count']} shots, {row['goals']} goals\n"
    
    ax.text(0.02, 0.02, stats_text, transform=ax.transAxes,
            fontsize=9, verticalalignment='bottom',
            bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
    
    plt.tight_layout()
    
    if save_path:
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        print(f"Figure saved to {save_path}")
    else:
        plt.show()

if __name__ == "__main__":
    # Example usage
    print("🔍 Zone Heatmap Visualizer")
    print("=" * 70)
    
    # Plot xG by zone
    plot_zone_heatmap(metric='xg')
    
    # Uncomment to try other metrics:
    # plot_zone_heatmap(metric='pass_quality')
    # plot_zone_heatmap(metric='goalie_movement')
    # plot_zone_heatmap(metric='lateral_distance')


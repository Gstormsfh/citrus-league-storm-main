# pass_shot_map.py
# Visualize pass-to-shot connections showing lateral movement

import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from visualization_utils import fetch_raw_shots, setup_rink, filter_shots_with_passes, get_zone_colors

def plot_pass_shot_connections(game_id=None, player_id=None, date_from=None, date_to=None,
                               color_by='lateral_distance', min_lateral=None, save_path=None):
    """
    Plot pass locations, shot locations, and connections between them.
    
    Args:
        game_id: Filter by specific game ID
        player_id: Filter by specific player ID
        date_from: Filter from date (YYYY-MM-DD)
        date_to: Filter to date (YYYY-MM-DD)
        color_by: What to color lines by ('lateral_distance', 'pass_quality', 'goalie_movement', 'immediacy')
        min_lateral: Minimum lateral distance to show (filters out short passes)
        save_path: Path to save figure
    """
    # Fetch data
    df = fetch_raw_shots(game_id=game_id, player_id=player_id,
                        date_from=date_from, date_to=date_to)
    
    if df.empty:
        print("No data to visualize.")
        return
    
    # Filter to shots with passes
    df_passes = filter_shots_with_passes(df)
    
    if df_passes.empty:
        print("No shots with passes found.")
        return
    
    # Filter by minimum lateral distance if specified
    if min_lateral:
        df_passes = df_passes[df_passes['pass_lateral_distance'] >= min_lateral].copy()
        print(f"Filtered to passes with lateral distance >= {min_lateral} feet.")
    
    if df_passes.empty:
        print("No data remaining after filters.")
        return
    
    # Set up rink
    rink, ax, fig = setup_rink(display_range='ozone')
    
    # Determine color mapping based on color_by parameter
    if color_by == 'lateral_distance':
        color_values = df_passes['pass_lateral_distance'].values
        color_label = 'Lateral Distance (feet)'
        cmap = 'YlOrRd'  # Yellow to Orange to Red
    elif color_by == 'pass_quality':
        color_values = df_passes['pass_quality_score'].values
        color_label = 'Pass Quality Score'
        cmap = 'viridis'
    elif color_by == 'goalie_movement':
        color_values = df_passes['goalie_movement_score'].values
        color_label = 'Goalie Movement Score'
        cmap = 'plasma'
    elif color_by == 'immediacy':
        color_values = df_passes['pass_immediacy_score'].values
        color_label = 'Pass Immediacy Score'
        cmap = 'coolwarm'
    else:
        color_values = df_passes['pass_lateral_distance'].values
        color_label = 'Lateral Distance (feet)'
        cmap = 'YlOrRd'
    
    # Plot pass-to-shot connections
    for i, (idx, row) in enumerate(df_passes.iterrows()):
        if pd.notna(row['pass_x']) and pd.notna(row['pass_y']):
            # Normalize color value for this pass
            if color_values.max() > 0:
                color_norm = color_values[i] / color_values.max()
            else:
                color_norm = 0
            
            # Draw line from pass to shot
            ax.plot([row['pass_x'], row['shot_x']], 
                   [row['pass_y'], row['shot_y']],
                   color=plt.cm.get_cmap(cmap)(color_norm),
                   alpha=0.6,
                   linewidth=2,
                   zorder=5)
    
    # Plot pass locations
    pass_scatter = rink.scatter(
        x=df_passes['pass_x'].values,
        y=df_passes['pass_y'].values,
        ax=ax,
        s=100,
        c=color_values,
        cmap=cmap,
        alpha=0.8,
        zorder=8,
        edgecolors='white',
        linewidths=1,
        label='Pass Location'
    )
    
    # Plot shot locations
    shot_scatter = rink.scatter(
        x=df_passes['shot_x'].values,
        y=df_passes['shot_y'].values,
        ax=ax,
        s=df_passes['xg_value'].values * 800,  # Size by xG
        c='red',
        alpha=0.7,
        zorder=9,
        edgecolors='black',
        linewidths=1.5,
        marker='*',
        label='Shot Location'
    )
    
    # Add color bar
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(vmin=color_values.min(), vmax=color_values.max()))
    cbar = fig.colorbar(sm, ax=ax, orientation='vertical', fraction=0.04, pad=0.04)
    cbar.set_label(color_label, rotation=270, labelpad=20, fontsize=12)
    
    # Add legend
    ax.legend(loc='upper right', fontsize=10)
    
    # Add title
    title_parts = []
    if game_id:
        title_parts.append(f"Game {game_id}")
    if player_id:
        title_parts.append(f"Player {player_id}")
    if min_lateral:
        title_parts.append(f"Lateral >= {min_lateral}ft")
    title = "Pass-to-Shot Connections" + (" - " + " | ".join(title_parts) if title_parts else "")
    ax.set_title(title, fontsize=16, fontweight='bold', pad=20)
    
    # Add statistics
    stats_text = (
        f"Passes Shown: {len(df_passes)}\n"
        f"Avg Lateral Distance: {df_passes['pass_lateral_distance'].mean():.1f} ft\n"
        f"Avg xG: {df_passes['xg_value'].mean():.3f}\n"
        f"Goals: {df_passes['is_goal'].sum()}\n"
        f"Avg Goalie Movement: {df_passes['goalie_movement_score'].mean():.2f}"
    )
    ax.text(0.02, 0.98, stats_text, transform=ax.transAxes,
            fontsize=10, verticalalignment='top',
            bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.8))
    
    plt.tight_layout()
    
    if save_path:
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        print(f"Figure saved to {save_path}")
    else:
        plt.show()

if __name__ == "__main__":
    # Example usage
    print("🔍 Pass-to-Shot Connection Visualizer")
    print("=" * 70)
    
    # Plot all pass-to-shot connections
    plot_pass_shot_connections()
    
    # Uncomment to filter:
    # plot_pass_shot_connections(game_id=2025020453)  # Specific game
    # plot_pass_shot_connections(min_lateral=5.0)  # Only passes >= 5ft lateral
    # plot_pass_shot_connections(color_by='goalie_movement')  # Color by goalie movement


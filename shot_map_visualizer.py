# shot_map_visualizer.py
# Visualize shot locations with xG values on NHL rink

import pandas as pd
import matplotlib.pyplot as plt
from visualization_utils import fetch_raw_shots, setup_rink

def plot_shot_map(game_id=None, player_id=None, date_from=None, date_to=None, 
                  show_goals_only=False, min_xg=None, save_path=None):
    """
    Plot shot locations with xG values on NHL rink.
    
    Args:
        game_id: Filter by specific game ID
        player_id: Filter by specific player ID
        date_from: Filter from date (YYYY-MM-DD)
        date_to: Filter to date (YYYY-MM-DD)
        show_goals_only: If True, only show shots that resulted in goals
        min_xg: Minimum xG value to display
        save_path: Path to save figure (if None, displays interactively)
    """
    # Fetch data
    df = fetch_raw_shots(game_id=game_id, player_id=player_id, 
                        date_from=date_from, date_to=date_to)
    
    if df.empty:
        print("No data to visualize.")
        return
    
    # Apply filters
    if show_goals_only:
        df = df[df['is_goal'] == True].copy()
        print(f"Filtered to {len(df)} goals.")
    
    if min_xg:
        df = df[df['xg_value'] >= min_xg].copy()
        print(f"Filtered to shots with xG >= {min_xg}.")
    
    if df.empty:
        print("No data remaining after filters.")
        return
    
    # Set up rink
    rink, ax, fig = setup_rink(display_range='ozone')
    
    # Plot shots
    scatter = rink.scatter(
        x=df['shot_x'].values,
        y=df['shot_y'].values,
        ax=ax,
        s=df['xg_value'].values * 1000,  # Size based on xG (scale up for visibility)
        c=df['xg_value'].values,  # Color based on xG
        cmap='plasma',  # Heatmap color scheme
        alpha=0.7,
        zorder=10,
        edgecolors='black',
        linewidths=0.5
    )
    
    # Add color bar
    cbar = fig.colorbar(scatter, ax=ax, orientation='vertical', fraction=0.04, pad=0.04)
    cbar.set_label('Expected Goal (xG) Probability', rotation=270, labelpad=20, fontsize=12)
    
    # Add title
    title_parts = []
    if game_id:
        title_parts.append(f"Game {game_id}")
    if player_id:
        title_parts.append(f"Player {player_id}")
    if show_goals_only:
        title_parts.append("Goals Only")
    title = "Shot Map - Expected Goals (xG)" + (" - " + " | ".join(title_parts) if title_parts else "")
    ax.set_title(title, fontsize=16, fontweight='bold', pad=20)
    
    # Add statistics text
    stats_text = (
        f"Total Shots: {len(df)}\n"
        f"Goals: {df['is_goal'].sum()}\n"
        f"Avg xG: {df['xg_value'].mean():.3f}\n"
        f"Total xG: {df['xg_value'].sum():.2f}"
    )
    ax.text(0.02, 0.98, stats_text, transform=ax.transAxes, 
            fontsize=10, verticalalignment='top',
            bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
    
    plt.tight_layout()
    
    if save_path:
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        print(f"Figure saved to {save_path}")
    else:
        plt.show()

if __name__ == "__main__":
    # Example usage
    print("🔍 Shot Map Visualizer")
    print("=" * 70)
    
    # Plot all shots from recent games
    plot_shot_map()
    
    # Uncomment to filter:
    # plot_shot_map(game_id=2025020453)  # Specific game
    # plot_shot_map(show_goals_only=True)  # Only goals
    # plot_shot_map(min_xg=0.15)  # High xG shots only


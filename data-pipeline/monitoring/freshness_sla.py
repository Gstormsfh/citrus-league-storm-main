#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Declared per-table freshness SLA matrix consumed by check_data_freshness.py
# Last active: 2026-05-06
# Invoked:     imported by check_data_freshness.py
# Reads:       (constants only — no I/O)
# Writes:      (constants only — no I/O)
# ────────────────────────────────────────────────────────────
"""
freshness_sla.py — single source of truth for per-table data-freshness SLAs.

Background (R7-3, 2026-05-06):
  Replaces the prior 3-table ad-hoc check_data_freshness.py with a declared matrix
  covering every Phase 0–touching table. Each row states the timestamp column
  that drives the staleness signal, the max acceptable staleness in-season vs
  offseason, breach severity (page vs warn), and rationale.

Severity convention:
  - "page" — wakes someone up. PagerDuty + Slack via AlertManager.
              Reserved for user-trust-critical breakage.
  - "warn" — Slack only, no paging. Operator triages on next business hour.

In-season vs offseason:
  Detected dynamically by check_data_freshness.py via nhl_games for any game in
  [now-24h, now+24h]. Hardcoded calendar windows fail for playoff overruns,
  preseason variation, and irregular schedules.

Special-case handling:
  - matchup_scoring_snapshots — only `created_at` exists; aggregator=max_created.
  - player_playoff_stats     — skipped outside playoff window (April–June).
  - fantasy_daily_rosters    — offseason_hours=None ⇒ skip entirely outside game days.

Calibrations applied (Garrett review 2026-05-06):
  - PAGE reduced from 7 to 2 tables (only fantasy_daily_rosters + matchup_scoring_snapshots).
  - raw_nhl_data relaxed from 6h to 12h game-day to avoid ~4am false pages.
  - goalie_gar tightened from 14d to 7d aligned with goalie_gsax family
    (effective after Phase 0d goalie GAR pipeline fix lands).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional


SEVERITY_PAGE = "page"
SEVERITY_WARN = "warn"

WINDOW_PLAYOFFS = "playoffs"  # April 1 – June 30 inclusive


@dataclass(frozen=True)
class FreshnessSLA:
    """Declared freshness SLA for a single table.

    Attributes:
        table:                  public schema table name.
        timestamp_column:       column whose MAX() drives the staleness signal.
        in_season_hours:        max acceptable staleness during a game window.
        offseason_hours:        max acceptable staleness outside game windows.
                                None = skip the check entirely off-window
                                (e.g. fantasy_daily_rosters during summer).
        severity:               "page" or "warn" on breach.
        rationale:              operator-facing reason this threshold was chosen.
        window:                 optional restricted window key. None = year-round.
                                "playoffs" = April–June only; skipped otherwise.
        regular_season_only:    if True, only treat the table as in-season when a
                                regular-season NHL game is in [now-24h, now+24h].
                                Skips through playoffs (where fantasy leagues are
                                typically idle even though NHL games are happening).
    """

    table: str
    timestamp_column: str
    in_season_hours: float
    offseason_hours: Optional[float]
    severity: str
    rationale: str
    window: Optional[str] = None
    regular_season_only: bool = False


# ──────────────────────────────────────────────────────────────────────────────
# TIER A — Live ingestion (drives the entire pipeline)
# ──────────────────────────────────────────────────────────────────────────────
TIER_A: List[FreshnessSLA] = [
    FreshnessSLA(
        table="raw_nhl_data",
        timestamp_column="scraped_at",
        in_season_hours=12.0,
        offseason_hours=48.0,
        severity=SEVERITY_WARN,
        rationale=(
            "Source of truth for the entire downstream pipeline. Relaxed from "
            "6h to 12h game-day so late-game scrape lag does not page at 4am — "
            "8–12h triggers ~6-8am triage timing instead."
        ),
    ),
    FreshnessSLA(
        table="nhl_games",
        timestamp_column="updated_at",
        in_season_hours=6.0,
        offseason_hours=48.0,
        severity=SEVERITY_WARN,
        rationale="Schedule + final scores. Drives lineup-lock logic but rarely the actual blocker.",
    ),
    FreshnessSLA(
        table="raw_shots",
        timestamp_column="updated_at",
        in_season_hours=12.0,
        offseason_hours=72.0,
        severity=SEVERITY_WARN,
        rationale="Derived from raw_nhl_data; tolerable lag for shot-feature extraction.",
    ),
    FreshnessSLA(
        table="player_shifts_official",
        timestamp_column="updated_at",
        in_season_hours=24.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale="Authoritative shift data; downstream of NHL official feed.",
    ),
    # player_shifts was removed from this matrix on 2026-08-26. It was never
    # shift data: calculate_player_toi.py inferred intervals from the events a
    # player happened to appear in, and the table reconciled with
    # player_game_stats.nhl_toi_seconds for 4.0% of player-games. Watching it
    # for freshness was watching the wrong thing twice over -- it was FRESH and
    # WRONG from its first row in 2017, and the WARN it did eventually raise
    # every hour from 4 January onward went to a Slack webhook that is unset.
    # Correctness now lives in check_data_invariants.py, which fails the build.
    # player_shifts_official above is the real thing and stays.
    FreshnessSLA(
        table="player_toi_by_situation",
        timestamp_column="updated_at",
        in_season_hours=24.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale="Daily TOI-by-situation roll-up.",
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# TIER B — Player stats (daily roll-ups, fantasy-visible)
# ──────────────────────────────────────────────────────────────────────────────
TIER_B: List[FreshnessSLA] = [
    FreshnessSLA(
        table="player_game_stats",
        timestamp_column="updated_at",
        in_season_hours=12.0,
        offseason_hours=72.0,
        severity=SEVERITY_WARN,
        rationale=(
            "Powers every player card + scoring. Stale = users see wrong stats — "
            "but a 12h gap is recoverable without a 3am page."
        ),
    ),
    FreshnessSLA(
        table="player_season_stats",
        timestamp_column="updated_at",
        in_season_hours=24.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale="Headline numbers on dashboards.",
    ),
    FreshnessSLA(
        table="player_directory",
        timestamp_column="updated_at",
        in_season_hours=48.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale="Roster/team metadata; rarely changes day-to-day.",
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# TIER C — Model outputs (projection-critical)
# ──────────────────────────────────────────────────────────────────────────────
TIER_C: List[FreshnessSLA] = [
    FreshnessSLA(
        table="player_projected_stats",
        timestamp_column="updated_at",
        in_season_hours=24.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale=(
            "'Should I start them tonight?' depends on this. Stale projections "
            "are suboptimal but not a crisis — WARN, not PAGE."
        ),
    ),
    FreshnessSLA(
        table="player_ros_projections",
        timestamp_column="updated_at",
        in_season_hours=48.0,
        offseason_hours=336.0,
        severity=SEVERITY_WARN,
        rationale="Trade/waiver decisions depend on ROS; not 3am-worthy.",
    ),
    FreshnessSLA(
        table="player_talent_metrics",
        timestamp_column="last_updated",
        in_season_hours=168.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale="Talent moves slowly; weekly cadence acceptable year-round.",
    ),
    FreshnessSLA(
        table="player_gar_components",
        timestamp_column="calculated_at",
        in_season_hours=336.0,
        offseason_hours=336.0,
        severity=SEVERITY_WARN,
        rationale="Season-aggregate; recompute is expensive. Bi-weekly cadence.",
    ),
    FreshnessSLA(
        table="goalie_gsax_primary",
        timestamp_column="calculated_at",
        in_season_hours=168.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale="Goalie analytics dashboards. Weekly cadence.",
    ),
    FreshnessSLA(
        table="goalie_gsax",
        timestamp_column="calculated_at",
        in_season_hours=168.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale="Same family as goalie_gsax_primary.",
    ),
    FreshnessSLA(
        table="goalie_rebound_control",
        timestamp_column="calculated_at",
        in_season_hours=336.0,
        offseason_hours=336.0,
        severity=SEVERITY_WARN,
        rationale="Slower-moving derived metric; bi-weekly cadence.",
    ),
    FreshnessSLA(
        table="goalie_gar",
        timestamp_column="calculated_at",
        in_season_hours=168.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale=(
            "Tightened to 7d (from initial 14d) aligned with goalie_gsax family. "
            "Effective after Phase 0d goalie GAR pipeline fix lands."
        ),
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# TIER D — Fantasy operations (user-visible state)
# ──────────────────────────────────────────────────────────────────────────────
TIER_D: List[FreshnessSLA] = [
    FreshnessSLA(
        table="fantasy_daily_rosters",
        timestamp_column="locked_at",
        in_season_hours=2.0,
        offseason_hours=None,  # skip outside the regular-season game window
        severity=SEVERITY_PAGE,
        rationale=(
            "If daily roster locks do not fire on time, users edit during "
            "games — irrecoverable trust break. 3am-worthy. Skipped during "
            "playoffs since fantasy leagues end with the regular season."
        ),
        regular_season_only=True,
    ),
    FreshnessSLA(
        table="matchup_scoring_snapshots",
        timestamp_column="created_at",  # no updated_at on this table
        in_season_hours=6.0,
        offseason_hours=None,
        severity=SEVERITY_PAGE,
        rationale=(
            "Live scoreboards must work during games. Special case: "
            "max(created_at) drives freshness signal — table is append-only. "
            "Skipped during playoffs since fantasy leagues are idle."
        ),
        regular_season_only=True,
    ),
    FreshnessSLA(
        table="team_lineups",
        timestamp_column="updated_at",
        in_season_hours=24.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale="User-managed; staleness tracks user inactivity not pipeline failure.",
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# TIER E — Auxiliary (low priority)
# ──────────────────────────────────────────────────────────────────────────────
TIER_E: List[FreshnessSLA] = [
    FreshnessSLA(
        table="league_averages",
        timestamp_column="updated_at",
        in_season_hours=168.0,
        offseason_hours=168.0,
        severity=SEVERITY_WARN,
        rationale="Used for percentile context; weekly refresh fine.",
    ),
    FreshnessSLA(
        table="player_playoff_stats",
        timestamp_column="updated_at",
        in_season_hours=24.0,
        offseason_hours=None,
        severity=SEVERITY_WARN,
        rationale="Only relevant April–June. Skipped outside playoff window.",
        window=WINDOW_PLAYOFFS,
    ),
]


ALL_SLAS: List[FreshnessSLA] = TIER_A + TIER_B + TIER_C + TIER_D + TIER_E


# Tier metadata for reporting
TIER_LABELS = {
    "A": "Live ingestion",
    "B": "Player stats",
    "C": "Model outputs",
    "D": "Fantasy operations",
    "E": "Auxiliary",
}


def tier_for(sla: FreshnessSLA) -> str:
    """Return tier letter (A-E) for an SLA."""
    if sla in TIER_A:
        return "A"
    if sla in TIER_B:
        return "B"
    if sla in TIER_C:
        return "C"
    if sla in TIER_D:
        return "D"
    return "E"

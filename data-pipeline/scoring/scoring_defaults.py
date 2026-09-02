"""Default fantasy scoring weights — GENERATED FILE, DO NOT EDIT.

Source:     packages/shared/src/constants/scoringDefaults.json
Generator:  scripts/gen-scoring-defaults.mjs  (npm run gen:scoring)
Freshness:  CI runs the generator and fails on any diff, so this file can
            never be stale on master. Edit the JSON, regenerate, commit both.

Yahoo Fantasy Hockey default points scoring (https://help.yahoo.com/kb/SLN6815), effective 2026-09-01.
Short-handed points, hits, penalty minutes and plus/minus ship disabled (0) because no major platform scores them by default; the `suggested` weight is what a commissioner is offered on toggling one on.

Deviations from the standard:
    plus_minus: Yahoo scores plus/minus at 2. Citrus ships it at 0 because the projection engine cannot model plus/minus, and a default category the projections ignore would make every projected total quietly wrong. Commissioners can still enable it.

Vocabularies (the pipeline speaks three):
    SKATER / GOALIE      canonical leagues.scoring_settings keys
                         (shots_on_goal, power_play_points, ...)
    SKATER_SHORT         per-game stat keys used by simulate_matchups /
                         projection_uncertainty / the monitoring audits
                         (sog, ppp, shp, pim, ...). Goalie keys are the same
                         in both vocabularies, so GOALIE serves both.
    LEGACY_BATCH_KEYS    the flat legacy vocabulary nightly_projection_batch
                         falls back to (blocked_shots, powerplay_points, ...).

Every dict maps stat -> points per unit as a float. Never mutate these; use
scoring_settings() when you need a mutable nested copy.
"""

SOURCE_URL = "https://help.yahoo.com/kb/SLN6815"
EFFECTIVE_DATE = "2026-09-01"

# Skater weights, canonical keys. plus_minus is carried for parity with the
# TS constant; the pipeline has no per-game stat for it (see SKATER_SHORT).
SKATER = {
    "goals": 6.0,
    "assists": 4.0,
    "power_play_points": 2.0,
    "short_handed_points": 0.0,
    "shots_on_goal": 0.9,
    "blocks": 1.0,
    "hits": 0.0,
    "penalty_minutes": 0.0,
    "plus_minus": 0.0,
}

# Goalie weights, canonical keys (identical to the short vocabulary).
GOALIE = {
    "wins": 5.0,
    "shutouts": 5.0,
    "saves": 0.6,
    "goals_against": -3.0,
}

# Skater weights keyed by the pipeline's per-game stat names.
SKATER_SHORT = {
    "goals": 6.0,
    "assists": 4.0,
    "ppp": 2.0,
    "shp": 0.0,
    "sog": 0.9,
    "blocks": 1.0,
    "hits": 0.0,
    "pim": 0.0,
}

# Flat legacy vocabulary used by nightly_projection_batch.fetch_scoring_settings.
LEGACY_BATCH_KEYS = {
    "goals": 6.0,
    "assists": 4.0,
    "powerplay_points": 2.0,
    "shorthanded_points": 0.0,
    "shots_on_goal": 0.9,
    "blocked_shots": 1.0,
    "hits": 0.0,
    "pim": 0.0,
    "wins": 5.0,
    "shutouts": 5.0,
    "saves": 0.6,
    "goals_against": -3.0,
}

# Opt-in stats (0 by default) → the weight a commissioner is offered on enabling one.
OPT_IN = {
    "short_handed_points": 2.0,
    "hits": 0.5,
    "penalty_minutes": 0.5,
    "plus_minus": 2.0,
}


def scoring_settings() -> dict:
    """Fresh, mutable {"skater": {...}, "goalie": {...}} in canonical keys.

    For callers that merge league overrides into the defaults or hand the
    structure to code that mutates it. The module-level dicts stay pristine.
    """
    return {"skater": dict(SKATER), "goalie": dict(GOALIE)}

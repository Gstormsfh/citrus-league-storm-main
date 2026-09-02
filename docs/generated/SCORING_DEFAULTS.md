# Default Fantasy Scoring

<!-- GENERATED FILE — DO NOT EDIT. Source: packages/shared/src/constants/scoringDefaults.json. Regenerate with `npm run gen:scoring`; CI fails when this table is stale. -->

Yahoo Fantasy Hockey default points scoring ([source](https://help.yahoo.com/kb/SLN6815)), effective **2026-09-01**.

The numbers below are the only copy anyone should read or quote. Every code home derives from the same JSON: `DEFAULT_SCORING` in `@citrus/shared`, the CreateLeague and commissioner forms, the server-side creation fallback, Stormy's system prompt (spliced in at module load), and `data-pipeline/scoring/scoring_defaults.py` (generated).

## Skaters

| Stat | Key | Category | Default | Opt-in | Suggested when enabled |
|---|---|---|---|---|---|
| Goals (G) | `goals` | Offense | 6 |  |  |
| Assists (A) | `assists` | Offense | 4 |  |  |
| Power Play Points (PPP) | `power_play_points` | Offense | 2 |  |  |
| Shorthanded Points (SHP) | `short_handed_points` | Offense | 0 | yes | 2 |
| Shots on Goal (SOG) | `shots_on_goal` | Offense | 0.9 |  |  |
| Blocks (BLK) | `blocks` | Defense | 1 |  |  |
| Hits (HIT) | `hits` | Defense | 0 | yes | 0.5 |
| Penalty Minutes (PIM) | `penalty_minutes` | Defense | 0 | yes | 0.5 |
| Plus/Minus (+/-) | `plus_minus` | Defense | 0 | yes | 2 |

## Goalies

| Stat | Key | Category | Default | Opt-in | Suggested when enabled |
|---|---|---|---|---|---|
| Wins (W) | `wins` | Goalie | 5 |  |  |
| Shutouts (SO) | `shutouts` | Goalie | 5 |  |  |
| Saves (SV) | `saves` | Goalie | 0.6 |  |  |
| Goals Against (GA) | `goals_against` | Goalie | −3 |  |  |

Short-handed points, hits, penalty minutes and plus/minus ship disabled (0) because no major platform scores them by default; the `suggested` weight is what a commissioner is offered on toggling one on.

## Deviations from the standard

- **Plus/Minus** — Yahoo scores plus/minus at 2. Citrus ships it at 0 because the projection engine cannot model plus/minus, and a default category the projections ignore would make every projected total quietly wrong. Commissioners can still enable it.

## What is NOT generated

The SQL homes still carry literals and ship as migrations: `stat_catalog`, the zero-UUID `league_scoring_rules` rows, the `leagues.scoring_settings` column default, and the projection-rebuild RPCs (see `supabase/migrations/20260901150000_industry_standard_default_scoring.sql`). A change to the JSON is not complete until the matching migration lands.

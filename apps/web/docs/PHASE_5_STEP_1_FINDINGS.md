# Phase 5 — Step 1 Findings (McDavid Integration Test)

**Date:** 2026-05-05
**Player:** Connor McDavid (NHL ID 8478402)
**Prod project:** `iezwazccqqrhrjupxzvf`
**Status:** Schema discovered, data sampled. **STOP for review before proceeding to Steps 2-7.**

---

## TL;DR — Three findings that change Web Summit scope

1. **Defensive GAR is uniformly 0 in prod.** `evd_gar_per_60`, `ppd_gar_per_60`, `penalty_gar_per_60` are 0.0 for every player. The Ring Cluster's middle DEF ring will read 0% for everyone. Either drop the DEF ring, swap to an `xGA on-ice` proxy from `raw_shots`, or ship with a "model not yet trained" badge.
2. **`raw_shots.season` column is NULL for ALL 99,322 rows.** The mock fixture assumed it was usable. We must derive season from `game_id` (first 4 chars) or filter by `game_id` range.
3. **GAR data is 5 months stale** (`calculated_at = 2025-12-13`). `player_season_stats` and `player_talent_metrics` updated TODAY (2026-05-05). The Ring Cluster needs `StaleDataBadge` automatically.

Plus: **7 prod tables have RLS disabled** (security advisory below — must address before launch).

---

## 1. Schema vs Mock Fixture diff

### `raw_shots` → `ShotEvent` (rink heatmap)

The mock fixture assumed:
```ts
interface ShotEvent {
  x: number;     // [0, 1] normalized, 0 = right boards
  y: number;     // [0, 1] normalized, 0 = goal-line, 1 = blue-line
  xg_value?: number | null;
  is_goal?: boolean;
  mode?: '5v5' | 'pp' | 'pk';
  id?: string | number;
}
```

Prod `raw_shots` provides:
| Need | Prod column | Notes |
|---|---|---|
| Player filter | `player_id` (the shooter) | NOT `shooter_id` — column does not exist |
| Coordinates | `arena_adjusted_x_abs` (0-100) + `arena_adjusted_y` (-42.5 to 42.5) | Half-rink-normalized; absolute x means goal is always at high x. Plain `shot_x`/`shot_y` are NOT half-rink-normalized — they vary by which end the team was attacking |
| xG | `xg_value` ✓ | Direct match |
| Goal flag | `is_goal` ✓ | Direct match |
| Mode (5v5/PP) | `is_power_play` (skater-level) + `home_skaters_on_ice` / `away_skaters_on_ice` | Need to derive: PK = your team's skaters < opposing skaters & is_power_play=false |
| ID | `id` (bigint) ✓ | |
| Season | **`season` is NULL for all 99,322 rows** | Derive from `game_id` (e.g. `2025020001` → season 2025) |

**Required transformations:**
```ts
// NHL coords → mock-fixture normalized coords
const mock_y = clamp((shot.arena_adjusted_x_abs - 25) / (89 - 25), 0, 1);
//   ↑ y=1 near goal-line (shot.arena_adjusted_x_abs ≈ 89)
//     y=0 near blue-line (shot.arena_adjusted_x_abs ≈ 25)
const mock_x = clamp((shot.arena_adjusted_y + 42.5) / 85, 0, 1);
//   ↑ x=0.5 dead center, 0/1 = boards

// Mode from skater counts + is_power_play
const mode =
  shot.is_power_play ? 'pp' :
  (shot.home_skaters_on_ice !== shot.away_skaters_on_ice) ? 'pk' :
  '5v5';

// Season from game_id
const season = parseInt(String(shot.game_id).slice(0, 4), 10);
```

McDavid sample: 406 total raw_shots. 20 PP, 386 non-PP. All games in 2025020xxx-2025030xxx range = season 2025 (the 2025-2026 NHL season).

### `player_directory` → identity

Direct match. McDavid 2025 row:
```json
{
  "season": 2025, "player_id": 8478402, "full_name": "Connor McDavid",
  "team_abbrev": "EDM", "position_code": "C", "is_goalie": false,
  "jersey_number": "97", "shoots_catches": "L",
  "headshot_url": "...", "height_in": 72, "weight_lb": 194,
  "birthdate": "1997-01-13", "nationality": "CAN"
}
```

Per Citrus brand (no player photos), we **ignore `headshot_url`** and use `PlayerMonogram` from initials.

`updated_at`: 2026-04-17 → 18 days stale (just over the 14-day threshold; `StaleDataBadge` will fire).

### `player_season_stats` → identity readout + standard percentiles

Direct match for raw counts. McDavid 2025:
```json
{
  "games_played": 82, "icetime_seconds": 45045,
  "nhl_goals": 48, "nhl_assists": 90, "nhl_points": 138,
  "nhl_shots_on_goal": 306, "nhl_ppp": 54, "nhl_toi_seconds": 120130,
  "x_goals": 37.39
}
```

Per CLAUDE.md: **use `nhl_*` columns** as source of truth (citrus-calculated `goals`=34 differs from `nhl_goals`=48 because PBP-derived = on-ice goals counted differently).

**Standard percentile metrics — no direct columns. Must compute:**
| Mock metric | Derivation |
|---|---|
| `xG/60` (5v5) | `x_goals * 3600 / icetime_5v5_seconds` — but `player_season_stats` doesn't split by situation. Use `player_gar_components.toi_5v5_minutes` for the denominator and aggregate `raw_shots.xg_value` filtered to non-PP for numerator |
| `Goals/60` (5v5) | Same — need split TOI |
| `Finishing` (G−xG/60) | `(actual_goals - x_goals) * 3600 / toi_5v5_seconds` |
| `A1/60` (5v5) | `primary_assists * 3600 / toi_5v5_seconds` |
| `xGA/60` on-ice | Aggregate `raw_shots.xg_value` filtered to opposing-team shots while player on ice — requires joining `player_shifts` with `raw_shots` (heavy) |
| `xGF%` on-ice | `xGF / (xGF + xGA)` — same join |
| `PP1 xGF/60` | Aggregate xG when player on ice during PP — need shifts |
| `PEN±` | `penalties_drawn - penalties_taken / 60` — column doesn't exist; would need PBP-derived |

**Percentile ranking (5/8 metrics) requires a position-cohort comparison query** (rank McDavid against all 275 centers). This is a non-trivial backend layer.

**For Web Summit demo, the pragmatic path is:**
- Compute the 4 metrics that don't need shift joins (xG/60, Goals/60, Finishing, A1/60) as straightforward season-stats math
- Defer xGA/60, xGF%, PP1 xGF/60, PEN± — show as "Available next week" in the tile, OR skip the second breakdown tile for v1
- Compute percentile ranks via a SQL window function over all centers (one query per metric)

### `player_gar_components` → `RingMetric` cluster

McDavid 2025:
```json
{
  "evo_gar_per_60": 0.329,
  "evd_gar_per_60": 0.000,   // ⚠️ ZERO
  "ppo_gar_per_60": 0.028,
  "ppd_gar_per_60": 0.000,   // ⚠️ ZERO
  "penalty_gar_per_60": 0.000,// ⚠️ ZERO
  "total_gar_per_60": 0.357,
  "calculated_at": "2025-12-13"  // ⚠️ 5 months stale
}
```

**Aggregate stats across all 275 centers in 2025:**
- 267/275 have GAR rows
- avg `evo_gar_per_60` = -0.003 (centered near 0 ✓)
- avg `evd_gar_per_60` = **0.000 exactly** — defensive component is empty league-wide
- avg `ppo_gar_per_60` = 0.033
- avg `total_gar_per_60` = 0.030 (driven by EVO + PPO only)
- median `total_gar_per_60` = -0.003

**Implication for the Ring Cluster:**
The mockup design has 3 rings: OFF / DEF / ST. With prod data:
- OFF → derive from `evo_gar_per_60` (real, populated, McDavid 99th percentile)
- DEF → **broken**. `evd_gar_per_60` is 0 for everyone.
- ST → derive from `ppo_gar_per_60` (real, populated)

Three options for Web Summit:

| Option | Action | Tradeoff |
|---|---|---|
| **A** | Drop the DEF ring; show 2 rings (OFF + ST) | Loses signature 3-ring visual; mockup divergence |
| **B** | Keep 3 rings; DEF backed by an `xGA on-ice` proxy from `raw_shots` (aggregate opposing xG when player on ice) | Heavy query; needs `player_shifts` join; derived ≠ trained |
| **C** | Keep 3 rings; DEF shows 0 with a "Model in training" `StaleDataBadge`-style chip on the ring | Honest; ugly |

**Recommendation: B for Web Summit.** McDavid's xGA-on-ice can be aggregated in <1s via `player_shifts` ⋈ `raw_shots` (50ms query if indexed). We honor the design and present a defensible defensive metric.

### `player_game_stats` → `SparklineMicroChart` source

Direct match. Last 10 McDavid games (2025 season, descending):
| game_date | nhl_g | nhl_a | nhl_pts | sog | toi_s | ppp |
|---|---|---|---|---|---|---|
| 2026-04-30 | 0 | 0 | 0 | 3 | 1489 | 0 |
| 2026-04-28 | 0 | 2 | 2 | 4 | 1449 | 0 |
| 2026-04-26 | 0 | 2 | 2 | 3 | 1172 | 0 |
| 2026-04-24 | 0 | 1 | 1 | 3 | 1430 | 0 |
| 2026-04-22 | 0 | 0 | 0 | 4 | 1447 | 0 |
| 2026-04-20 | 0 | 0 | 0 | 3 | 1427 | 0 |
| 2026-04-16 | 0 | 4 | 4 | 3 | 1096 | 2 |
| 2026-04-13 | 1 | 0 | 1 | 5 | 1675 | 0 |
| 2026-04-11 | 0 | 0 | 0 | 1 | 1610 | 0 |
| 2026-04-08 | 3 | 2 | 5 | 8 | 1270 | 3 |

**The mock sparkline used `xG/60` per game as the y-axis.** Per-game xG must be aggregated from `raw_shots` (`SUM(xg_value) GROUP BY game_id`), normalized by per-game TOI. That's another join.

**Pragmatic v1: drop xG/60 as the sparkline metric, use `nhl_points` per game** (already in `player_game_stats`). Or use `nhl_shots_on_goal` per game. Both are immediately available without aggregation.

The mock `eyebrow="Last 30 days · xG/60"` becomes `"Last 30 games · Points"` or `"Last 30 games · Shots"`. Less prestigious but ships clean for Web Summit.

McDavid played 87 games in 2025; sparkline of last 30 games is the right slice.

### `player_talent_metrics` → mostly unused

Single useful column: `xg_per_60` = 1.12, `xg_rating` = "Above Avg". The rating taxonomy isn't used in our design.

### `player_ros_projections` — not in current Web Summit scope

Has `total_projected_points`, `projected_goals`, etc. Could power a future "Rest of Season" chapter. Not wired for v1.

---

## 2. Critical security finding — RLS DISABLED on 7 prod tables

Supabase advisor flagged this on the prod project:

> 7 table(s) have Row Level Security (RLS) disabled: `public.players`, `public.staging_2025_skaters`, `public.staging_2024_skaters`, `public.staging_2025_goalies`, `public.staging_2024_goalies`, `public.raw_player_stats`, `public.team_stats`. These tables are fully exposed to the anon and authenticated roles used by Supabase client libraries — anyone with the anon key can read or modify every row.

**None of these are tables we're reading for the player profile** (we use `player_directory` / `raw_shots` / `player_season_stats` / `player_game_stats` / `player_gar_components` / `player_talent_metrics`, all RLS-enabled).

**Action required from Garrett before launch (NOT auto-applied):**
```sql
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_2025_skaters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_2024_skaters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_2025_goalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_2024_goalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_stats ENABLE ROW LEVEL SECURITY;
```
Per advisor: *"Do not auto-apply the remediation SQL: enabling RLS without policies will block all access to these tables."* Each needs a corresponding read policy. **You decide the policies — I won't run this without sign-off.**

---

## 3. Recommended Phase 5 path forward

### Fold these scope changes back into the Web Summit cut

1. **Ring Cluster** — Adopt Option B: derive DEF from xGA-on-ice via `player_shifts` ⋈ `raw_shots`. Add a `getPlayerOnIceXGA(playerId, season)` helper. If the join is too heavy, fall back to Option C with a clear chip.
2. **Standard Percentiles tile** — ship 4 metrics for v1 (xG/60, Goals/60, Finishing, A1/60). Defer xGA/60, xGF%, PP1 xGF/60, PEN± to a follow-up. Update the tile caption from "Standard Percentiles" to "Offensive Percentiles" until the defensive metrics ship.
3. **Sparkline** — swap eyebrow from "Last 30 days · xG/60" to "Last 30 games · Points" (or "Shots"). xG aggregation is a Phase 5.5 follow-up.
4. **StaleDataBadge wiring** — read `calculated_at` / `updated_at` from each source table; auto-render badge when > 14 days old. McDavid's GAR is 5 months stale → badge fires.

### Backend layer to build

Three Hono routes (`server/src/routes/players.ts`):
- `GET /api/players/:playerId` → identity + season stats + GAR + percentiles
- `GET /api/players/:playerId/shots?mode=5v5|pp|pk|all` → transformed `ShotEvent[]`
- `GET /api/players/:playerId/sparkline?metric=points|shots&games=30` → `SparklinePoint[]`

Each calls a Supabase service. Public-facing data, anon-key OK, but route through the API server for caching and consistent error handling.

### Routing

Per design spec §6: `/players/[slug]-[playerId]`. Slug = `lower(first.last) + '-' + playerId`. Validate `playerId` is numeric, redirect if slug doesn't match canonical.

### Pre-flight checklist

Before wiring more than McDavid:
- [ ] Garrett picks Ring Cluster option (A/B/C)
- [ ] Garrett picks sparkline metric for v1 (points / shots / defer xG)
- [ ] Garrett confirms 4-metric vs 8-metric standard percentiles tile for v1
- [ ] Garrett's call on the 7 RLS-disabled prod tables
- [ ] Garrett confirms playoff-game inclusion (game_id 2025030xxx are playoff games — include or filter out?)

---

## 4. What I have NOT yet done

- Built the data layer (services / queries)
- Built the API routes
- Built the `/players/[slug]-[playerId]` route file
- Wired PreviewPlayerProfile (or a new PlayerProfile.tsx) to real data
- Mobile / breakpoint testing on real data
- Pre-deploy audit
- Rollback runbook

These wait for your decisions on the 5 pre-flight items above.

# Corpus Story Catalog — verified analytics narratives

Status: LIVING DOC — v0.1 captured from strategy session 2026-07-27.
Verification: every number in section 1 was queried live on 2026-07-27 against
the staging corpus (Phase 0a columns, all ~905K shot rows, seasons 2017–2024).
Numbers are transcribed here, not recomputed — re-verify against prod after the
Phase 0c prod endgame before quoting externally.
Rule: nothing enters section 1 without a live query behind it.

## 1. Verified stories (queried 2026-07-27, staging, ~905K rows)

### 1.1 Precursor value chain — turnover shots beat xG

goal% by last_event_category:

| last event | goal% | vs xG |
|---|---|---|
| SHOT-context | 9.05% | — |
| GIVE (giveaway) | 8.31% | +0.81 |
| TAKE (takeaway) | 8.03% | +0.54 |
| MISS | 7.31% | — |
| FAC (faceoff) | 5.40% | — |
| HIT | 5.31% | — |

Insight: shots off turnovers systematically outperform their xG — models
under-price chaos. Fantasy angle: turnover generation as a hidden scoring signal.

### 1.2 Trapped-defender effect

goal% by time_difference_since_change: 6.96% (<15s) rising MONOTONICALLY to
12.10% (90s+). Interpretation: hemmed-in defense, not shooter fatigue — long
defensive shifts are the vulnerability; forcing them is the edge.

### 1.3 Fresh-legs edge

average_rest_difference >20s: 8.30% goal rate, +0.44 over xG — the largest
model-beat found in the corpus scan.

### 1.4 Royal-road rebounds

shot_angle_rebound_royal_road = 1 (~88K shots): 9.25% goal rate vs 6.72%
baseline.

## 2. Graduation candidates (ship-ready product surfaces)

### 2.1 Luck Ledger — ships fastest

Cumulative goals minus xG per player. Pure aggregation over existing columns; no
model work. The sample-size differentiator: 9 seasons of it vs competitors'
single-season views. First candidate to productize.

### 2.2 Chaos-Dependency Profiles

Per-player mix of rebound / turnover / royal-road goals vs clean goals — a
volatility rating for draft strategy (stable producers vs chaos-dependent
scorers).

Note: the Phase 0c moat columns (pass context, goalie displacement, arrival
timing) cross-multiply every story above — each gains an arrival-context split
once 0c lands.

## 3. Future data targets (post-0c)

- NHL EDGE endpoints (api-web family): speed bursts, zone time. Nobody in
  fantasy surfaces these; speed-decline is a candidate injury leading indicator.
- Schedule-density fatigue: nhl_games date joins (back-to-backs, 3-in-4s)
  crossed with the fresh-legs and trapped-defender effects above.
- Goalie-exploit matrices: goalie displacement crossed with shot origin,
  buildable once 0c completes.

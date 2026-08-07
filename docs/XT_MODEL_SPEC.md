# xT Model Specification — v0.1 (draft)

Status: DRAFT v0.1 — design captured from strategy session 2026-07-27, pre-implementation.
Prereqs: Phase 0c corpus completion + census verdict, then Phase 0d-post.
Epistemic note: academic citations below are memory-sourced and MUST be verified
against the actual papers before any external claim (Phase 0 law: verify external
reference values before trusting them).

## 1. Purpose and positioning

Expected Threat (xT) for hockey, productized for fantasy. Academic and hobbyist
work exists (Singh 2018 soccer xT; Yu 2020; Hockey-Graphs passing-adjusted value
— all to be verified), but none of it is productized: the consumer/fantasy lane
for xT-style hockey metrics is EMPTY. Citrus's edge is not inventing xT — it is
(a) a 9-season shot corpus with arrival-context (moat) features nobody else has
assembled, and (b) shipping it into a fantasy surface.

## 2. Architecture — two layers

### Layer A — Markov grid xT (baseline)

- Asymmetric zone grid, ~14x8, finer resolution near the home-plate / slot area.
  (14x8 is a starting hypothesis, not a commitment — tune during implementation.)
- Standard value-iteration over move/shoot transition matrices, hockey-adapted.
- Trained on the full 9-season corpus (2017–2024 historical + 2025-26 live era).
- Effort estimate: days, not weeks. Output matches academic state of the art.
- Layer A alone is NOT a moat — it is the credible baseline the moat layer
  stands on.

### Layer B — arrival-context conditioning (THE MOAT)

- Condition transition/finishing values on arrival context: xT(cell | arrival).
- Arrival context = the Phase 0c moat features: pass lateral distance,
  time_before_shot (pass-to-shot latency), goalie displacement.
- Only Citrus can build this layer: it requires moat columns populated at corpus
  scale, which is exactly what Phase 0c produces.
- The context vector is versioned and designed to absorb future tracking-era
  inputs (e.g., NHL EDGE speed/zone data) WITHOUT a model rebuild — new features
  append to the vector; grid and training loop are unchanged.

## 3. Training policy (capture-density constraint)

has_pass capture density runs 3.2% (2017) to 9.0% (2024); the 2021 dip is an
open question with a verdict expected from the full-run census. Therefore:

- Layer A: train on all 9 seasons (coordinate/outcome capture is believed
  era-uniform — confirm in the census bounds audit before locking this).
- Layer B: era-weighted training, or restrict to 2021+ — decide AFTER the census
  delivers the final per-season has_pass distribution. Cross-era player
  comparisons must always account for the gradient.

## 4. Fantasy surfaces

- xT-Created: threat generated for others (passer credit) — the headline stat.
- xT-Received: threat delivered to the shooter at arrival.
- Both aggregate per player-game, then season; they feed draft tools, weekly
  matchup views, and trade analysis, and they cross-multiply with the
  story-catalog surfaces (see docs/STORY_CATALOG.md), e.g. chaos-dependency
  crossed with xT-Created.

## 5. Dependencies and open questions

- Phase 0c census: bounds audit, ambiguity rate, per-season coverage — gates
  Layer B training.
- event_id (being written by 0c) makes a period/game-time temporal backfill a
  cheap future join — unlocks clutch/period-conditioned xT later.
- 2021 capture dip: explanation pending census.
- Grid geometry (~14x8 asymmetric) and smoothing: tune on Layer A residuals.
- Citations: verify Singh 2018 / Yu 2020 / Hockey-Graphs PAV before publishing.

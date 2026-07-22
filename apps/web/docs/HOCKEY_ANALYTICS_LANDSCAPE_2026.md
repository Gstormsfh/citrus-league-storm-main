# Hockey Analytics Landscape — May 2026

**Author:** Garrett + Claude
**Date:** 2026-05-05
**Method:** Live WebFetch + WebSearch survey of public hockey analytics products and 2024-2025 academic / community publications. Notes inline where a source could not be fetched directly (403 / blocked / paywalled) and the entry rests on adjacent or training-window context. **Cited URLs and fetch results are in §6.**

---

## 1. Public Products Survey

### 1.1 Tier-1 commercial / analyst products

| Product | Owner | Core IP | Public surface | Paywalled |
|---|---|---|---|---|
| **HockeyViz** | Micah Blake McCurdy | "Magnus" isolated-impact model (separates a player's effect from teammates / competition / score / zone-starts), goalie analysis, team season previews | Charts + writeups; Patreon-funded | Most high-resolution charts + season-preview PDFs are Patreon-tier. *Site directly returned 403 — content sourced from the silver-seven interview + search snippets* |
| **JFresh / HockeyStats.com** (now jointly run with Patrick Bacon) | Andrew Berkshire (JFresh) + Patrick Bacon (TopDownHockey) | "NHL WAR" with isolated impact, weighted 3-year RAPM, microstat overlays sourced from AllThreeZones | Free: NHL WAR, playoff odds, bracket sim. **$5/mo:** weighted 3-year WAR player cards. **$10/mo:** scouting reports + microstat cards (passes, zone entries, entry denials) | Most cards are paywalled. Substack distributes essays |
| **Evolving Hockey** | Josh & Luke Younggren | RAPM (Corsi + xG variants), GAR / xGAR, contract projections, skater similarity, query tools | Skater RAPM Charts, Live Games, Skater GAR table free | Subscriber-gated: full tables, projections, query tools |
| **MoneyPuck** | Peter Tanner | xG model (50K goals / 800K shots, 2007-2015 train), Pre-game model, In-game live model, Goalie starter prediction | Almost everything free. Distinctive: **Deserve to Win O'Meter**, **Season Simulator (100K runs)**, Flurry-Adjusted xG, Shooting-Talent-Adjusted xG, Created xG | None — donation/Patreon model |
| **Natural Stat Trick** | Greg Sinclair | Granular Corsi/Fenwick/xG splits, line combinations, on-ice rates, line/pair/triplet decomposition | Most tables free. *Site returned 403 to glossary fetch — content from training context + community references* | "Plus" tier for some splits |
| **AllThreeZones (ATZ)** | Corey Sznajder | Manually-tracked microstats: zone entries / exits, passes, pre-shot setup, transition play, rush defense, puck retrievals across 3000+ games since 2016 | Sample player cards, team scatterplots, forecheck visuals | Patreon: full Tableau workbooks, raw 5+ year dataset, playoff workbook, game recaps |
| **TopDownHockey / advancedhockeystats.com** (now redirects to hockeystats.com) | Patrick Bacon | xG model, projections (skater/goalie/team/series), Tableau visualizations | Nightly-updated 2025-26 projections | Paywalled tier shared with JFresh |
| **The Athletic NHL** | Various (Dom Luszczyszyn, Shayna Goldman, etc.) | "Net Rating" / Game Score Value Added (GSVA) — projection model w/ team strength dial | Articles + subscriber chats | *Blocked entirely from fetch* — paywalled |
| **NHL EDGE** | NHL (official) | League's puck-and-player tracking since 2021-22: skating speed (max + 20+/22+ mph bursts), distance per game, shot speed (90+ mph attempts, hardest shot), zone time %, **shot location heatmap (high-danger / midrange / long-range)**, goalie save% by zone | Free, public-facing on edge.nhl.com / nhl.com/nhl-edge | None (yet); NHL 26 game integrating |
| **Hockey-Reference** | Sports Reference LLC | Traditional + light advanced (CF%, xGF%, Game Score) | Free | "Stathead" subscription for query tools |

### 1.2 Adjacent / academic / community

- **LB-Hockey (Louis Boulet)** — `lb-hockey.com`, December 5 2025 essay introducing **SPAR** (Standings Points Above Replacement) with 25 skills across 5 categories (Zone Offence / Zone Defence / Transition / Checking / Teamplay). Three weighting dimensions: impact (regression to wins), repeatability (year-over-year), multicollinearity (skill-overlap penalty). Combines into skill-weighted average (SWAV). 0.78 R² for team standings points. Multi-year player cards. *This is the cleanest current attempt at "playing-style classification" in public analytics.*
- **Hockey Graphs** — community blog still active, hosts academic-flavored posts (Bayesian space-time PAV model, etc.). Lower frequency since 2022.
- **Hockey-Statistics.com** — independent xG model build-outs (May 2025: Building xG models in Python; August 2025: xG models v 2.0 with Last-Event variable distinguishing rebounds / takeaways / quick events from "no event in last 3s")
- **Hamahakkimies / Matti Honkanen** — Finnish researcher implementing soccer-style Expected Threat (xT) for hockey via Markov chain over rink locations, with rebound-aware transitions for shots that don't score. Not productized publicly.
- **EvanMiya, BBall-Index** (basketball comp); **FBRef, StatsBomb / Hudl Statsbomb** (soccer); **Baseball Savant** (MLB); **NFL Next Gen Stats / PFF** (NFL). See §5.

### 1.3 Private / industrial

- **SPORTLOGiQ** — broadcast-video computer-vision tracking. **500+ metrics**. ~Every NHL team subscribes via "iCE" platform. Provides automatic xG, zone-entry control, efficiency under pressure, micro-events (stick checks, interceptions). **Not public.**
- **Stathletes** — similar broadcast-vision shop. Not public.
- **NHL EDGE** is the only public surface for tracking-data-derived metrics, and the NHL has been deliberately conservative about which tracking primitives it exposes.

---

## 2. Emerging Frames in 2025-2026 (What's new)

### 2.1 New academic / community metrics surfaced this cycle

| Concept | Source | What it adds |
|---|---|---|
| **Possession-time differential as xG-rival predictor** | LINHAC 2024 paper (Pitassi et al, Waterloo) | Average Offensive Zone Possession Time Differential correlates r=0.77 with goal differential. A simple time metric is competitive with xG for team-level prediction |
| **Net visibility + Net reachability** | LINHAC 2025 position paper | Net visibility = fraction of net visible from puck; Net reachability = fraction reachable. Both refine "shot quality" beyond distance/angle |
| **Defense Quality (DQ / DQ+)** | Matt Anikiej, Hockey Harmony Medium 2024 | Weighted z-score across 6 categories (ice time 5%, shot suppression 27%, physical 15%, puck management 20%, shift quality 17%, penalty differential 16%). **Focuses on chance quality given up rather than goals** — explicitly factors out goalie performance |
| **SPAR + 25-skill style framework** | Louis Boulet, LB-Hockey Dec 2025 | First public attempt at quantifying *playing style* (forecheck-heavy, transition-deferring, etc.) on top of impact metrics |
| **Gaussian Mixture Model for playing styles** | LINHAC 2025 paper | Cluster-based player typology — surfacing "pure" archetypes and players who blend |
| **Last-Event xG variable family** | Hockey-Statistics 2025 v2.0 model | Three-class predecessor (None / Rebound / Quick) within 3s window — improves rebound-context handling without overweighting rebound goals |
| **Shooting-talent-adjusted xG** | MoneyPuck (matured) | Bayesian shooter-skill prior layered on shot-level xG; "Created Expected Goals" credits rebound generators |
| **Pose-detection futures** | MIT Sloan 2025 hockey panel | Roadmap: pose-detection from broadcast feeds to identify stick positions in addition to player locations. Not yet productized |
| **Opportunity Analysis** | NHL + AWS / Amazon Science | League-driven: predicts shot difficulty in real-time on every shot release |
| **Sample-size reliability tables** | Neil Pierre-Louis, Medium Oct 2025 | Per-metric reliability (years to stabilize) — a discoverability layer that almost no public product surfaces |

### 2.2 Conversation / criticism vectors

- **Inter-model disagreement** is now a regular community talking point. JFresh's projection ≠ HockeyViz's ≠ Evolving's ≠ The Athletic's — sometimes by 5-10 standings points. The community is starting to ask "which model is more right when?" as a meta-analytical question. JFresh's mean absolute error 2024-25 was ~10.4 points/team — competitive but not always best-in-class.
- **Public products under-serve playing-style typology.** Multiple sources flag this gap (LB-Hockey Dec 2025 essay frames its existence as a response). Existing impact metrics (RAPM, GAR, WAR) tell you *how much* but not *how*.
- **Goalie analytics plateau.** McCurdy himself (paraphrased from Silver Seven interview): variation in goalie results is so noisy that even GSAx-style metrics feel underwhelming. No public product has a confidently better goalie model than 2-year averages of GSAx.
- **Score-effect / situation-context handling is uneven.** Cleaning the Glass-style "strip garbage time before computing rates" has no formal hockey analog. Most hockey metrics are score-state-aware (Score-Adjusted Corsi, Fenwick Close) but none implement the same crisp "discard garbage time entirely" methodology.
- **Tracking-data revolution not yet delivered.** NHL EDGE shows tracking primitives but hasn't yet exposed derived analytics (route mapping, defensive assignment graphs, separation metrics). Community is impatient — the LINHAC 2025 panel called pose detection "the next step."

---

## 3. Gaps in Public Hockey Analytics (What nobody offers)

Compiled from cross-referencing all of §1 and §2:

1. **Playing-style typology with depth** — LB-Hockey's SPAR is the first attempt; it's still single-author, December 2025 release, no comparison tooling. **No platform-level offering.**
2. **Anomaly framework** — When does a player's actual performance diverge from their underlying model? Who's "running hot" or "running cold" in real time, and by how much? No public product exposes this as a first-class signal.
3. **Sample-size / reliability disclosure on the metric itself** — Most products show percentile or rate; few show "how stable is this rate at this sample size?" Pierre-Louis's Oct 2025 piece is a community-first one-off.
4. **Multi-season context views** — Most products show current-season percentile. Career-arc + age-curve overlays are thin (HockeyViz has Age & Decay; LB-Hockey has multi-year cards; that's about it). No site lets you sit on a player's profile and watch their last 5 seasons of percentile rank slide across.
5. **Comparison architecture** — JFresh's cards are individual; head-to-head comparison is a missing primary surface. (BBall-Index's "Role Fits" tool does exactly this in basketball.)
6. **Score-state / situation-pure splits** — Cleaning-the-Glass-style garbage-time stripping has no rigorous public hockey analog.
7. **Pre-shot pass context exposed at the player level** — `pass_quality_score`, `pass_immediacy`, `time_since_last_event`, `goalie_movement_score` — these features power xG models internally (visible inside MoneyPuck's `flurry_adjusted_xg` etc.) but are NOT exposed as player-level analytics. Public surfaces never let you ask: *"who generates the highest-quality pre-shot passes?"*
8. **Shift-level micro-narratives** — every public product is at season or per-60 aggregation. Nobody is exposing "this 47-second shift was your best of the period" as a discoverability surface.
9. **xT-equivalent for hockey** — academic implementations exist (Hamahakkimies, Bayesian PAV); **none are productized.** Soccer has had xT since 2018-2019. Hockey doesn't have a public xT equivalent — even though the model works.
10. **Transition / zone-entry analytics at scale** — ATZ has microstats but they're manually tracked and Patreon-paywalled. Nobody combines tracking-derived entry/exit analytics with shooter/finisher metrics in one player view.
11. **Defensive signal with positive sign** — Almost everything frames defense as "what you suppressed." Defense Quality (DQ+) is a step forward but it's still suppression-shaped. There's no public *takeaway-producing-defense* metric that explains *why* a player suppresses.
12. **Goalie-side context** — most goalie analytics are GSAx + shot-quality. Rebound control, post-save chaos, screened-shot performance, off-rush vs in-zone splits — public surfaces are thin. `goalie_rebound_control` would be a Citrus differentiator if real.

---

## 4. Citrus Uncopied Territory (What only we could build)

Cross-referencing the Citrus prod schema (per `PHASE_5_STEP_1_FINDINGS.md` + `raw_shots` 57+ feature columns, `player_shifts`, `player_toi_by_situation`, `raw_nhl_data`) against the gaps in §3:

### 4.1 Direct unlocks from existing data

- **Pre-shot pass quality leaderboards** — `pass_quality_score`, `pass_immediacy_score`, `pass_zone`, `pass_lateral_distance`, `pass_to_net_distance`, `time_before_shot`, `pass_angle`, `goalie_movement_score`. None of these are exposed publicly. Citrus is the only place that could publish, e.g., "Players whose passes generate the highest-quality shots, controlling for shot location."
- **Rebound generation vs rebound suppression** — `is_rebound`, `expected_rebound_probability`, `expected_goals_of_expected_rebounds`, `shot_generated_rebound`, `shot_goalie_froze`, `shot_play_continued_in_zone`. Lets us split: who creates rebounds (offensive value), who controls them (goalie / defender value).
- **Pace-of-play metrics** — `time_since_last_event`, `speed_from_last_event`, `distance_from_last_event`, `shooter_time_on_ice`, `time_since_faceoff`. Lets us classify shot context: rush-driven vs cycle-driven vs broken-play. No public product exposes this as a player-level analytic.
- **Defensive context inside xG (TOI/composition only — see § 17 for the geometry caveat)** — `defending_team_skaters_on_ice`, `defending_team_forwards_on_ice`, `defending_team_defencemen_on_ice`, `defending_team_average_time_on_ice` and TOI-since-faceoff variants. These are derivable from `player_shifts_official` + `situationCode` and present in MoneyPuck CSVs. **Positional defender geometry** (`distance_to_nearest_defender`, `nearest_defender_to_net_distance`, `skaters_in_screening_box`) was dropped 2026-05-07 — the data is not available in NHL public PBP feeds. See § 17 "What we don't have and why."
- **Special-teams pass routes** — `is_power_play`, `time_since_powerplay_started`, full pass-context columns. PP1 / PP2 unit pass-route maps no public product has.
- **Score-state pure rates** — `score_differential`, `home_skaters_on_ice`, `away_skaters_on_ice`, `period`, `time_remaining_seconds`, `is_empty_net`. Cleaning-the-Glass-style garbage-time stripping (e.g., empty-net + lead) for hockey is straightforward with these columns and has no public equivalent.

### 4.2 Differential model territory

- **Citrus xT ("Expected Threat for hockey")** — implement the Markov-chain location-value model that academia has shown works (Hamahakkimies, Bayesian PAV) but nobody productized. With `arena_adjusted_x_abs` / `arena_adjusted_y` rink coordinates + transition events, this is buildable. **Would be the first public xT in hockey.**
- **Anomaly engine** — for each player on each metric, compare 30-game rolling actual vs expected. Surface "running hot / running cold / projecting up / projecting down." Pulls together xG, GAR components, and multi-season context that prod data already supports.
- **Sample-size confidence layer** — every metric ships with its reliability quartile and a tooltip explaining "this stabilizes around N games." Pierre-Louis's research as a UI primitive.
- **Career-arc viewer** — multi-season backfill (Garrett locked) + age-curve overlay + percentile-rank-over-time chart. HockeyViz / LB-Hockey have fragments; nobody has this as a primary product surface.
- **Comparison drawer** — JFresh-style cards for two players side-by-side, with delta highlighting. BBall-Index has Role Fits; hockey has nothing equivalent.
- **Shift narratives** — surface a player's best/worst 90-second shifts of the season, with the sequence of events (entry → pass → shot) reconstructed. This would be the most editorial / shareable product surface in public hockey.
- **Style typology classifier** — apply Boulet's SPAR-style 25-skill framework to Citrus's data, with the advantage that we have raw_shots feature granularity (pre-shot pass context, rebounds, TOI/composition; see § 17 for what's deliberately out of scope at v1).

### 4.3 Goalie-side differentiator (Sequential Track per Garrett)

The schema already has `goalie_gsax`, `goalie_rebound_control`, `goalie_gsax_primary` (Component 2 of G-GAR), `goalie_gar`. Per the May 4 audit `goalie_rebound_control` is empty in prod, but the design intent is the cleanest public goalie model: **decompose into Rebound Control + Primary-Shot GSAx + situational adjustments.** That's a publishable goalie-model architecture nobody else has live.

### 4.4 What we *can't* compete on (and shouldn't try to)

- **NHL EDGE puck-tracking primitives** (skating speed, shot speed, exact zone time) — we don't have access to the raw tracking feed. We can *display* EDGE numbers via the public surface, but we can't match the league for tracking-data depth.
- **Manual microstats matching ATZ** — Sznajder has a 9-year tracked dataset by hand. We can't out-history him. We can match at the data-pipeline level for forward seasons but not backfill.
- **SPORTLOGiQ-class private analytics** — we don't have broadcast-vision pipelines. League teams pay for SPORTLOGiQ; we publish for fans.

---

## 5. Adjacent Sports Learnings (What to import)

| Sport | Frame | Hockey adoption | Citrus priority |
|---|---|---|---|
| **Soccer (StatsBomb / FBRef)** | **Expected Threat (xT) / On-Ball Value (OBV)** — Markov chain over field location, value every action | Academic only (Hamahakkimies, PAV) — **no productized xT in hockey** | **Tier 1**. Citrus could publish first public xT for hockey |
| **Soccer (FBRef)** | **Progressive passes / progressive carries** definitions (10 yards closer, exclusions for goalkeeper kicks) | Some implementations (zone entries) but not at this rigor | Tier 2 — use as the literal definition for Citrus's "progressive entry" |
| **Basketball (Cleaning the Glass)** | **Garbage-time stripping** — discard plays after game-out-of-hand thresholds entirely | None public; Score-Adjusted Corsi is the closest | Tier 1 — easy win with Citrus's `score_differential` + `time_remaining_seconds` columns |
| **Basketball (BBall-Index)** | **Talent grades vs impact metrics** — explicitly separates "how good is this skill" from "how much does it help winning" | LB-Hockey's SPAR is the closest hockey analog | Tier 1 — adopt this dichotomy in the metric taxonomy |
| **Basketball (BBall-Index)** | **Role Fits Tool** — comparison architecture for offensive/defensive role match | None in hockey | Tier 2 — pairs with the comparison drawer surface |
| **Baseball (Savant)** | **Bat tracking** — swing speed (75+ "fast"), squared-up rate, "blast" = squared-up + fast | Hockey has shot speed (NHL EDGE) but not "shot quality from physics" | Tier 3 — possible composite "Quality Shot Rate" using shot speed + xG + selection |
| **Baseball (Savant)** | **Pitch arsenal** — visualize a pitcher's full repertoire by pitch type, usage rate, results | Hockey has shot type but no "shot arsenal" visualization per shooter | Tier 2 — distinct primitive: Shot Arsenal (snap / wrist / slap / tip / backhand × xG conversion × usage) |
| **Baseball (Savant)** | **Expected home run leaderboard** with park dimensions | "What was that shot in different rinks?" — no analog in hockey since rinks are uniform | Skip |
| **NFL (Next Gen Stats)** | **Pressure Probability** — AWS-built, real-time tracking-data ML model | Hockey's "pressure" maps to forecheck intensity / time-on-puck-in-zone | Tier 2 — Citrus could compute proxy via shift-overlap with opposing-team puck possession |
| **NFL (Next Gen Stats)** | **CPOE 2.0** — completion probability with occlusion-aware separation | None in hockey | Tier 3 — analog could be "expected pass completion under pressure" |
| **NFL (Next Gen Stats)** | **Coverage Responsibility** — assigns each defender to a coverage zone via tracking | Hockey defensive assignment via `player_shifts` overlap | Tier 1 — Citrus could match defender to attacker's puck-carrier shifts and report assignment quality |
| **NFL (PFF)** | **Subjective grading at scale** with -2/+2 per-play scoring, 5-7 graders, audit/QA layer | Hockey has nothing comparable; analytics community is allergic to subjective grading | Skip — opposed to Citrus's quant-first identity |

---

## 6. Source Citations

Sources are cited inline and grouped by section. **Fetch status legend:** ✅ direct fetch returned content · ⚠️ partial / minimal content · 🔍 search-result snippets only · ❌ blocked (403 / ECONNREFUSED / paywalled) · 📚 training-window context (cited only when fresher source unavailable).

### §1 Public products

- ✅ Evolving Hockey home — https://evolving-hockey.com (fetched 2026-05-05)
- ✅ MoneyPuck About — https://moneypuck.com/about.htm (fetched 2026-05-05)
- ✅ AllThreeZones home — https://www.allthreezones.com (fetched 2026-05-05)
- ✅ HockeyStats.com home — https://hockeystats.com (fetched 2026-05-05; JFresh + TopDownHockey collaboration, $5/$10 tiers)
- ✅ JFresh Player Card Explainer — https://jfresh.substack.com/p/player-card-explainer
- ❌ HockeyViz — https://hockeyviz.com returned 403; substantive content from
- ✅ Silver Seven McCurdy interview — https://www.silversevensens.com/q-a-with-micah-mccurdy-of-hockeyviz/
- 🔍 NHL EDGE (skating speed since 2021-22; 5v5 SV%, midrange/long-range zones, 22+ mph bursts, 90+ mph shot speed) via NHL.com news — https://www.nhl.com/news/nhl-edge-stats-leaders-for-2025-2026-season ✅ (fetched 2026-05-05)
- ❌ NHL EDGE skater page direct — redirect loop between edge.nhl.com and www.nhl.com/nhl-edge; both 301 to each other
- ❌ Natural Stat Trick glossary — 403; content from training-window context + community references
- ❌ The Athletic NHL — blocked (paywalled host)
- ❌ Hockey Reference analytics page — 403
- ❌ TopDownHockey site — empty landing page; advancedhockeystats.com 308-redirects to hockeystats.com
- 🔍 SPORTLOGiQ via Databricks blog + ESPN coverage — https://www.databricks.com/blog/managed-sportlogiq-databricks-data-ingestion-pipelines-nhl-teams-game-changing-alliance ; https://www.espn.com/nhl/story/_/id/38724195/nhl-brings-advanced-puck-tracking-stats-public

### §2 Emerging frames

- ✅ MIT Sloan 2025 hockey panel summary via search snippets — https://www.sloansportsconference.com/event/decisions-on-ice-the-next-frontier-of-hockey-analytics
- 🔍 LINHAC 2024 Pitassi possession-time paper (r=0.77) — https://cs.uwaterloo.ca/~brecht/papers/linhac-2024.pdf (PDF was binary-encoded, content from search snippets + abstract reference)
- 🔍 LINHAC 2025 net visibility / net reachability — http://www.cs.toronto.edu/~sven/Papers/LINHAC2025.pdf (search-snippet access)
- ✅ Defense Quality (DQ+) — https://medium.com/hockey-harmony/defense-quality-a-new-way-of-measuring-defensive-impact-in-the-nhl-8d1f11ff4655 (Matt Anikiej, fetched 2026-05-05)
- ✅ LB-Hockey SPAR + 25 skills + multi-year cards — https://lb-hockey.com/2025/12/05/capturing-contributions/ (Louis Boulet, fetched 2026-05-05)
- 🔍 Gaussian Mixture Model playing styles (LINHAC 2025) — search-snippet only
- 🔍 Hockey-Statistics 2025 v2.0 xG model — https://hockey-statistics.com/2025/08/26/hockey-analytics-xg-models-v-2-0/
- 🔍 NHL Opportunity Analysis (Amazon Science) — https://www.amazon.science/news-and-features/nhl-shot-opportunity-analysis-aws-machine-learning
- 🔍 Sample-size reliability rates (Pierre-Louis Oct 2025) — https://medium.com/@neilpierre24/sample-size-evaluating-reliability-rates-for-nhl-metrics-839465cd0ace
- 🔍 NHL aging curves with FPCA (2024 jqas paper) — https://www.degruyterbrill.com/document/doi/10.1515/jqas-2024-0083/html
- 🔍 HockeyViz Age & Decay — https://hockeyviz.com/txt/age22 (cited via search; site 403'd directly)

### §5 Adjacent sports

- ✅ Cleaning the Glass garbage-time methodology — https://cleaningtheglass.com/stats/guide/garbage_time
- 🔍 BBall-Index talent grades vs impact, Role Fits, D-LEBRON — https://www.bball-index.com/about/about-the-data/
- 🔍 FBRef progressive pass / carry definitions — https://fbref.com/en/comps/Big5/passing_types/squads/Big-5-European-Leagues-Stats
- 🔍 Hudl Statsbomb On-Ball Value (OBV) (2021) + xT — https://www.hudl.com/blog/possession-value-models-explained
- 🔍 MDPI Dynamic Expected Threat (DxT) 2025 — https://www.mdpi.com/2076-3417/15/8/4151
- 🔍 Baseball Savant bat tracking (swing speed, squared-up rate, blast) — https://baseballsavant.mlb.com/leaderboard/bat-tracking
- 🔍 NFL Next Gen Stats 2025 (CP 2.0, Pressure Probability, Coverage Responsibility, Passing Score) — https://www.nfl.com/news/next-gen-stats-new-advanced-metrics-you-need-to-know-for-the-2025-nfl-season
- 🔍 PFF grading methodology (-2/+2, multi-grader audit) — https://www.pff.com/news/pff-fc-all-you-need-to-know-about-how-grades-are-calculated

### Hockey xT / PAV academic context

- ✅ Hamahakkimies xT for hockey — https://www.hamahakkimies.com/project/expected-threat-in-ice-hockey
- ✅ Hockey Graphs Bayesian Space-Time PAV (2021) — https://hockey-graphs.com/2021/07/06/bayesian-space-time-models-for-expected-possession-added-value-part-1-of-2/

---

## Honest disclosures

- **HockeyViz, Natural Stat Trick, Hockey Reference, The Athletic** — could not directly fetch substantive page content (403 / paywalled). Material on these products in §1 leans on the Silver Seven interview, NHL.com news pieces, and training-window context. *I have not validated their specific 2025-26 features list against live pages.*
- **LINHAC 2024 paper PDF** — was returned as binary-encoded content the WebFetch could not parse; its findings are reflected here from the published abstract via search snippets.
- **MIT Sloan 2025 hockey panel** — sourced from event description + secondary coverage. I did not pull a primary slide deck or video.
- **OTTHAC 2024-2025** — search returned older 2021/2022 conference pages and YouTube channel hint, but no surfaced 2024 or 2025 program. May be a discoverability issue rather than the conference being inactive.
- **Specific revenue / subscriber numbers for any product** — not fetched.
- **"Citrus Uncopied Territory" cross-references** are based on the prod schema captured in `PHASE_5_STEP_1_FINDINGS.md` (2026-05-05). Some of the columns named (e.g. `goalie_rebound_control`) are present but currently *empty*; the differential opportunity is real, the data fill-rate isn't. Will need backfill before publishing those metrics.

---

## What this research enables next

This document does NOT design any roadmap — that's the next step. With this in hand, the next planning move is to draft:

1. **Citrus Differentiation Roadmap** — pick which §3 gaps + §4 unlocks ship in which order; sequence the multi-season backfill, anomaly engine, xT model, comparison drawer, shift narratives, and goalie track around them
2. **Component spec extensions** — what new primitives (anomaly chip, reliability indicator, comparison drawer, xT heatmap, shift-narrative timeline) need to land in citrus2 design system
3. **Data-pipeline gap-fill list** — what derived tables (xT location grid, anomaly rolling window, sample-size reliability table, multi-season percentile cohorts) need to exist before the design surfaces ship

That's the next conversation. This doc is the input.

---
---

# PASS 2 — Broader ecosystem survey (added 2026-05-05)

The first pass covered established public products + academic conferences. Pass 2 surveys the ecosystem layers that the analyst-product-survey lens missed: independent analyst Substacks, community discussions, fantasy products, betting / prospects / goalie verticals, podcasts, international hockey, and explicit fan frustration.

**Strategic reframe (locked by Garrett mid-research):** Citrus is BOTH the analyst product ("is this player good?") AND the fantasy decision product ("should I start them tonight?"). Not two products — two lenses on the same data. This expanded the scope to Parts L-O on analyst-fantasy translation, projection methodology gaps, fantasy community pain points, and DFS analytics.

Same fetch-status legend applies: ✅ direct fetch · ⚠️ partial · 🔍 search-snippets · ❌ blocked · 📚 training-window context.

---

## §7 Hockey analyst Substacks + blogs (Part E)

### 7.1 Active independent analyst Substacks

| Author | Substack / Site | Subs | Distinctive frame | 2024-25 surface area |
|---|---|---|---|---|
| **Jack Han** | jhanhky.substack.com + Hockey Tactics ebook annual | 9k+ | **Coach-perspective tactical breakdowns** — DZ / NZ / OZ / special-teams schemes per team, illustrated. Bridges X's-and-O's with analytics | Hockey Tactics 2025 (294 pages, all 32 NHL teams + Four Nations Final). Recent Substack posts: "TBL Powerplay Breakout Variations", "Playoff Playbook: Carolina's Forecheck Secret" |
| **Greg Revak** | hockeysarsenal.substack.com (Hockey IQ Newsletter) | 8k+ | **Hockey sense / IQ as primary analytical frame** — pattern recognition, decision-making rather than counting stats | ⚠️ Specific 2025 post titles not surfaced from landing page |
| **Garret Hohl** | thefivehohl.substack.com (The Five Hohl) | (smaller) | **Winnipeg Jets-focused** with broader analytics framework. Recent essay frame: "Financial Markets vs Hockey Analytics" comparing investment-style risk/return thinking to player analytics | ⚠️ Article archive not directly fetched |
| **David Castillo** | dcastillo.substack.com (Stars Stack) | 1k+ | **Dallas Stars + broader NHL** — player breakdowns + bigger-picture storytelling. Wrote "A 2025 Casual Fan's Guide to Advanced Stats and Hockey Analytics" — onboarding for new fans | Lian Bichsel defensive performance breakdown; casual-fan-guide explainer |
| **Patrick Bacon** | topdownhockey.medium.com + hockeystats.com | (Medium quiet since 2021) | **NHL Equivalency (NHLe) modeling** + xGAR + projections. Medium archive 2017-2021 covered draft analytics, prospect projection, Python-based xG building tutorials | Active surface migrated to hockeystats.com (joint with JFresh) and X/@TopDownHockey |
| **JFresh** | jfresh.substack.com | (10k+ across sub + Patreon) | **Player-card analytical writing + projections** — 3-yr weighted RAPM/WAR with isolated impact. Acknowledged limitation: model isn't tuned to coaching-change effects | "The NHL Scouting Report 2026" (full league projection essay), "2025-26 Season Preview, I guess", player-card explainer (returning) |
| **JFresh (alongside Patrick Bacon)** | hockeystats.com — productized version | — | Free tier: NHL WAR, playoff odds, bracket sim. **$5/mo:** weighted 3-yr WAR cards. **$10/mo:** scouting reports + microstat cards (passes, zone entries, entry denials) | 2025-26 scouting report library |

### 7.2 Adjacent analyst voices

- **Dom Luszczyszyn (The Athletic)** — *Game Score Value Added (GSVA)*. Game Score (originally 2016, redesigned 2020 to use xG instead of Corsi with separate forward/D weightings) is summed to season GSVA, scaled to wins. Used for The Athletic's NHL **player tiers** (5 tiers across 150 players including goalies — co-developed with Shayna Goldman). One of the rare projection systems where pre-season aggregation projects whole team standings.
- **Shayna Goldman (The Athletic)** — Data + video. Co-creator of BehindtheBenches.com, 1/3 of *Too Many Men* podcast. Authored hockey-analytics primers (GAR, GSVA, goalie metrics). Heavy on goalie analysis.
- **Dimitri Filipovic (Sportsnet)** — Hosts the **Hockey PDOcast** (since 2015 — longest-running hockey-analytics podcast). Recent: HALO conference, used AHL tracking data to analyze passes for D-zone risk-of-losing-possession factors.
- **Sean Tierney (Charting Hockey)** — Built reputation on Tableau dashboards, regular TSN Hockey Analytics segments. **Now Director of Analytics at Ottawa Senators (2023+)** — moved in-house, public-facing output reduced.
- **Mike Kelly (Sportlogiq + NHL Network + FanDuel Sports Midwest)** — Director of Analytics & Insights at Sportlogiq, on-air NHL Network analyst. Voice that frequently bridges the private SPORTLOGiQ data lens to public TV.
- **Alison Lukan** — **Now in-house at Seattle Kraken** ("Analytics with Alison" on Kraken Hockey Network 2024-25+). Wrote the original Columbus Blue Jackets Hockey Analytics Conference. Public surface narrowed since the in-house move.
- **Charlie O'Connor** — At PHLY Sports + The Athletic (NOT ESPN — earlier guess corrected). PHLY Flyers Podcast.
- **Eric Tulsky (Carolina Hurricanes)** — **In-house** as manager of analytics. Was a major public voice 2010s; now silent publicly.

### 7.3 Pattern: the public-to-private migration

A meaningful structural shift in 2022-2025: **the strongest independent analyst voices have been hired by NHL teams.** Tulsky → Hurricanes, Tierney → Senators, Lukan → Kraken (in-house broadcast role). This thins the public analyst layer continually. The remaining independent voices (JFresh, Bacon, Boulet, McCurdy, Han, Revak) are more concentrated and more product-monetized than ever.

**Implication for Citrus:** there's room for a public analyst voice + product because the field is being depleted by team poaches. Citrus could be the new shared platform for the next Tulsky-/Tierney-tier voices that haven't yet been hired in-house.

---

## §8 Community discussions (Part F)

### 8.1 Reddit + HF Boards

- **r/HockeyStats** is the larger of the two analytics subreddits ("Reddit's #1 hockey analytics community" — covers NHL, AHL, NCAA, CHL, Europe, IIHF). **r/hockeyanalytics** is small (~185 subs).
- **HF Boards "By The Numbers" forum** — dedicated analytics subforum. Active threads: "Which Website Do You Consider More Reliable for Advanced Stats: Natural Stat Trick or Moneypuck?", advanced-stats-overrated debates.
- **Common community-level critique** (from HF Boards thread synthesis): advanced stats *are* useful but get used poorly — fans cherry-pick chart screenshots without context; the limited number of discrete events compared to baseball makes single-game stat reads unreliable; Quantum Pro Hockey (private) has 462 metrics that public products don't expose.

### 8.2 What people are actually arguing about

- **Inter-model disagreement** is the dominant meta-conversation. JFresh ≠ HockeyViz ≠ Evolving ≠ The Athletic projections often differ by 5-10 standings points/team. Community asks: "which model is right when?"
- **Garbage-time / score-effect handling** is uneven — Score-Adjusted Corsi exists but no public product implements Cleaning-the-Glass-style "discard garbage time entirely."
- **Public-vs-private data divide** — fans know SPORTLOGiQ has 500+ metrics that public products don't, generating ongoing "if only we had X" conversation.

### 8.3 Community wishlist (synthesized from threads)

- Better in-game live-update analytics (current public products are season-aggregated)
- Real-time injury-impact projection
- Tools to identify regression candidates without manual cross-referencing of expected vs actual
- More accessible explanations for non-stats fans

---

## §9 Fantasy hockey ecosystem (Parts G + M + N + O)

This is the layer that the Pass 1 doc almost entirely missed — and per Garrett's strategic reframe, **it's half the product mandate**.

### 9.1 Dominant fantasy hockey hubs

| Product | Scope | Distinctive | Methodology surfaced |
|---|---|---|---|
| **Daily Faceoff** | Lineups, projections, news, betting picks, weekly streaming | The dominant fantasy + DFS hub. Hosts Daily Faceoff Live (Yaremchuk, Cohen, Seravalli, M-F noon EST). DFO Fantasy Show (Brock Seguin) | **Customizable rankings**, weekly Strength-of-Schedule + streaming targets per week, line-combo and PP-unit pages |
| **DobberHockey** + **Frozen Tools** | Season-long fantasy analytics powerhouse | Frozen Tools "Big Board" custom reports, **Frozen Tools Forensics** weekly column (player MVPs by position, post-deadline performance, multi-category performers) | Reports incorporate ADP, % of team's PP, 82-game scoring pace, multi-category basic stats. Buys vs Dobber's 2025-26 fantasy guide ($) |
| **5V5 Hockey** | DFS-focused | Lineup optimizer, projections, cash-game vs GPP guides | DFS projection model + line-stacking optimizer |
| **Stokastic** | DFS-focused | Stokastic NHL projections + ownership + sims for DK/FD | Backtested 5+ years historical |
| **Daily Fantasy Fuel** | DFS-focused | DraftKings + FanDuel projections | Standard inputs |
| **RotoWire** | Cross-fantasy | Daily projections, season rankings, news | Standard inputs |
| **LineStar** | DFS-focused | Projections + tools | Standard inputs |
| **SaberSim** | DFS-focused | "Best NHL DFS projections" — sims-based optimizer | Monte Carlo sim approach |
| **Yahoo Fantasy** | Season-long platform leader | Default platform for most leagues | Pianowski's pre-draft rankings (methodology not publicly stated) |
| **ESPN Fantasy** | Season-long platform | Default rankings + projections | Methodology not publicly stated |
| **CBS Fantasy** | Season-long platform | "Proven computer model" projections | Backtested 3 years on DK |
| **FantasyPros** | Cross-platform consensus | Aggregates multiple analysts' rankings | Consensus = mean of N rankers |
| **Hashtag Hockey** | Tools (rankings + utility) | Fantasy hockey rankings + tools | — |
| **FantasyHockeyHelper** | Community-built | Yahoo OAuth integration, player performance graphs over season, sync from Yahoo | Independent open project |
| **NHL.com fantasy** | League-affiliated | Sleeper picks, expert content | Editorial |

### 9.2 What goes INTO current fantasy projections

Per **Daily Faceoff / DraftKings / FanDuel / Stokastic / 5V5** methodology synthesis (search-snippet sourced):
- **Recent N-game scoring rate** (form / pace)
- **Ice time + PP ice time** (deployment)
- **Vegas odds / implied team total** (game environment)
- **Back-to-back schedule** (rest)
- **Head-to-head historical** (matchup)
- **Line combinations** (linemate strength)
- **Goalie matchup** (opponent goalie quality)
- **Power-play unit assignment** (PP1 vs PP2)
- **Average draft position (ADP)** as a value reference

### 9.3 What is NOT in current fantasy projections

This is the gap Garrett's reframe targets. **Public fantasy projections do NOT use:**
- **xG-based individual evaluation** (xG/60, finishing % = G−xG, xA1/60)
- **Pre-shot pass context** (`pass_quality_score`, `pass_immediacy`, `goalie_movement_score`)
- **Score-state purified rates** (CtG-style garbage-time stripping)
- **Anomaly detection** (high xG vs low G regression candidates)
- **Multi-season percentile context** (this player is at his career 73rd percentile this season)
- **Talent-vs-variance separation** (volume comes from talent, finishing has variance)
- **Confidence / sample-size reliability layer** (this rate is stable at this sample size)
- **Defensive impact in projections** (most fantasy formats ignore — but pure-points formats like Yahoo H2H still benefit from on-ice impact for line-mate context)
- **Career-arc / age-curve adjustment** with explicit aging-curve regression
- **xT-style transition value** (carries / passes that move puck to dangerous areas)

**This is the methodological moat.** Daily Faceoff is the dominant hub by *coverage and frequency*, not by depth of model. Citrus could ship a fantasy projection that adopts MoneyPuck-class xG+talent inputs as its baseline, then layer on:
- Anomaly chip ("running hot/cold by N goals")
- Sample-size reliability indicator
- Multi-season percentile context
- Score-state purified rates

### 9.4 Fantasy community pain points

Synthesized from search results + community discussions:
- **Projection accuracy is low and variance is high.** Hockey is "one of the most volatile DFS sports" (per Stokastic backtesting language). Daily projections shift hourly.
- **Playoff/end-of-season weirdness** — projections degrade when teams rest, tank, or shift roles.
- **Goalie projection is shaky** — backup goalie assignments cause overreaction/underreaction.
- **"Streaming" is heuristic** — schedule strength is dominated by light-night calculations, not opponent-quality projection.
- **No tool unifies analyst-grade evaluation with daily-decision projection.** Analyst tools tell you "is this player good," fantasy tools tell you "what's tonight's projection." Nobody bridges them.

### 9.5 DFS-specific frames worth importing into season-long

- **Stack correlation** — playing the goalie of the team you've stacked skaters on (positive correlation: their wins → wins for your goalie). Season-long doesn't currently use this.
- **Leverage / ownership** — GPP DFS gameplay focuses on *underowned* stacks; the analytical frame is "what's the field doing wrong, and how do I bet against it?"
- **Game-environment / pace** — Vegas implied total → pace → projection floor. Season-long projections rarely surface pace context.
- **Line-stacking optimization** — DFS optimizers explicitly model line-combo correlation. Season-long doesn't.
- **Cash vs GPP framing** — different decision mode (floor vs ceiling). Maps to "safe start" vs "boom-or-bust" for season-long fantasy.

---

## §10 Adjacent communities — betting / prospects / goalie (Part H)

### 10.1 Hockey betting

- **Pinnacle** — sharpest market judge by closing-line value
- **Action Network** — provides projections (spread, ML, total) compared to market with edge % + letter grades. Distinctive frame: identifies "sharp money" via line-movement signals
- **EVAnalytics, Wunderdog, SportBot AI, Underdogchance, SportsLine** — model-driven NHL pick services. SportsLine reports 78-54 record on top-rated NHL puck-line + over/under for 2024-25 ($1,600 ROI on $100 stakes per their marketing)
- **Sharp betting analytical frames** that fantasy and analyst products don't surface:
  - **Closing-line-value (CLV)** — model accuracy proxy. *Citrus could measure its own model accuracy this way.*
  - **Sharp money detection** — market-action divergence as signal
  - **Backup-goalie value** — public over/under-reaction patterns
  - **Game-environment betting context** — implied team totals, weather / building proxies (less relevant to hockey)

### 10.2 Prospects analytics

- **Will Scouch (Scouching)** — hand-tracked NHL Draft prospect performance database. Subscribers get private question inbox + Discord + custom data tables. **Co-founder of Fractal Hockey.** Ranked 82 skaters for 2025 NHL Draft consensus.
- **Mitch Brown (Elite Prospects)** — Director of North American Scouting at EP. CHL/USHL/NCAA tracking data analysis. Heavy on draft eligibility analysis. **Embedded with EP** rather than independent.
- **Byron Bader (Hockey Prospecting)** — *Hero Charts* + NHLe-based prospect projection model. **Used by 25+ NHL personnel** as a draft/trade aid + thousands of fans + dynasty fantasy players. 2025 Top 32 Draft Rankings published on X.
- **Patrick Bacon's NHLe model** — the canonical academic NHL Equivalency framework. KHL→AHL→NHL chain conversion (KHL→NHL aggregate ~0.63 NHLe). Implemented in `frozenpool.dobbersports.com/frozenpool_nhle.php` as a public calculator.
- **Lassi Alanen** — European leagues (SHL/Liiga/KHL) tracking + scouting. Embedded in Elite Prospects coverage.

**Imports for Citrus:**
- NHLe-based aging/league context as a Phase 2 metric — multi-league percentile
- Draft-tier prospect projection as a separable surface (dynasty fantasy crossover)
- Hand-tracked microstats are NOT replicable — but the *idea* of giving each prospect a tracked-performance card is

### 10.3 Goalie-specific analytics

- **Clear Sight Analytics (Steve Valiquette)** — **34 variables per shot** including shot type, screens, deflections, **pre-shot movement (passes + carries + flow)**. Founded post-2012-retirement. Tracks data NHL play-by-play doesn't. **Direct competitor frame to Citrus's `raw_shots` schema** — Citrus has `pass_quality_score`, `goalie_movement_score`, `pass_immediacy`, etc. that map almost 1:1.
- **JFresh's goalie cards** — pull from MoneyPuck + Evolving-Hockey. Quality Start % + Really Good Start % computed manually from game logs (0+ and 2+ goals saved above expected).
- **HockeyViz goalie analysis** — McCurdy says publicly that goalie variance is so noisy that even GSAx-class metrics feel underwhelming. This is where Citrus's `goalie_rebound_control` + `goalie_gsax_primary` decomposition becomes a differentiator if/when populated.

---

## §11 Podcasts / video / international (Parts I + J)

### 11.1 Podcasts where analytical frames emerge

- **The Athletic Hockey Show** — daily M-F. Tier-list-style player analysis, betting picks, prospect coverage. Dom Luszczyszyn + Shayna Goldman regularly dive into projection methodology + tier debates.
- **Hockey PDOcast (Dimitri Filipovic)** — since 2015. Casual-friendly analytics. Recent: AHL tracking data, HALO conference recaps.
- **Glass and Out (The Coaches Site)** — coach-perspective analytics. Jack Han + John Becanic appearances. Frames: tactical systems, video-as-analytics, hockey IQ measurement.
- **DFO Fantasy Show + Daily Faceoff Live** — fantasy + DFS methodology. Listener critique: format shouting/static issues.
- **Apples & Ginos (fantasy hockey)** — deep dives on fantasy with prospects analysts (Byron Bader appeared for 2025 Draft dynasty)

**Frames that emerge in spoken-word but aren't productized:**
- **Tier-based projection** — "tier 1 vs tier 2 player" framing for trade/draft decisions; more digestible than continuous percentile
- **Coach-speak translated** — Jack Han's framework reads tactical patterns from systems (forecheck pressure types, breakout variations) that current analytical products don't expose at the player level
- **Hockey IQ measurement** — Greg Revak's framing — pattern recognition vs raw stat output. Hard to operationalize but real
- **Listener questions** as a discovery surface — what fans actually want to know

### 11.2 International hockey

- **IIHF World Junior Championship** (Dec 2024 - Jan 2025: USA defeated Finland 4-3 OT). Tournament stats published via stats.iihf.com (basic counting stats only, no advanced).
- **Liiga (Finland)**, **SHL (Sweden)**, **KHL (Russia)**, **Allsvenskan (Sweden 2nd-tier)** — analytics primarily through **Elite Prospects** and **DobberHockey "The Journey"** column for prospect performance
- **NHLe conversion factors** are the dominant international-to-NHL bridge. KHL aggregate ~0.63 NHLe, AHL ~0.38 NHLe relative to KHL.
- **Lassi Alanen + Mitch Brown** are the public-facing voices for European prospects analytics

**Frames international hockey uses that NHL coverage hasn't fully adopted:**
- **Multi-league percentile context** — when a player moves SHL→AHL→NHL, comparing him to peers at each level is standard in scouting communities but not in public NHL analytics
- **Tournament-pressure context** — World Juniors / WCH are short-sample high-pressure environments; analytical narratives integrate "how did he perform when the lights were brightest" naturally. NHL public analytics rarely does this for playoff vs regular-season performance

---

## §12 Critique + frustration synthesis (Part K)

Surfaced from community threads, critiques, and absent-from-results signals:

| Frustration | Source | What's missing |
|---|---|---|
| Inter-model disagreement is unresolved | HF Boards, Reddit | Meta-tool that reconciles JFresh vs Evolving vs HockeyViz vs Athletic for a single player and explains which is *more right when* |
| Real-time / live updates | Reddit r/hockey, HF Boards | Most public products are nightly or season-aggregate. No public live-game analytics dashboard |
| Score-effect / situational handling is uneven | HF Boards | Cleaning-the-Glass-style garbage-time stripping has no public hockey product |
| Goalie analytics plateau | McCurdy explicit, community implicit | Need rebound-control / pre-shot-context / screened-shot decomposition. Citrus schema has the columns; nobody has shipped this |
| Fantasy projections are recency-biased + form-driven | DFS / season-long communities | Projections lack xG, pre-shot, score-state, talent-vs-variance, multi-season percentile context |
| Cherry-picked-chart misuse | HF Boards thread | Need confidence/reliability layer on every metric so non-stats fans don't read noise as signal |
| Public-vs-private data divide | Reddit, HF Boards | SPORTLOGiQ has 500+ metrics that public never sees. Citrus's `raw_shots` 57+ features narrows this gap if exposed |
| Analyst voices keep getting hired in-house | Pattern observation | Public ecosystem thins as Tulsky/Tierney/Lukan etc. go private. Room for a new platform that makes the analytics-public role economically sustainable |
| No tool unifies analyst evaluation + fantasy decision | Implicit gap | **The Citrus dual-lens product opportunity** |

---

## §13 NEW — Analyst-fantasy translation matrix (Part L)

Per Garrett's strategic reframe: every metric should have BOTH an analyst reading and a fantasy-decision reading. Below is the matrix for the metrics surfaced across Pass 1 + Pass 2 research. **This becomes the design contract: every stat tile in the Citrus product needs both a "is the player good" panel and a "should I start them" panel.**

| Metric / framework | Analyst reading ("is the player good?") | Fantasy reading ("should I start / draft / trade for?") |
|---|---|---|
| **xG/60 (5v5)** percentile | Top decile = elite shot generator regardless of finishing luck | Floor indicator — high xG/60 means production won't crater even in cold streaks |
| **Goals/60 vs xG/60 delta** | Finishing talent — sustained delta = real skill, recent delta = variance | **Anomaly trigger** — high xG / low G = buy-low / hold; high G / low xG = sell-high / regression target |
| **A1/60 (primary assists per 60)** | Shot-creation talent independent of teammate finishing | Multi-cat fantasy floor — A1 is more sustainable than A2 |
| **xGA/60 on-ice** | Defensive impact — does the player suppress opposing chances | Plus-minus floor + linemate quality signal |
| **xGF% on-ice** | Net possession impact — best single-number player-driving metric | H2H format edge — player-driving wingers carry their linemates |
| **PP1 xGF/60** | Power-play deployment + skill | PPP fantasy projection — top-PP-unit is the dominant predictor of PPP volume |
| **PEN± per 60 (drawn − taken)** | Composure + pressure-drawing ability | Penalty minutes (PIM) leagues + power-play exposure |
| **Pre-shot pass quality** (`pass_quality_score`) | Shooting context — top-decile pass quality means even average finishers hit | **Linemate volatility indicator** — a player with great pass-quality dependence will tank if his linemate sits |
| **Shooting talent multiplier** | Career-stable Bayesian shooter prior | Long-term hold value — buy this player as multi-year fantasy asset |
| **GAR / WAR (multi-component)** | Total impact aggregated to wins | Dynasty / keeper league valuation; ADP comparison shows where the market is wrong |
| **Sample-size reliability** (Pierre-Louis frame) | "This rate stabilizes after N games" | "Don't drop based on 5-game cold streak — this metric needs 25 games" |
| **Career arc / age curve** | Where is the player on their development trajectory | Trade target (ascending), sleeper (pre-peak), decline candidate (post-29 forward / post-30 D) |
| **xT (Expected Threat) location value** | Decision-making quality with the puck | Off-ball production indicator — A2/SOG floor in possession-heavy systems |
| **Score-state-pure rates** (CtG-style stripping) | True talent rate without garbage-time inflation/deflation | "Real production rate" projection that doesn't get fooled by blowouts |
| **Linemate impact decomposition (RAPM)** | Player's effect isolated from teammates | **Tonight-specific volatility** — if his linemate is scratched, projection drops by N% |
| **Anomaly chip (running hot/cold)** | Regression-to-mean expectation framework | **Sell-high / buy-low timing primitive** |
| **PP unit assignment (PP1 vs PP2)** | Coaching trust / role | Direct fantasy point projection delta — PP1 is ~2× PP2 production |
| **Goalie GSAx + rebound control** | Goalie skill decomposition | Start-or-sit decision; expected wins projection |
| **Defensive geometry inside xG** (`distance_to_nearest_defender`, screening box) ⚠️ v2 | Shot-quality context | Quality-shot projection — better than raw shot count. **Deferred to v2** — see § 17, requires NHL EDGE / SPORTLOGiQ / CV unlock. |
| **Career-percentile-vs-current** | Where is the player relative to his own ceiling | Hold-vs-trade decision — at career peak vs ascending |
| **Stack correlation (DFS frame)** | Tactical insight on linemate complementarity | DFS lineup construction primitive |
| **Schedule strength + light-night density** | Less analyst-relevant | Season-long streaming + DFS slate-building primitive |
| **xG / pace per game** | Shot-suppression vs shot-creation game-flow context | DFS game-environment / over-under lean |

**Design implication:** the player profile page needs *two readings of every analytical surface*. Either as toggle ("Analyst view" / "Fantasy view"), or as a persistent secondary annotation under each chart, or as a fantasy-specific panel that appears when "Add to roster watchlist" / "Compare to my team" gestures fire.

---

## §14 Updated gaps + uncopied territory (synthesis update)

### 14.1 New gaps surfaced in Pass 2 (additive to Pass 1 §3)

13. **No public reconciliation tool for inter-model disagreement** — when JFresh says 94 points and Evolving says 99, no product explains *why* and which is more right when
14. **No live-game analytics surface** — every public product is at the season or per-60 aggregation level
15. **Tier-based projection framing is podcast-only** — The Athletic does player tiers in podcast/article form but no product exposes "tier 1/2/3" as a UI primitive
16. **Hockey IQ / decision-quality is unmeasured publicly** — Revak's frame, Han's tactical-pattern reads have no productized analog
17. **No public model accuracy disclosure** — Closing-Line-Value-style accountability that betting markets enforce doesn't exist for analytics products
18. **Analyst-to-fantasy bridge is absent** — Daily Faceoff serves fantasy decisions; Evolving-Hockey serves analyst evaluation. **Nobody serves both with one product.**
19. **Multi-league percentile context** — when prospect moves SHL→AHL→NHL, no public NHL product shows the player's percentile arc through leagues
20. **Tournament / playoff-pressure splits** — public products rarely separate playoff from regular-season talent reads
21. **Stack-correlation analytics** in season-long fantasy — DFS has it; season-long ignores
22. **Confidence-on-projection** as a UI primitive — every fantasy projection is a single number; nobody shows the distribution / variance band
23. **Coaching change effects on projection** — JFresh explicitly identified as a model limitation
24. **Anomaly engine + sell-high/buy-low timing** — implicit in DFS regression analysis, never productized as a standalone surface

### 14.2 Updated Citrus uncopied territory (additive to Pass 1 §4)

- **Dual-lens player profile** — every metric annotated with both analyst and fantasy reading. This is the single biggest differentiator and the new strategic spine
- **Anomaly + sell-high/buy-low chip** — productize the regression-to-mean concept fantasy DFS players already operate by intuition
- **Inter-model reconciliation panel** — show JFresh + Evolving + Athletic + Citrus side-by-side and flag where they disagree, with our model's confidence level
- **Closing-Line-Value-style model accountability** — publish own-model accuracy each week; nobody else does this and betting markets show it builds trust
- **Tier-level projection framing** — adopt The Athletic's tier framing as a UI primitive backed by GAR + xGAR + projection
- **Live game analytics surface** — leverage `raw_shots` real-time updates + `player_shifts` to publish a live "what just happened analytically" feed during games
- **Multi-league percentile arc** — for every NHL player who came through SHL/Liiga/KHL/AHL, show his percentile rank at each level. Differentiator for international + prospect crossover
- **Fantasy projection with analyst-grade inputs** — adopt MoneyPuck-class xG + talent inputs as the projection baseline + layer on anomaly + sample-size + multi-season context. **The methodological moat versus Daily Faceoff / DK / Yahoo / ESPN projections.**
- **DFS frames imported to season-long** — stack correlation, leverage / ownership context, game-environment lean, line-stacking. Surface as fantasy-mode toggles
- **Tactical-pattern reads** — Jack Han / Coach-perspective analytics. Hard to fully replicate without manual tagging but Citrus could expose the data primitives (forecheck pressure proxies via `time_since_last_event` + zone, breakout variations via `pass_zone` + `pass_to_net_distance`)
- **Playoff-pressure splits** — separate playoff and regular-season talent reads with explicit cohort comparison
- **Confidence-on-projection as UI primitive** — every projected stat ships with its sample-size-derived confidence band

### 14.3 What still doesn't change from Pass 1

The "what we can't compete on" list remains: NHL EDGE puck-tracking primitives we don't own, manual microstats we can't backfill (ATZ-class), SPORTLOGiQ-class private analytics we don't have. Pass 2 doesn't add to that list.

---

## §15 Strategic synthesis — the dual-lens product

**The Citrus play, post-Pass-2:**

> Citrus is the first hockey analytics product where every analytical surface has a fantasy decision reading, and every fantasy decision has analyst-grade evaluation behind it. The gap exists because the analyst products (Evolving, JFresh, MoneyPuck) ignore fantasy decisions, and the fantasy products (Daily Faceoff, Dobber, DraftKings) ignore analyst-grade evaluation. **Nobody bridges them. Citrus is that bridge.**

### 15.1 Three things this synthesis implies

1. **Every player profile component needs two readings.** Not toggle-modal — both visible. The xG/60 percentile bullet is *also* labeled "fantasy floor: high consistency." The anomaly chip is *also* "buy-low candidate (regression up expected)." The career-arc viewer is *also* "trade target (ascending phase)."

2. **The fantasy projection itself is a hero surface, not a footer.** Currently Citrus's product spec treats fantasy as a side feature. Post-reframe, the fantasy projection — backed by analyst-grade xG + pre-shot + score-state + talent-vs-variance + multi-season percentile inputs — is a primary product surface. **It's the only fantasy projection in market with that input depth.** That's the pitch.

3. **The "Stormy verdict" Editorial layer can speak in dual language naturally.** Stormy already exists as the editorial voice. Stormy can render verdicts that explicitly use both lenses: *"Elite slot generator — top decile in inside xG/60. Fantasy: floor is high but ceiling is linemate-dependent. Hold in points-only, sell-high in multi-cat where his rate-stat slump masks underlying skill."*

### 15.2 What changes in the roadmap-in-progress

The Pass-1 doc gestured at: differentiation roadmap, component-spec extensions, data-pipeline gap-fill list. Post Pass-2:

- **Component spec extension list grows** — add: dual-lens metric annotation primitive, fantasy-projection panel, anomaly chip, sample-size reliability indicator, inter-model reconciliation panel, tier-projection chip, multi-league percentile arc viewer, live-game analytics strip, playoff-pressure split toggle, confidence-on-projection band primitive
- **Data-pipeline gap-fill list grows** — add: Bayesian shooter-talent table, score-state-purified rate aggregations, multi-league percentile cohort tables, multi-season RAPM rolling, anomaly engine output table (rolling actual-vs-expected), closing-line-value-style own-model accuracy log
- **Roadmap order changes** — *fantasy projection is now Phase 1*, not a side track. Multi-season backfill (already locked) plus xG-based projection plus anomaly chip together make the dual-lens MVP.
- **Strategic copy / pitch changes** — Citrus is "the first hockey analytics product that's also the smartest fantasy decision tool" or vice versa. Either framing works; both are accurate.

### 15.3 What's still unanswered

These remain open for the next planning conversation:
- **Does the dual-lens framing apply to Stormy's tone?** I.e., is Stormy more analyst (clinical) or more fantasy (decision-driving) in voice? Or context-switching by user mode?
- **What's the priority order between the new Pass-2 surfaces?** (Anomaly chip vs inter-model reconciliation vs live-game vs multi-league arc vs playoff splits — they can't all be Phase 1.)
- **How do we handle the goalie sequential-track integration with the dual-lens?** — the fantasy decision around goalie starts is highly time-sensitive; the analyst evaluation is multi-season. Do they live in the same surface?
- **What's the explicit "analyst-only" vs "fantasy-only" cohort?** Some users will only care about one lens. Do we hide the other? Default it off? Settings toggle?

These are roadmap-design questions, not research questions. The research is done. Next move: the roadmap.

---

## §16 Pass 2 sources — additional citations

**Hockey analyst Substacks + voices:**
- ✅ Patrick Bacon Medium archive — https://topdownhockey.medium.com (content stops 2021; active surface migrated)
- ✅ JFresh Substack landing — https://jfresh.substack.com
- ✅ Jack Han Hockey Tactics Newsletter — https://jhanhky.substack.com (+ Gumroad ebooks 2023, 2024, 2025)
- ✅ Hockey IQ Newsletter (Greg Revak) — https://hockeysarsenal.substack.com
- ✅ Stars Stack (David Castillo) — https://dcastillo.substack.com
- ✅ The Five Hohl (Garret Hohl) — https://thefivehohl.substack.com
- ✅ Hockey PDOcast (Dimitri Filipovic) — https://hockeypdocast.com/about-2/
- 🔍 Mike Kelly (Sportlogiq + NHL Network + FanDuel Sports Midwest) — https://x.com/mikekellynhl
- 🔍 Sean Tierney (Charting Hockey → Ottawa Senators) — https://x.com/chartinghockey + https://medium.com/@ChartingHockey
- 🔍 Alison Lukan (Seattle Kraken) — https://www.nhl.com/kraken/news/topic/analytics-with-alison/
- 🔍 Shayna Goldman (The Athletic) — https://muckrack.com/shayna-goldman
- 🔍 Dom Luszczyszyn GSVA — https://medium.com/@b-marsh92 + adjacent explainers
- 🔍 Charlie O'Connor — PHLY Sports/Athletic (NOT ESPN — corrected)
- 🔍 LB-Hockey Multi-Year Cards — https://lb-hockey.com/player-cards-multi-year/
- 🔍 Jack Han Hockey Tactics 2025 X announcement — https://x.com/JhanHky/status/1898010356699529560
- 🔍 Sneak Peek: Hockey Tactics 2025 — https://jhanhky.substack.com/p/sneak-peek-hockey-tactics-2025

**Community discussions:**
- 🔍 HF Boards "By The Numbers" + advanced stats threads — https://forums.hfboards.com/forums/by-the-numbers.241/
- 🔍 r/HockeyStats — https://reddit.rtrace.io/r/HockeyStats
- 🔍 r/hockeyanalytics (small) — referenced

**Fantasy hockey ecosystem:**
- ✅ Daily Faceoff — https://www.dailyfaceoff.com (line combos + projections + streaming targets)
- 🔍 DobberHockey + Frozen Tools — https://dobberhockey.com (Frozen Tools Forensics weekly column)
- 🔍 Stokastic NHL — https://www.stokastic.com/nhl/nhl-projections/ (DFS projections + sims)
- 🔍 Daily Fantasy Fuel NHL — https://www.dailyfantasyfuel.com/nhl/projections/
- 🔍 5V5 Hockey — https://5v5hockey.com (DFS projections + cash-game guide)
- 🔍 RotoWire NHL daily — https://www.rotowire.com/hockey/projections-daily.php
- 🔍 LineStar NHL — https://www.linestarapp.com/Projections/Sport/NHL
- 🔍 SaberSim NHL — https://www.sabersim.com/nhl/projections
- 🔍 Hashtag Hockey — https://hashtaghockey.com/
- 🔍 FantasyHockeyHelper — https://tompedron.medium.com/fantasyhockeyhelper-technical-improvements-2024-2025-eb82e14e1454
- 🔍 Fantasy Hockey Geek (mentioned, not directly fetched)
- 🔍 NHL.com Fantasy — https://www.nhl.com/news/fantasy-hockey-top-10-sleeper-picks-deep-sleepers
- 🔍 DraftKings + FanDuel methodology synthesized via FantasyData / RotoGrinders / Stokastic guides
- 🔍 Daily Faceoff Weekly Strength of Schedule — https://www.dailyfaceoff.com/news/fantasy-hockey-2025-26-weekly-strength-of-schedule-and-streaming-targets-week-13

**Adjacent communities:**
- 🔍 Pinnacle NHL totals — https://www.pinnacle.com/betting-resources/en/hockey/finding-potential-value-in-2024-2025-nhl-team-totals
- 🔍 Action Network NHL — https://www.actionnetwork.com/nhl
- 🔍 Will Scouch Scouching — https://www.scouching.ca/
- 🔍 Mitch Brown Elite Prospects — https://muckrack.com/mitchlbrown/articles
- 🔍 Byron Bader Hockey Prospecting — https://hockeyprospecting.com/
- 🔍 Frozen Tools NHLe Calculator — https://frozenpool.dobbersports.com/frozenpool_nhle.php
- 🔍 Steve Valiquette Clear Sight Analytics — https://ingoalmag.com/2021/05/16/a-guide-to-the-data-of-clear-sight-analytics-csa/ + 2025 InGoal updates

**Podcasts + video:**
- 🔍 The Athletic Hockey Show — https://open.spotify.com/show/1ELJDK8J8DXMN2X9TicBQ5
- 🔍 Hockey PDOcast — referenced
- 🔍 Glass and Out (The Coaches Site) — https://thecoachessite.com/john-becanic-hockey-iq-think-fast-play-fast/
- 🔍 Apples & Ginos Fantasy Hockey podcast — https://creators.spotify.com/pod/profile/apples-and-ginos
- 🔍 DFO Fantasy Show — https://podcasts.apple.com/us/podcast/dfo-fantasy-show/id1046192515

**International:**
- 🔍 IIHF stats — https://stats.iihf.com (basic counting only)
- 🔍 Liiga / SHL / KHL via Elite Prospects — https://www.eliteprospects.com/league/liiga/stats/2024-2025 (and similar)
- 🔍 Patrick Bacon NHLe modeling — https://hockeystats.com/methodology/nhle

---

## Pass 2 honest disclosures

- **Most analyst Substack landing pages return only the masthead** in WebFetch responses — the substantive archives sit behind subscriber-list rendering. What I have on Han / Revak / Hohl / Castillo is the publisher-stated topic + stray titles surfaced via search. Specific 2024-25 essay claims should be considered "directionally accurate" rather than verbatim-cited.
- **Reddit was poorly searchable** — my `site:reddit.com` queries returned no hits. The community discussion synthesis in §8 leans on HF Boards threads + secondary blog summaries. The "fan wishlist" claims are inferred from the absence-of-tools rather than direct quoted threads.
- **The Athletic's "Strange Game" podcast** — couldn't confirm existence with that name; The Athletic Hockey Show is their daily flagship and what I substituted.
- **Hockey-Statistics building xG models series** — referenced multiple times; I have the URLs but didn't deep-fetch each post (https://hockey-statistics.com/2025/05/18/hockey-analytics-building-xg-models-in-python/, https://hockey-statistics.com/2025/08/26/hockey-analytics-xg-models-v-2-0/).
- **Specific projection-model accuracy numbers** for Daily Faceoff, Dobber, Yahoo, ESPN, RotoWire — not publicly disclosed by those products. Methodology summaries are search-snippet inferences.
- **r/fantasyhockey "tools wish existed" thread** — couldn't surface a specific thread despite searching. The community-pain-point synthesis in §9.4 is patterns-from-the-aggregate, not direct quotes.
- **Sleeper hockey** — Garrett's question whether Sleeper launched NHL fantasy. Search returned only "sleeper picks" articles for 2024-25 (the term, not the platform). **No evidence the Sleeper platform launched NHL fantasy** as of May 2026 from the search-result level. Worth confirming directly.
- **Specific PFF / NGS comparisons to hockey** — Pass 1 covered PFF + NFL NGS adequately; Pass 2 didn't deepen these.

---

## §17. What we don't have and why — capability boundaries

This section documents capabilities that **sound** like they should be in
v1 but aren't, and the data-availability reasons. World-class doesn't
mean every advertised metric is present — it means every shipped metric
has meaningful accuracy. This list is the inverse: what's deferred,
with the unlock path explicitly stated.

### 17.1 Positional defender geometry (`distance_to_nearest_defender`, `nearest_defender_to_net_distance`, `skaters_in_screening_box`)

**Status:** dropped from `raw_shots` schema 2026-05-07 (Phase 0 / 0d-pre #1).

**What we investigated 2026-05-07:**

1. **NHL public PBP feed (api-web.nhle.com `/v1/gamecenter/{id}/play-by-play`)** carries:
   - Per-event actor IDs (shooter, goalie, blocker, hitter, scorer + assists)
   - Per-event xy coordinates (where the action happened)
   - `situationCode` (4-digit strength code, e.g. "1551")
   - **NOT carried:** on-ice player ID arrays, defender coordinates, per-frame tracking
2. **NHL EDGE granular tracking** (60Hz puck IR, 15Hz skater IR — fully operational since 2021-22) **is captured by the league but exposed publicly only at aggregate granularity** — `/v1/edge/` endpoints return season-level skating distance / speed / zone time per player. No per-event coordinate data is surfaced for third-party consumption.
3. **MoneyPuck doesn't compute it either.** Direct inspection of `shots_2018-2024.csv`: zero columns matching `defender|screening|screen`. Their TOI/composition columns (`defendingTeamForwardsOnIce`, `defendingTeamAverageTimeOnIce`) are derivable from `situationCode` + shifts, but positional geometry isn't there.
4. **HockeyViz, Evolving Hockey, Natural Stat Trick** — all derive from the same NHL public PBP. None publish positional defender features.

**Why this matters:** every public hockey analytics product sits in the same data ceiling. Synthesizing fake `distance_to_nearest_defender` from "shifts + recent defender event proximity" puts noise in the moat — every subsequent xG retrain either weights it toward zero (best case) or chases spurious correlations (worst case). MoneyPuck doesn't ship this. We don't ship it either.

**v2 unlock paths** — see [GAPS_AND_FUTURE_CAPABILITIES.md](GAPS_AND_FUTURE_CAPABILITIES.md) for cost/timeline. Three are known to work:
1. **NHL EDGE granular licensing** — direct relationship with NHL Stats group; per-event coordinate access. ~$50k–$500k/year, 6–12 month BD cycle.
2. **SPORTLOGiQ partnership** (or equivalent: Stathletes, InStat) — pre-computed positional features from broadcast CV. ~$100k–$1M/year, 3–9 month sales cycle.
3. **Internal CV pipeline on broadcast video** — build position tracking on top of NHL game video. ~$100k–$300k upfront engineering, ~$50k–$150k/year operations, 6–12 months to first production data.

**Strategic recommendation:** defer. None justify the spend pre-launch. Revisit when revenue or distribution justifies — first paying user / first major-league pitch / first ESPN-tier deal. At that point Path 2 (SPORTLOGiQ-style partnership) is the cheapest accuracy-per-dollar.

### 17.2 What we DO have on the defensive context axis

The TOI/composition layer is present and consumable — these *are* the v1 defensive-context features:

| Feature | Source | Notes |
|---|---|---|
| `defending_team_skaters_on_ice` | derivable from `situationCode` | already in the extractor |
| `defending_team_forwards_on_ice` / `_defencemen_on_ice` | join `player_shifts_official` × `player_directory.position_code` | MoneyPuck CSV provides for 2018-2024 |
| `defending_team_average_time_on_ice` (fatigue proxy) | aggregate of on-ice players' shift duration | MoneyPuck CSV provides; computable from shifts for live data |
| `defending_team_max/min_time_on_ice` | same | MoneyPuck CSV provides |
| TOI-since-faceoff variants | reset at each faceoff | MoneyPuck CSV provides |

These give us **fatigue/strength context** (a tired top D-pairing is genuinely worse than fresh fourth-liners, and that's measurable from shift duration alone). This is the right v1 floor.

### 17.3 Other deliberate v1 gaps

- **Per-frame puck/player tracking** — same constraint as defender geometry; same v2 unlock paths.
- **Shot speed / release velocity** — captured by NHL EDGE infrared but only published at season aggregate. Per-shot speed is v2.
- **Pass speed / route geometry beyond `pass_x` / `pass_y` / `pass_to_net_distance`** — current 7-feature moat is what's possible from PBP event coordinates. Fine-grained pass trajectory is v2.
- **Zone-entry quality** — derivable but not in v1 schema. Add post-launch when xT (Expected Threat) lands per § 4.2.

### 17.4 What this section is NOT

- Not a roadmap. Roadmap items go through normal product prioritization.
- Not a complete deferred-features list. It enumerates only the *capability boundaries* tied to data-availability constraints. Engineering choices (e.g. "we don't ship a comparison drawer in v1") belong in the product backlog, not here.
- Not a request to relax accuracy standards. Anything we ship in v1 still has to meet the world-class accuracy bar — this section just establishes which features can't meet that bar with current data and so aren't in v1 at all.

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
- **Defensive context inside xG** — `distance_to_nearest_defender`, `nearest_defender_to_net_distance`, `skaters_in_screening_box`, `defending_team_skaters_on_ice`. Defense-Quality competitor that uses pre-shot defender geometry, not just "shots suppressed."
- **Special-teams pass routes** — `is_power_play`, `time_since_powerplay_started`, full pass-context columns. PP1 / PP2 unit pass-route maps no public product has.
- **Score-state pure rates** — `score_differential`, `home_skaters_on_ice`, `away_skaters_on_ice`, `period`, `time_remaining_seconds`, `is_empty_net`. Cleaning-the-Glass-style garbage-time stripping (e.g., empty-net + lead) for hockey is straightforward with these columns and has no public equivalent.

### 4.2 Differential model territory

- **Citrus xT ("Expected Threat for hockey")** — implement the Markov-chain location-value model that academia has shown works (Hamahakkimies, Bayesian PAV) but nobody productized. With `arena_adjusted_x_abs` / `arena_adjusted_y` rink coordinates + transition events, this is buildable. **Would be the first public xT in hockey.**
- **Anomaly engine** — for each player on each metric, compare 30-game rolling actual vs expected. Surface "running hot / running cold / projecting up / projecting down." Pulls together xG, GAR components, and multi-season context that prod data already supports.
- **Sample-size confidence layer** — every metric ships with its reliability quartile and a tooltip explaining "this stabilizes around N games." Pierre-Louis's research as a UI primitive.
- **Career-arc viewer** — multi-season backfill (Garrett locked) + age-curve overlay + percentile-rank-over-time chart. HockeyViz / LB-Hockey have fragments; nobody has this as a primary product surface.
- **Comparison drawer** — JFresh-style cards for two players side-by-side, with delta highlighting. BBall-Index has Role Fits; hockey has nothing equivalent.
- **Shift narratives** — surface a player's best/worst 90-second shifts of the season, with the sequence of events (entry → pass → shot) reconstructed. This would be the most editorial / shareable product surface in public hockey.
- **Style typology classifier** — apply Boulet's SPAR-style 25-skill framework to Citrus's data, with the advantage that we have raw_shots feature granularity (passes, rebounds, defender geometry) that LB-Hockey synthesized from ATZ manual tracking.

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

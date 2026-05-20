# Gaps & Future Capabilities — v2 Unlock Paths

This doc enumerates capabilities that are **known-deferred** and the
specific data, partnership, or engineering moves that would unlock
them. It is the inverse of the active roadmap: every item here is a
"we know this exists, we know how to get it, we have decided not to
get it yet, here's why and what changes the calculus."

Updated alongside the v1 architecture, not as a wishlist. Each entry
has: capability description, why it's deferred (data / cost / strategic
fit), three or fewer concrete unlock paths with cost + timeline ranges,
and a stated strategic trigger for revisiting.

> **The world-class accuracy bar applies in both directions.** It means
> shipped v1 metrics meet that bar AND deferred v2 metrics aren't
> faked from worse data to look like they're shipped. See
> `apps/web/docs/HOCKEY_ANALYTICS_LANDSCAPE_2026.md` § 17.

Cost ranges are rough industry estimates as of 2026-05-07. Always
re-verify with current vendor pricing before committing.

---

## §1. Positional defender geometry

**Capability:** `distance_to_nearest_defender`, `nearest_defender_to_net_distance`, `skaters_in_screening_box`, per-frame defender xy. Inputs to a positional shot-quality model that improves on the current 31-feature moat.

**Why deferred (2026-05-07):**

- NHL public PBP feed exposes only per-event actor IDs (shooter, goalie, blocker, hitter), not on-ice rosters or defender coordinates.
- NHL EDGE captures the data (15Hz player IR + 60Hz puck IR since 2021-22) but exposes only aggregate skating-distance / shot-speed / zone-time at the public `/v1/edge/` endpoints.
- MoneyPuck, HockeyViz, Evolving Hockey, Natural Stat Trick — none publish positional defender features. Industry signal: the data isn't broadly available.
- Shipping a fake "synthesized" estimate from shift overlap + event proximity would put noise in the moat. Every xG retrain would either weight it toward zero or chase spurious correlation.

### Unlock paths

| # | Path | Cost (annual) | Cost (upfront) | Timeline | Notes |
|---|---|---|---|---|---|
| 1 | **NHL EDGE granular licensing** (direct NHL Stats group relationship) | $50k – $500k | minimal | 6 – 12 months BD cycle | Per-event coordinate access. League-direct, no third party. Sales pitch is "we're publishing analyses that drive fan engagement." |
| 2 | **SPORTLOGiQ partnership** (or Stathletes / InStat equivalents) | $100k – $1M | minimal | 3 – 9 months sales cycle | Pre-computed positional + tactical features from broadcast CV. Cleaner integration; positional geometry comes pre-derived. The cheapest accuracy-per-dollar at this scale. |
| 3 | **Internal CV pipeline on broadcast video** | $50k – $150k | $100k – $300k | 6 – 12 months to first production data | Build position tracking on top of NHL game video (or league-licensed feed). Highest engineering risk, highest long-term IP value. Requires CV/sports-AI hire. |

### Strategic trigger to revisit

**Whichever of these fires first:**
- First paying user at a price point ≥ $30/mo who explicitly cites defender-context analytics as the reason for paying
- First major-league or media-tier deal where positional analytics is the differentiator
- First competitive product (one of the existing public players, or a new entrant) ships defender geometry — at that point we've lost a moat day one and need to catch up

**Recommended at trigger time:** Path 2 (SPORTLOGiQ-style partnership). Cheapest accuracy-per-dollar; clearest contract terms; doesn't require us to operate league-direct relationships.

**Effort to integrate once unlocked:** 4–8 weeks to land a sidecar `raw_shots_v2_positional` table + retrain xG on the enriched feature set + ship the UI.

---

## §2. Per-frame puck / player tracking ("Edge Analytics" full granularity)

**Capability:** real-time or per-second puck speed, player positions, route geometry, possession events derived from millisecond-level tracking. Powers shift-narrative reconstructions, transition-quality analysis, possession-based xG.

**Why deferred:** same constraint as § 1 — NHL EDGE captures it, exposes it only at aggregate. Public products don't have it.

### Unlock paths

Same three as § 1. The NHL EDGE relationship (Path 1) is the cleanest at this granularity since it's the league's own data. SPORTLOGiQ-style partnerships (Path 2) provide *features* derived from this stream rather than the raw stream itself — sufficient for most use cases, cheaper to integrate.

### Strategic trigger to revisit

Combine with § 1 — same partnership unlocks both. No reason to pay separately.

---

## §3. Per-shot release velocity

**Capability:** shot speed (mph) per individual shot — currently we have shot location + type + situation but not exit velocity off the stick. NHL EDGE captures this via the puck infrared (60Hz) and publishes season-aggregate per skater.

**Why deferred:** the per-shot granularity isn't in any public feed. Aggregate is — we could ingest it for "season-aggregate shot speed leaderboards" but per-shot velocity in `raw_shots` is gated on Path 1 from § 1.

### Unlock paths

| # | Path | Cost (annual) | Notes |
|---|---|---|---|
| 1 | NHL EDGE granular | per § 1 | Per-shot velocity comes with per-event coordinate access |
| 2 | SPORTLOGiQ-equivalent | per § 1 | Most vendors derive shot speed from CV |
| 3 | **Aggregate-only ingestion** (free, today) | $0 | Season-level shot speed per skater is in `/v1/edge/` — would still produce a "hardest-shooter leaderboard" without per-shot detail |

### Strategic trigger to revisit

If users explicitly ask for shot-speed per shot in shareable highlight clips ("McDavid's 102mph one-timer"), reconsider Path 3 first — aggregate shot-speed leaderboards are a valuable shareable surface even without per-shot granularity, and would land in days rather than months.

---

## §4. Zone-entry quality (controlled vs uncontrolled, carry-in vs dump-in)

**Capability:** classify each zone entry by manner — carry-in, pass-in, dump-and-chase, failed. Inputs to entry-success-rate-per-player metrics.

**Why deferred:** derivable from existing `raw_nhl_data` + zone events but **not in v1 schema** because we haven't built the entry-classifier yet. This is an engineering gap, not a data gap.

### Unlock path

**One path: build it internally** when xT (Expected Threat) lands per landscape doc § 4.2. Estimated effort: 1–2 weeks of engineering against existing PBP coordinates. No external dependency.

### Strategic trigger to revisit

When xT is on the active roadmap. Combine the zone-entry classifier with the xT location-value model — they share the same coordinate-trajectory primitives.

---

## §5. Fine-grained pass trajectory beyond `pass_x` / `pass_y`

**Capability:** pass curvature, intermediate route points, pass speed. Currently we have pass start coordinates + immediacy score + pre-shot context — sufficient for the moat features but not for full route reconstruction.

**Why deferred:** PBP gives only event endpoints, not per-frame trajectory. Same v2 partnership paths as § 1 / § 2 unlock this for free.

### Strategic trigger to revisit

Combine with § 1 / § 2. No standalone justification.

---

## §6. Multi-league percentile arcs (SHL / Liiga / KHL → NHL)

**Capability:** percentile-rank a 19-year-old SHL player against the historical NHL transition curve to predict NHL upside. Powers prospect dashboards.

**Why deferred:** different pipeline, different data sources (Elite Prospects, individual league feeds). Not technically blocked — just not v1 product scope.

### Unlock paths

| # | Path | Cost (annual) | Notes |
|---|---|---|---|
| 1 | **EliteProspects API** | $5k – $25k | Most analyst products use EP for prospect data. Cleanest integration. |
| 2 | **Per-league official feeds** (SHL / Liiga / KHL APIs) | $0 – $50k each | Variable availability + format. More engineering, lower cost. |
| 3 | **Manual curation** | $0 + ongoing operator time | Defensible only at very small N players. |

### Strategic trigger to revisit

When prospects / draft / international becomes a product surface (e.g., "draft pool projections for fantasy keeper leagues" or a standalone prospects feed). Pre-launch fantasy-only product doesn't need this.

---

## §7. Real-time (live in-game) analytics streaming

**Capability:** sub-30-second-latency live xG / GAR-delta / win-probability updates during games. Powers in-game betting / DFS / live-shift narratives.

**Why deferred:** we currently scrape on a 15-min cadence (per `playoff-sync.yml` and similar workflows). Sub-minute latency requires either NHL real-time PBP licensing or a streaming infrastructure layer.

### Unlock paths

| # | Path | Cost (annual) | Notes |
|---|---|---|---|
| 1 | **NHL real-time data feed licensing** | $25k – $250k | Direct league relationship. Cleanest source. |
| 2 | **Polling at higher cadence + better scrape infra** | $1k – $5k (proxy + compute) | We can take our current 15-min scrape down to ~30 seconds with the existing 100-IP proxy rotation. Diminishing-returns curve flattens around 15s due to NHL feed update frequency. |

### Strategic trigger to revisit

If/when DFS or live-betting becomes a product surface. Path 2 covers most use cases and is cheap; Path 1 only if the use case is professional-tier.

---

## §8. Goalie individual-shot save-probability beyond GSAx

**Capability:** per-shot probabilistic save model that conditions on goalie identity + shot context — beyond aggregate GSAx. Inputs to live "stop probability" overlays + goalie matchup tools.

**Why deferred:** we have the aggregate version (`goalie_gsax`, `goalie_gsax_primary`, `goalie_rebound_control`). Per-shot conditioned on goalie ID requires more training data per goalie than 1 NHL season provides — Phase 0a brings 7 historical seasons which gives us enough sample size. Not actually deferred forever — likely a v1.5 deliverable post-Phase-0.

### Unlock paths

**One path: build it** post-Phase-0 once historical PBP is loaded. Estimated effort: 1–2 weeks model engineering + retrain. No external dependency.

### Strategic trigger to revisit

After Phase 0 closes. This one is closer to the active roadmap than to "deferred."

---

## §9. Real per-player TOI from `player_shifts_official` join

**Capability:** replace the `time_since_faceoff` proxy used in `data_acquisition.py:calculate_toi_features_proxy` with actual shift-derived per-player TOI computed by joining `player_shifts_official` against shot timestamps. Yields true `shooter_time_on_ice`, `shooting_team_average_time_on_ice`, distinct values per player on the ice (not the same proxy value collapsed across all 36 TOI columns).

**Why deferred (2026-05-07):** the v1 fix sequence in 0d-pre #2 + Bug B/C/D/E unlocks the proxy values from "always NULL" to "populated proxy" — typeCode 502 lookup correctly resolved against an all-events buffer, save function preserves the cascade, 180-second window covers extended possessions. That gets us *something* honest in the columns. But it's still a proxy — every player on ice is reported with the same `time_since_faceoff` value, and the column names imply per-player accuracy that the data doesn't have.

**Residual ~5% NULL after Bug E fix:** even with `max_seconds=180`, ~5% of shots will remain NULL for legitimate reasons:
  - Period-start shots before the period's opening faceoff is in the buffer
  - Extended power-play possessions exceeding 180s (rare but happens)
  - Period-spanning sequences where the faceoff is in a prior period (`calculate_time_difference` returns None for cross-period lookups by design — different game state)

The v1.5 shift-derived approach would close that gap (a player's TOI in the current shift is well-defined regardless of how long the possession has lasted or whether a faceoff is recent), but requires the `player_shifts_official` join work below.

The real version requires:

1. Per-shot lookup against `player_shifts_official` to identify the 5+1 players on ice
2. Per-player TOI computed as `shot_timestamp - shift.start_time` for each on-ice player
3. Aggregate (avg / max / min / forward-only / defenceman-only) statistics across the 5 skaters
4. Same for defending team
5. Replace the 36 proxy column writes with the real values
6. Retrofit existing 99,394 rows + the post-0a 905K historical rows via #6-style sweep

This is a **larger engineering lift** (~1-2 weeks) but produces honestly named columns and unlocks finer-grained shot-quality features (e.g., "tired-D-pairing penalty" in xG retraining).

### Unlock path

**One path: build internally.** No external dependency. Cost is engineering time only.

### Strategic trigger to revisit

After Phase 0 closes. Combine with the xG v3 → xG v4 retrain that includes:
- Real TOI features (this entry)
- Corrected `last_event_category` labels (§ 11)
- 7 historical seasons of moat features from 0c

The retrains are bundled because they all touch the same training corpus.

---

## §10. Legacy NHL API `last_event_category` labels — coordinated retrain required

**Capability:** correct the `last_event_category` labels (`'TAKE'`, `'FAC'`, `'HIT'`, etc.) in `raw_shots` so they semantically match what the events actually are.

**Current state (audited 2026-05-07):** lines 1326 + 2812 in `data-pipeline/acquisition/data_acquisition.py` contain a typeCode → label mapping with stale values from the older NHL Stats API era. Wrong assignments in the modern api-web.nhle.com world:

| typeCode | actually | mapped to |
|---:|---|---|
| 502 | faceoff | `'TAKE'` (wrong — should be `'FAC'`) |
| 503 | hit | `'FAC'` (wrong — should be `'HIT'`) |
| 504 | giveaway | `'HIT'` (wrong — should be `'GIVE'`) |
| 508 | blocked-shot | not in map → `'OTHER'` |
| 509 | penalty | `'BLOCK'` (wrong — should be `'PENL'`) |
| 516 | stoppage | `'PENL'` (wrong — should be `'STOP'`) |
| 525 | takeaway | not in map → `'OTHER'` |

The labels are nonetheless **internally consistent with `models/last_event_category_encoder.joblib` and the trained xG v3 model** — every faceoff event has been encoded as the same `'TAKE'`-derived integer since training, so model predictions remain numerically correct despite wrong labels. The `last_event_category` column is currently 99.4% populated in prod but ~62% of rows carry semantically wrong labels (sum of TAKE + FAC + HIT + BLOCK rows).

**Why deferred:** fixing the labels without retraining would silently degrade xG v3 accuracy. The encoder would either (a) reject the newly-relabelled rows because `'FAC'` was never seen during training of those slots, or (b) fall back to a default integer the model doesn't expect. Either way, ~24% of all shots (faceoff-prior ones) get wrong xG predictions.

### Unlock path — coordinated retrain

**One path: full retrain pipeline.** No external dependency.

1. Phase 0a complete (905K-row historical corpus loaded into raw_shots)
2. Phase 0c complete (moat features extracted for 7 historical seasons)
3. Update map labels in `data_acquisition.py` lines 1326 + 2812
4. Retrofit `raw_shots.last_event_category` via #6-style sweep (UPSERT all rows with corrected labels)
5. Retrain `last_event_category_encoder.joblib` on corrected labels
6. Retrain xG v3 on retrofitted training data
7. Validation gate: new xG v3 AUC ≥ 0.817 (current production benchmark)
8. Coordinated deploy: new encoder + new model artifacts in atomic commit

**Estimated effort:** 1-2 days (mostly compute time for retrain + validation).

### Strategic trigger to revisit

**Post-0c, before any feature work that depends on `last_event_category` semantic correctness.** Examples that would surface as triggers:

- Phase 1 anomaly engine "shot taken right after stoppage" detection (would need real `STOP` labels)
- "Rebound generation right after faceoff" leaderboards (would need real `FAC` labels)
- Public-facing UI surfaces that show event type labels (currently OK because we don't surface them)

Until then, predictions remain accurate via the consistent-but-wrong-labels approach.

### Why a single fix-and-retrain rather than incremental updates

The encoder is a categorical-one-hot transformer. Adding new categories (e.g., correcting `'TAKE'` → `'FAC'`) shifts every category's encoded position. There's no incremental path — it's atomic retrain or no change.

---

## §11. Save function fragility — `_save_shots_to_database` manual column enumeration

**Capability:** robust, drift-resistant write path from extraction to `raw_shots`.

**Current state (audited 2026-05-07 during 6a pilot debug):** `_save_shots_to_database` in `data-pipeline/acquisition/data_acquisition.py` manually enumerates every column to write — currently ~114 explicit `'col': ...` entries in the record dict. Adding a new column upstream (in `_extract_shots_from_game`) without also adding it here causes **silent data loss** — the value is computed but never written to the database.

**How it broke:** between extraction and save, 38 columns were silently dropped (the entire 36-column TOI cascade + `time_difference_since_change` + `average_rest_difference` + 5 misc). Caught only because Phase 0 / 0d-pre #2's typeCode fix surfaced the cascade and the 6a pilot validated end-to-end.

**Why deferred:** the immediate Bug D fix (commit `[fixed in 6a-v3]`) added the missing columns inline. The architectural fix would replace the manual enumeration with one of:

1. **`df_shots.to_dict('records')`** — write all DataFrame columns directly. Simplest. Drawback: less explicit type coercion; need a separate type-coercion pass.
2. **Programmatic column copy** — iterate `df_shots.columns` and apply per-column type coercion via a registry (`int_cols`, `float_cols`, `bool_cols`, `str_cols`). More expressive than option 1; preserves the type-safety the current code provides.
3. **Schema-introspecting writer** — query `information_schema.columns` for `raw_shots` once at startup, build the type map automatically, write only columns that exist in the schema. Most robust; catches the missing-column case at write time instead of silently dropping.

### Unlock path

**One path: build internally.** No external dependency. Cost: 1-2 days for option 2 (recommended) or option 3.

### Strategic trigger to revisit

**Post-Phase-0 cleanup, before any feature work that adds new shot-level columns.** The current state — explicit enumeration with a strong "MUST update" comment — is acceptable for the duration of Phase 0 since no new columns are being added. The first feature that adds a new `raw_shots` column triggers this cleanup.

### Why it survived this long

The xG v3 model only uses ~31 of the ~114 raw_shots columns. As long as those 31 are in the save dict (they are), model output is correct. The missing TOI columns weren't surfaced until R7-2 baseline checks looked at NULL rates across all columns 2026-05-07. This is the system working as designed: monitoring caught the silent drift.

---

## §12. CV-extracted on-ice formations + tactics

**Capability:** classify shifts by tactical pattern (1-3-1 PP, 2-2-1 forecheck, etc.) using CV on broadcast video. Powers coach-tier tactical intelligence.

**Why deferred:** requires the same CV pipeline as § 1 Path 3 + a tactical taxonomy + ML classifier. Significant engineering. Not in any public hockey product today.

### Unlock paths

Same as § 1 Path 3 (internal CV pipeline). Adds a tactical-classifier head on top of the position-tracking output.

### Strategic trigger to revisit

When the user base is professional / coach-tier. Pre-launch fantasy doesn't need this.

---

## §13. `extractor_job.py` retirement — completed 2026-05-12

**Capability:** redundant `raw_nhl_data → player_game_stats` extraction pipeline.

**Status:** **RETIRED 2026-05-12** during Phase 0 boxscore cleanup. Moved to `scripts/_deprecated/extractor_job.py`. The Windows scheduled task wrapper (`ops/windows/run_extractor_live.ps1`) was renamed to `DISABLED_run_extractor_live.ps1`.

**Why retired:**

1. **Redundant.** Live scrapers (`data-pipeline/acquisition/scrape_live_nhl_stats.py`, `scrape_per_game_nhl_stats.py`, `fetch_nhl_stats_from_landing.py`, `fetch_nhl_stats_from_landing_fast.py`) populate every `player_game_stats` column extractor_job did.
2. **Partially buggy.** Audit 2026-05-12: extractor_job never populated `nhl_shp` — 0 / 34,800 rows across its entire production lifetime. Live scrapers correctly populate it (116 / 18,918 rows = 0.6%, plausible shorthanded-points rate). Running extractor_job on the 474 boxscore-backlog games would have **overwritten** correct live-scraper values with extractor_job's zeros.
3. **Broken-cron disposition.** R4 reorg (2026-05-05) moved the script from repo-root to `scripts/utilities/`, but `ops/windows/run_extractor_live.ps1` referenced the old path. The Windows scheduled task has been failing silently since Feb 2026 (matches the stoppage of `stats_extracted_at` flag updates).
4. **Cosmetic flag only.** extractor_job's only unique side effect was setting `raw_nhl_data.stats_extracted_at`. That flag is now backfilled on the 474 games via a one-time `UPDATE ... SET stats_extracted_at = NOW()` based on live-scraper presence in `player_game_stats`.

**What we'd lose by retiring:** nothing of value. Live scrapers cover every column at higher fidelity.

**What we gained:** simpler pipeline (one writer instead of two), no risk of future schema additions creating drift between the two writers, no risk of correct live-scraper values being overwritten by extractor_job's zeros.

**Operator action item (one-time, low priority):**

If you have access to the Windows machine that ran the scheduled task, remove the Task Scheduler entry that invokes `run_extractor_live.ps1`. The script rename (`DISABLED_*`) means the task will continue to fail silently on every run, which is operationally harmless but generates noise in the Windows event log. Removing the task entry cleans this up.

**Re-instatement criteria:** none. If a future scrape need surfaces, build a fresh script with knowledge of the current schema rather than reviving the legacy one.

---

## §14. Defensive GAR pipeline (EVD / PPD / Penalty Component) — deferred to 0d-post

**Capability:** populate `player_gar_components` defensive components — `evd_gar_per_60` (Even-Strength Defense, xGA/60 at 5v5), `ppd_gar_per_60` (Penalty-Kill Defense, xGA/60 on PK), `penalty_gar_per_60` ((penalties drawn − taken) / 60).

**Current state (audited 2026-05-12):**

| Component | Zero rate | Cause |
|---|---:|---|
| `evd_gar_per_60` | 97.9% (915 / 935 rows) | `calculate_gar_components.py:349` hardcodes `0.0` with `# TODO` |
| `ppd_gar_per_60` | 98.3% (919 / 935 rows) | Same — line 350 |
| `penalty_gar_per_60` | 100% (935 / 935 rows) | Same — line 353 |

The script knows what it needs but ships the defensive components as stubs ("Placeholder for EVD and PPD (will be calculated when on-ice tracking is available)").

**Why deferred to 0d-post:**

GAR computation produces stable rates only when there's enough TOI sample size. Building defensive GAR on the **current single-season corpus** (2025-26, ~935 player-rows) would produce noisy values and force a rebuild after 0a + 0c bring 7 historical seasons online. Same "match work to phase" discipline applied to #1 (defender geometry — wait for data), #2 (typeCode — fix once, retrofit once), #6 (drain — single coordinated pass).

**Unlock conditions (ALL REQUIRED before #7 can land):**

1. **0a complete** — historical CSV load (786K MoneyPuck shots, 2017-18 → 2024-25)
2. **0c complete** — PbP API replay for 7 moat features across 7 historical seasons (provides full per-shot context)
3. **player_shifts_official multi-season backfill** — currently 2025-26 forward only; need full per-shot on-ice attribution across historical games

**Implementation scope (~2-4 days post-conditions):**

| Component | Approach | Effort |
|---|---|---|
| **EVD** | For each (player, shot) pair where the shot was taken against the player's team at 5v5: check if player was on ice via `player_shifts_official` (shift.start ≤ shot_time ≤ shift.end on same game_id); sum xG of those shots → xGA; divide by 5v5 TOI × 60 | ~2 hrs core code; the shift-overlap join is the new logic |
| **PPD** | Parallel to EVD with situation filter (defending team on PK at shot time) | ~30 min once EVD pattern lands |
| **Penalty Component** | Scan `raw_nhl_data.raw_json.plays` typeCode 509 penalty events; attribute to `committedByPlayerId` (taken) and `drawnByPlayerId` (drawn); compute `(drawn − taken) / TOI × 60` | ~1-2 hrs (data already there) |
| **Pilot on single season + extend to full corpus** | Verify rate distributions are sane (≥80% non-zero, plausible variance) before extending | ~1 hr |
| **Validation against R7-2 sentinel** | Add `player_gar_defensive_components_populated` check (parallel to existing offensive check) | ~30 min |

**Validation gate (post-implementation):**

- `evd_gar_per_60` ≥80% non-zero across all player-seasons
- `ppd_gar_per_60` ≥80% non-zero among players with PK TOI > 0
- `penalty_gar_per_60` ≥80% non-zero (most players draw or take ≥1 penalty per season)
- Distributions match public benchmarks (HockeyViz / Evolving Hockey RAPM-style)

**Strategic trigger:** post-0c, before any feature work that depends on per-player defensive impact (e.g., Defense-Quality leaderboards, lineup chemistry analytics, fantasy-pool defensive scoring).

---

## §15. UPSERT clobbers moat features on re-run after Phase 0c

**Capability:** safe re-run of `scripts/utilities/load_historical_shots_csv.py` post-Phase-0c without overwriting the 7 pre-shot moat features. As shipped today the loader cannot be re-run after 0c lands without code mitigation.

**Current state (audited 2026-05-19):** the loader explicitly writes `None` to the 7 moat features on every payload row (`load_historical_shots_csv.py` lines 166-174 + 302-304):

- `pass_quality_score`, `pass_immediacy_score`, `goalie_movement_score`
- `pass_zone_encoded`, `pass_lateral_distance`, `pass_to_net_distance`
- `has_pass_before_shot`

The write goes through `SupabaseRest.upsert()`, which POSTs to PostgREST with `Prefer: resolution=merge-duplicates`. PostgREST's merge-duplicates semantics translate to `INSERT ... ON CONFLICT (...) DO UPDATE SET <every payload column> = EXCLUDED.<col>` — **including columns set to NULL.** On a conflict the NULLs in the loader payload overwrite whatever values were previously stored.

**Concrete failure mode:** once 0c completes and moat features are populated for historical seasons 2018-19 → 2024-25, any re-run of `load_historical_shots_csv.py` (schema-drift retrofit, accidental re-launch, partial-failure recovery on a future-season batch, etc.) will clobber the 7 moat columns back to NULL on every row it touches. A subsequent xG retrain on the corrupted corpus would silently degrade.

**Why deferred to post-0c:** refactoring the loader before 0c finishes adds untested code paths to a working loader at the worst possible moment (mid-0a/0c sequence). The current behavior is correct for 0a — the 7 moat features are intentionally NULL for historical rows until 0c populates them. Match-work-to-phase: ship 0a with the trap-door documented; address the structural fix once 0c is complete and a re-run path is plausibly on the surface area.

### Unlock paths (apply post-0c)

| # | Approach | Effort | Notes |
|---|---|---|---|
| (a) | Omit the 7 moat columns from the upsert payload entirely | 30 min | Cleanest: PostgREST does not touch columns absent from the payload. Existing moat values survive any conflict resolution. One edit at `load_historical_shots_csv.py:303` — replace the "explicit None" loop with "skip entirely." Recommended. |
| (b) | Add precondition filter `WHERE season < 2025 AND has_pass_before_shot IS NULL` to the upsert | 1-2 hr | More defensive but introduces complexity: the loader has to pre-query each batch or split the upsert into "rows where moat is still NULL → write" vs "rows already populated → skip." Use only if (a) is somehow insufficient. |

Either path preserves 0c's work. Pick (a) unless a future requirement (e.g., partial-row updates that need to touch moat columns conditionally) makes (b) necessary.

### Mitigation already in place

Prominent trap-door comment block above the `db.upsert()` call in `scripts/utilities/load_historical_shots_csv.py` warning operators not to re-run post-0c without applying one of the unlock paths above. Cross-references this §15.

### Strategic trigger to revisit

**Apply unlock path (a) post-0c, before any code path that could re-trigger the loader on already-loaded historical rows.** Concrete triggers:

- Phase 0c closeout: at the moment 0c finishes successfully and moat features are populated for seasons 2018-19 → 2024-25, the loader becomes a clobber hazard.
- Schema additions to `raw_shots` that would prompt a re-run of historical data through the loader (e.g., a new MoneyPuck column landing).
- Operator-initiated re-load of any season (idempotent in 0a's design, dangerous post-0c).

Until 0c lands, the trap-door comment is the only mitigation needed — the loader's current behavior is correct.

---

## §16. Bookkeeping summary

| § | Capability | Status | Cheapest unlock | Trigger to revisit |
|---|---|---|---|---|
| 1 | Positional defender geometry | deferred | SPORTLOGiQ partnership ($100k+/yr) | First paying user citing defender analytics; competitor ships first |
| 2 | Per-frame puck/player tracking | deferred | combined with § 1 | combined with § 1 |
| 3 | Per-shot release velocity | deferred (per-shot); **partial** (aggregate) available | aggregate via existing EDGE endpoint, free, today | If users ask for per-shot detail in clips |
| 4 | Zone-entry quality | engineering gap, not data gap | build internally with xT | When xT is on the roadmap |
| 5 | Fine-grained pass trajectory | deferred | combined with § 1 / § 2 | combined with § 1 / § 2 |
| 6 | Multi-league percentile arcs | not v1 scope | EliteProspects API ($5–25k/yr) | When prospects surface enters product |
| 7 | Real-time streaming | partial (15-min cadence today) | poll at higher cadence ($1–5k/yr) | DFS / live-betting product surface |
| 8 | Per-shot goalie probability | engineering gap, post-Phase-0 | build internally | After Phase 0 closes |
| 9 | Real per-player TOI from shifts | engineering gap, post-Phase-0 | build internally (~1-2 weeks) | After 0c, bundled with xG v4 retrain |
| 10 | Legacy `last_event_category` labels | engineering gap; retrain-coupled | full retrain pipeline (~1-2 days) | Post-0c, bundled with xG v4 retrain |
| 11 | Save function fragility (`_save_shots_to_database` manual enum) | engineering gap | programmatic column copy + type registry (~1-2 days) | Before any feature work that adds new shot-level columns |
| 12 | CV-extracted tactics | deferred | internal CV pipeline | Coach-tier user base |
| 13 | `extractor_job.py` retirement | **RETIRED 2026-05-12** | (done — moved to `_deprecated/`) | Operator may want to remove the Windows scheduled task entry |
| 14 | Defensive GAR pipeline (EVD/PPD/Penalty) | engineering gap, deferred to 0d-post | implement on full multi-season corpus (~2-4 days) | After 0a + 0c land |
| 15 | UPSERT clobbers moat features on re-run after 0c | documented; code mitigation deferred to post-0c | omit 7 moat columns from upsert payload (~30 min) | Post-0c closeout, before any loader re-run |

---

## §17. Document maintenance

Add a row here when:
- A capability moves from active roadmap to deferred
- A v1 feature is dropped because the data isn't available (like the 2026-05-07 defender geometry drop)
- A new unlock path becomes viable (new vendor, new public API, new internal capability)

Remove a row here when:
- A capability ships in production (move to a "shipped capabilities" inventory in `DATA_INVENTORY.md`)
- A capability is permanently de-scoped (e.g., league announces a feature will never be public)

This doc is **engineering honesty as artifact**. It costs ~30 minutes per year to maintain and saves hours of "wait, why don't we have X?" investigations.

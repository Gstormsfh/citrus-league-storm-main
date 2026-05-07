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

## §9. CV-extracted on-ice formations + tactics

**Capability:** classify shifts by tactical pattern (1-3-1 PP, 2-2-1 forecheck, etc.) using CV on broadcast video. Powers coach-tier tactical intelligence.

**Why deferred:** requires the same CV pipeline as § 1 Path 3 + a tactical taxonomy + ML classifier. Significant engineering. Not in any public hockey product today.

### Unlock paths

Same as § 1 Path 3 (internal CV pipeline). Adds a tactical-classifier head on top of the position-tracking output.

### Strategic trigger to revisit

When the user base is professional / coach-tier. Pre-launch fantasy doesn't need this.

---

## §10. Bookkeeping summary

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
| 9 | CV-extracted tactics | deferred | internal CV pipeline | Coach-tier user base |

---

## §11. Document maintenance

Add a row here when:
- A capability moves from active roadmap to deferred
- A v1 feature is dropped because the data isn't available (like the 2026-05-07 defender geometry drop)
- A new unlock path becomes viable (new vendor, new public API, new internal capability)

Remove a row here when:
- A capability ships in production (move to a "shipped capabilities" inventory in `DATA_INVENTORY.md`)
- A capability is permanently de-scoped (e.g., league announces a feature will never be public)

This doc is **engineering honesty as artifact**. It costs ~30 minutes per year to maintain and saves hours of "wait, why don't we have X?" investigations.

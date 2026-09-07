# Recent-candidate descriptive finishing bridge

Status: completed offline; not model acceptance, talent estimation, full-season actuals or production integration.

The current ridge-recent candidate now feeds source-bound player finishing totals across the original and recovered retrospective cohorts. Original actor rows are reused from their hash-certified ledger; recovered actors are checked against exact raw event hashes and the reviewed goal-credit partition. The candidate's base bundle **and** recent-adjustment sidecar must match the dated manifest. The original probabilities must also match the replay's unchanged baseline before attachment.

| Cohort | Modeled attempts | Shot-event goals | SOG | Separate non-shot goal credits | Neutral xG |
|---|---:|---:|---:|---:|---:|
| Fold 1 | 121,749 | 8,756 | 87,309 | 19 | 8,956.864469469168 |
| Fold 2 | 122,510 | 8,571 | 84,415 | 18 | 8,507.918489971404 |

These are selected verified populations, not complete official season totals. Non-shot credits remain in a separate event ledger and player/team credit totals, including credit-only players; they receive no model probability and do not inflate shot conversion. Regular season and playoffs remain separate. Historical team stints are retained, with rates recomputed from underlying counts and exposures. Original actuals are not overwritten.

## Evidence

- Runner: `scripts/proof/bridge_recent_finishing.py`.
- Create-only result: `scripts/proof/results/recent-finishing-bridge-20260907-full`.
- Health SHA-256: `291cb4c9b71ea47d157cf7cceb6f8fa2ecc0d91583293f72be36280015dcdea1`.
- All 244,259 candidate probabilities attach to exactly the expected events; 37 non-shot goal credits remain outside that prediction population.
- Independent read-only Node calculation checked output hashes, exact candidate values/sidecar fingerprints, player count/exposure/xG totals, stint attempt conservation, and non-shot disjointness.
- Focused tests: 11 passed. Full offline suite: 3,611 passed, 16 network tests deselected, 33 existing warnings. Receipt: `scripts/proof/results/recent-finishing-bridge-20260907-suite.xml`.

## Still open

This closes a descriptive aggregation bridge, not persistent finishing talent. Appearance games, TOI, per-60 rates and estimated talent remain unavailable rather than inferred from shot appearances. Source exclusions, calibration residuals, broader original-input audit gates, native serving and prospective validation remain open. FPAR acceptance is unchanged. No production data, model selection or UI was changed.

Next dependency: establish matching player appearance/TOI and earlier-only finishing-estimation populations before applying any talent adjustment; keep neutral chance quality distinct and prevent double application.

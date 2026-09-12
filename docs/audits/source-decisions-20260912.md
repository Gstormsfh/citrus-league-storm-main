# Source reconciliation outcome — September 12, 2026

All 20 previously unresolved required lineup slots now resolve to supported projected scenarios. No remaining player, identity, schedule, lineup or budget error appears in the actual-source SQL preflight. The only remaining source gate is explicit publication review; no production activation occurred.

The review candidate is `tmp/projection-audit/source-reconciliation/lineup-candidate.json`, revision `6a71c8db63eb6ee43798f8ab963652b89c103d2f9dae718f3d51b0abb97dd117`. The existing local editor at `http://127.0.0.1:8766` serves this revision. There are 1,325 profiles: 674 projected, 650 rates-only and one unavailable identity-only profile. All original rates remain unchanged; prior records and source coordinates are retained.

## Supported corrections

- Anaheim's source `Lineups!C10` identifies Ian Moore at D2/RD, correcting the team tab's Trevor Moore mapping. Columbus's source supports Dante Fabbro at D3/RD. Philadelphia's source places Noel Acciari at L4/RW. Vancouver's existing crease allocation supports the Tolopilo backup scenario without extra starts.
- New Jersey and the Islanders use coherent original workbook forward scenarios. Rangers, Penguins and Capitals use documented NHL projected scenarios, with coordinated moves that avoid duplicate active players. These are projected lineups, not confirmed opening-night announcements.
- Carolina's `Lineups!C53` and NHL projected lineup both select Gostisbehere–Nikishin. The source explicitly calls Reilly a hedge. His full 76-game forecast remains an unallocated alternative; the two selected bottom-six priors retain their original 39 and 69 games. Carolina totals 1,496 against 1,512 capacity, without an arbitrary GP reduction.
- In total, 19 exact saved priors are restored, one hedge is unallocated, and 54 slot assignments include the coordinated moves. All 32 crease budgets remain 84 starts, all skater budgets fit, and active IDs are unique and assigned to the correct team.

| Reconciled team | Skater GP / 1,512 capacity |
|---|---:|
| ANA | 1,419 |
| CAR | 1,496 |
| CBJ | 1,388 |
| NJD | 1,439 |
| NYI | 1,460 |
| NYR | 1,336 |
| PHI | 1,394 |
| PIT | 1,323 |
| VAN | 1,388 |
| WSH | 1,368 |

## Evidence and remaining release boundary

The exact source URLs, workbook coordinates, before-values and changes are in `final-slot-evidence-nyr-pit-wsh.json`, `final-slot-evidence-seven-teams.json`, and the candidate's review history, under `tmp/projection-audit/source-reconciliation/`. `build_lineup_candidate.py` reproduces the merge and checks rate preservation, selected identity uniqueness, workload provenance and budgets; `lineup-verification.json` records the result. [Actual-source SQL preflight](../verification/canonical-source-preflight-lineup-20260912.json) uses the current directory and full regular-season schedule in a rollback-only isolated database transaction.

Line and PP annotations are source context in the current calculation, not additional numeric multipliers. Changing them does not retrain or recondition the retained rates. Required exact-ID coverage satisfies the original source work order; confirmed opening-night deployment is not required. Unsupported optional profiles remain visible and unranked rather than acquiring invented rates, probabilities or zero workloads. Compatibility outputs retain their supported forecast categories; an enabled unsupported category remains unavailable.

No additional human roster/modeling choice was identified after this bounded evidence pass. Source publication and production release still require deliberate review. The original workbook and guide, initial canonical source and previous proposal revisions remain intact. The candidate's explicit review gate has not been cleared for production.

An explicitly reviewed local test copy passed [actual-source activation and rollback](../verification/canonical-source-activation-test-copy-20260912.json): 674 ROS rows, 56,616 daily rows, all 12 exported categories, workload, independently calculated default points and revision identity. The candidate file remained byte-identical and DRAFT; the prior database fingerprints were restored. This establishes local source-to-output behavior, not deployed Matchup/device acceptance.

# Additional pass-source investigation

## What was checked

Inspected the official gamecenter for game 2025030416 and its actual network requests. The page requested `gamecenter/2025030416/landing` and `gamecenter/2025030416/right-rail`. Followed their linked official full play-by-play and shot-summary reports rather than guessing tracking routes.

Evidence is preserved in `scripts/proof/results/gamecenter-pass-sources-20260907/`: response bodies, receipt timestamps/statuses/hashes, complete API path inventory and report links. Reproducer: `scripts/proof/audit_gamecenter_pass_sources.cjs`.

## Findings

- Landing supplies goal summaries and the already-known goal-linked replay URLs; no explicit pass trajectory field was identified.
- Right-rail links official reports plus recap and condensed-game videos. It did not expose all-shot tracking in this inspection.
- The full play-by-play report includes richer event descriptions and on-ice participants. The inspected report's pass/assist word search found an assist description on a goal, not a completed-pass event stream. The shot-summary report had no such word match. A word search alone is not proof of universal absence.
- Condensed video is a possible existing-source validation resource, but it is edited/selected coverage. It does not by itself make the goal-linked tracking representative of all shots.
- MoneyPuck's [published xG methodology](https://www.moneypuck.com/about.htm) describes prior-event distance/time, prior-event location/type and rebound angular change/time. This supports event-history proxies; it does not establish that its public model receives observed completed passes. No MoneyPuck files, labels or model weights were used.

## Defensible integration routes

1. **All-shot event-history features:** retain the current lateral/timing context, and test additional strict-prefix actor/event transitions without labeling them as observed passes. Different actors at two recorded events do not establish a completed pass between them: rebounds, recoveries and unrecorded intervening actions remain possible.
2. **Replay-derived passing annotations:** validate control, pass release, reception and shot release against footage; retain unknowns and uncertainty. These can support goal-sequence insights even before they are eligible for ordinary xG.
3. **Tracking-augmented predictive xG:** requires representative positive and negative shot coverage, field availability at prediction time, a frozen detector, and a model comparison that improves held-out metrics. Goal-only pass examples cannot establish either the distribution or predictive effect of passing on all shots.

No guarantee of complete public pass coverage has been established. There is a repeatable validation process, not a 100%-certain pass reconstruction from sparse PBP. A further endpoint investigation should follow resources actually exposed by NHL pages, not blind URL enumeration or access-control workarounds.

Production unchanged. This source investigation is not an xG accuracy improvement and is not a reason to remove existing pre-shot inputs.

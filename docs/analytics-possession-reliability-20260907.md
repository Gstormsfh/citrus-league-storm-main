# Possession reliability audit

## Concrete fix

The recently added possession candidate and continuous-evidence paths did not validate replay timestamps. Both now reject missing/non-finite timestamps, duplicated/reversed/skipped ticks and duplicate player identities within a frame before inferring motion or persistent control. This closes a software failure mode; it is not a measured hockey-accuracy gain. Missing puck positions continue to reset control persistence.

## Saved-source sensitivity experiment

Artifact: `scripts/proof/results/body-possession-review-20260907/possession-sensitivity-v2.json`. The earlier report is preserved. The final report adds code hashes and includes every source replay hash.

All seven saved replay sequences were checked with 27 combinations of radius (60/84/108 renderer units), relative-step limit (12/24/36 renderer units) and hold length (2/3/4 ticks). Separation stayed at 12 renderer units. These are exploratory settings, not fitted optimal parameters.

Across 978 frames:

| Outcome | Frames |
|---|---:|
| Default setting asserted control | 521 |
| Same controlling player under every setting | 299 |
| Every setting abstained | 346 |
| Ownership or abstention changed across settings | 333 |

The last three rows partition the corpus. Unanimity is **not possession accuracy**. In particular, all settings can share the same error; the seven replays are goal-selected, not representative all-play footage. No new ground-truth labels were collected and no probability was calibrated.

## Review queue

Each replay has deterministic first/middle/last samples from parameter-sensitive frames, stable control frames, and stable abstentions where available. All labels remain null. Full disagreement votes are preserved. This queue supports failure discovery; because it deliberately samples strata, it must not be treated as an unbiased accuracy sample without appropriate sampling design/weights. A separate fixed, representative game-level test set is still needed.

Do not claim control confidence by dividing agreement votes by 27. Use disagreements to direct visual review and retain uncertainty. Independent possession labels, video/replay registration and representative held-out testing remain the evidence requirements for trustworthy probabilities. Current viewer exports remain unadjudicated review claims.

Production, xG inputs and weights are unchanged. Existing frozen viewer bundles and reports are preserved.

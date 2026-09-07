# Timing-era source audit — fixed scope

This is a descriptive, no-fit audit of the original eligible development export, not a model acceptance experiment. Preserve all source evidence and original recorded values. Do not change production, labels, predictions, thresholds, or population membership.

## Pinned population

Use `scripts/proof/results/official-development-features-20260906/manifest.json`, SHA256 `9e19e40264c826d8cf818d2c02b0a10b3de1d4d13cba65c470433b616b2f4534`, and its `development.jsonl`, SHA256 `3105195b90d4d9a756773b94aec471c6a146b9fbdce96a5b3e9dfab921b34819`. The manifest declares 541067 eligible events from source seasons 2019–2023. Audit every eligible row exactly once; independently report represented games rather than assuming the manifest game count equals represented games. Preserve excluded and quarantined source artifacts without adding them to this population. Do not open 2024 or 2025 event bodies.

Pin the completed prior-SOG fidelity health (`bc30a53dbd06331e7f065f053bf0300a3606004ff98a6df6c2d8496784091569`) and its declared source closure. Validate source receipt and raw-body hashes, original export provenance, date, event identity, raw order and clock validity. Targets are goal 505 versus non-goal 506/507, excluding shootouts as in the original eligible export. Both saved prior-SOG state and categorical previous-event type must match independently classified raw predecessors. This checks these fields, not a reconstruction of every movement feature.

## Fixed diagnostics

Use the frozen `prior_sog_fidelity.classify` definition: immediate raw predecessor, not nearest previous shot. Keep all states, including unknown. Use its fixed gap bands: no_same_period_predecessor, same_clock, up_to_1s, over_1_under_3s, from_3_to_10s, over_10s. Do not relabel long-gap same-team prior shots as rebounds.

Retain each row's season, calendar month, game type, current event type, target, classified state, exact gap and band, prior event type, current/prior clocks and event IDs and sort orders, source body and receipt hashes, and source event hash. Retain both owners, situation codes and signed raw coordinates. Coordinate equality requires two valid points; never fold signs. Actor equality uses scoringPlayerId for goals and shootingPlayerId for shots/misses only when both actor IDs are valid; unknown actors remain unknown, never equal solely because both are missing. Actor equality and current event type/target are retrospective diagnostics, not prediction inputs. Classification must not depend on current outcome or future events.

Produce fixed count/goal rollups:

- season × state × gap band
- calendar month × state × gap band
- season × current event type × gap band
- season × state × gap band × coordinate equality × actor equality
- season × state × gap band × game type

Require exact row, event-key, count and goal conservation across every rollup. Keep raw denominators visible. Do not invent predictions for training rows or add fitted corrections, uncertainty intervals, selected thresholds, or causal claims.

## Execution and interpretation

Use create-only timing-era-audit result directories, record plan/code/source hashes, and retain failed attempts. Run focused author and independent synthetic tests before the full audit. Reverify source hashes at completion. A successful audit proves consistency with retained source bytes, not physically correct chronology or historically available live inputs. Changes in event composition, integer-second recording, source ordering and recording systems remain hypotheses unless supported independently. Public MoneyPuck methodology may inform interpretation; do not acquire or use its data files, predictions or trained artifacts.

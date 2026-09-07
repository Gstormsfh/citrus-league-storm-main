# Co-motion transfer check on additional clips

## Result

The unchanged exploratory detector recovered the credited primary-assister/scorer pair in three of four additional goal clips under at least one of the six previously used settings. This extends the initial example but is **not 75% pass accuracy**: assist identity is weak retrospective corroboration, and the sample has neither exhaustive pass labels nor representative non-goal coverage.

The four games were selected before trajectory inspection by sorting SHA256(`comotion-unseen-v1/{game_id}`), excluding the original three pilot games, then taking each selected game's first linked replay. All four were retrieved through ordinary official NHL replay pages. Raw bodies, receipts, hashes and complete outputs are preserved in `scripts/proof/results/tracked-comotion-unseen-20260907/`. The reproducible selector and analysis are in `scripts/proof/review_comotion_unseen.py`.

| Game/event | Credited pair recovered in settings | Other findings |
|---|---|---|
| 2025020930/402 | 4 of 6 | Multiple earlier candidate transfers; additional scorer-to-teammate candidate requires temporal validation. |
| 2025030184/59 | 0 of 6 | Brief passer contact and contested receiver proximity fail the current control criteria. |
| 2025020061/271 | 4 of 6 | Earlier Ekman-Larsson → Nylander candidate also appears in all six settings. |
| 2025020111/80 | 5 of 6 | Several candidate exchanges precede the credited pair. |

Settings are sensitivity variants, not independent votes or calibrated confidence probabilities. No setting was selected for deployment. Detection uses only trajectories and goalie roster exclusions; credited identities are joined after extraction.

## Initial example: external corroboration, not exact timing validation

The official [Hall highlight page](https://www.nhl.com/video/car-vgk-hall-scores-goal-against-carter-hart-6398421474112) describes a long Slavin pass received by Hall before his shot. This corroborates the identity/type of the initial recovered sequence independently of simply joining the assist fields. No exact release or reception frame was visually certified in this turn. Playback proceeded into subsequent autoplay content, which was not used as evidence; temporary tabs were closed.

## Causal cutoff implemented and tested

`extract_before_shot` in `data-pipeline/projections/tracked_comotion_candidates.py` requires an explicit in-clip shot-frame index and truncates the input **before** constructing contact runs. The release frame and subsequent frames are excluded. This prevents a receiver's post-shot proximity from satisfying the pre-shot minimum-contact rule.

The cutoff must still come from independently validated shot alignment. This helper cannot establish it and explicitly reports that alignment was not verified by the extractor. Entire-clip candidates are not automatically pre-shot features.

Two new tests establish that post-shot frames cannot complete reception evidence, future changes do not affect the truncated result, and missing/out-of-range cutoff values are rejected. Nine tests across the co-motion and original transfer modules pass. These test software behavior, not hockey-label accuracy.

## Failure diagnosis preserved

For 2025030184/59, the credited passer is close to the puck around frames 73–74 but only one of those transitions satisfies the moderate relative-motion threshold. The scorer is close around frames 79 onward, but proximity competition prevents an accepted stable ownership run. This can reflect short touches, contested puck control, sensor/body offsets or other trajectory limitations; it is not sufficient to identify which without video labels.

Do not loosen thresholds merely to recover the credited pair. A brief-touch classifier needs separate validation. Unrecognized/ambiguous reception must remain unknown, not become an explicit no-pass training label.

## Remaining acceptance gates

1. Independently label release, reception, shot release, deflections and uncertain contacts against official video; do not use assists to select frames.
2. Measure false positives and missed passes on those labels, including one-touch, contested and loose-puck sequences.
3. Validate coordinate scale/orientation and timing before reporting physical distances or reception-to-shot delays.
4. Establish representative non-goal tracking coverage before predictive xG use; goal-selected availability is still outcome-dependent.

No production changes, no new provider, no xG retraining, and no AUC/Brier gain claimed from these replay experiments.

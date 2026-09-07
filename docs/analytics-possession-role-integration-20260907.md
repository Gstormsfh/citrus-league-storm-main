# End-to-end player-role consistency

Updated review: http://127.0.0.1:8768/role-aware-review/ while the local server runs. The previous frozen bundles are preserved.

The goalie abstention rule originally applied only to discrete control candidates. Continuous evidence could still display a goalie score, and probability-training input did not distinguish goalies from skaters. Those paths now agree:

- Evidence rows explicitly carry `actor_role`: goalie, skater or unknown.
- Identified goalies receive no skater-control score or carry persistence. Their positions remain in nearest-competitor comparisons; they are not deleted from the rink.
- The skater-control label join rejects goalie-positive and unknown-role labels. Unknown roles cannot silently become negative examples. Identified goalie rows are excluded from skater-negative examples.
- Direct probability fitting also rejects non-skater or missing roles, so bypassing the join does not bypass the role check. Role metadata remains an externally supported assertion, not proof that a reviewer performed validation.
- The review builder requires roster coverage for every observed player, verifies that viewer frames exactly match the frozen replay and its hash, and preserves the role-source receipt inside the new bundle.

The supervised model's scope is now explicitly **skater control**. Actual goalie possession requires a separate model or reviewed decision process; it is not falsely labeled absent. Reviewers can still record raw goalie observations, but those cannot train this skater-only model.

Verification: 77 regression tests passed; JavaScript syntax and `git diff --check` passed. The role-aware bundle was built successfully against the saved Hall clip and roster. This is a consistency and overclaiming safeguard, not a measured increase in possession accuracy. No independently adjudicated hockey training set, calibrated percentages or xG gain is claimed. Production and model weights remain unchanged.

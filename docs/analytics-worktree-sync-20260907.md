# Analytics worktree checkpoint and synchronization

This checkpoint supersedes the Git status captured inside the earlier handoff receipt. That receipt and its local recovery archive remain historical evidence; they are not rewritten to suggest the work was already committed at handoff creation.

## Scope

The analytics source, tests, research reports, review tooling, handoff, and narrowly scoped production migration record are committed on `fix/analytics-contracts-phase-one`. This is a preservation checkpoint, not acceptance of every experiment, model promotion, or authorization to merge the branch into master.

The branch incorporates the fetched master history. Publishing this branch does not deploy production. The earlier merge safety stash and duplicate utility-file copies remain available locally; do not reapply them over the integrated tree.

## What Git does not back up

The existing `scripts/proof/results/` exclusion remains unchanged. Raw captures, videos, large experiment results and caches there remain local; the evidence references in committed reports do not make those assets available in a fresh clone. The handoff's `uncommitted-work.zip` is also local-only because its constituent source files are committed separately. It is a recovery copy, not a distributable artifact or off-machine backup.

Do not interpret a clean Git status as proof that ignored evidence has been backed up remotely, or that the model is validated for production. Preserve those artifacts until a separate appropriately scoped evidence-backup workflow is completed.

## Verification boundary

The post-master-merge possession/passing/tracking tests and dashboard/game-log server tests passed. Additional projection checks are run during this checkpoint. The staged files are checked for whitespace errors and common credential patterns before committing. This bounded scan is not a comprehensive security audit; no hosted database mutation, production deployment, or new model fit is part of synchronization.

The combined projection/possession/passing/tracking run passed 125 tests. The prior post-merge server run passed 93 dashboard/game-log tests. The staged whitespace check reports an extra blank line at EOF in `verified_movement_reuse_v2.py`, `run_movement_candidate.py`, and `run_zone_context_candidate.py`; these existing evidence-bound source bytes are intentionally preserved rather than reformatted during a preservation checkpoint. The common-credential scan found no matches. This is not a full application-suite run or a review of every staged implementation.

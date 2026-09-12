# Canonical input review

`canonical_inputs.py` imports the retained workbook, reviewed edits, directory and model snapshot. `canonical_review.py` reviews and edits that same versioned JSON. Both are offline; neither connects to Supabase or publishes anything.

Run from the repository root:

```sh
python3 data-pipeline/draftkit/canonical_review.py validate tmp/projection-audit/canonical/canonical.json
python3 data-pipeline/draftkit/canonical_review.py review tmp/projection-audit/canonical/canonical.json --team NYR --output /tmp/nyr-review.json
python3 data-pipeline/draftkit/canonical_review.py apply tmp/projection-audit/canonical/canonical.json --patch /tmp/review-patch.json --output /tmp/canonical-reviewed.json
python3 data-pipeline/draftkit/canonical_review.py history /tmp/canonical-reviewed.json
python3 data-pipeline/draftkit/canonical_review.py stage-payload /tmp/canonical-reviewed.json --output /tmp/canonical-stage-args.json
```

Outputs use exclusive creation. Choose a new output filename for each revision. The original input, imported workbook fields and evidence remain intact. `export` produces the entire canonical JSON, including notes and history, for downstream adapters. `review` is a filtered inspection report and cannot replace the canonical document.

Patch format:

```json
{
  "base_revision": "exact revision loaded by editor",
  "reason": "Reviewed goalie workload scenario",
  "evidence": ["Source URL or dated worksheet reference"],
  "player_updates": [
    {"player_id": "8482193", "changes": {"exposure": {"used": 2}, "role": {"notes": "Camp competition remains unresolved."}}}
  ],
  "team_updates": []
}
```

Player IDs, source records, imported workbook inputs, exposure units and baseline are immutable. Changing a team (or accepting its disagreement with the live directory) requires an explicit `team_assignment: {reviewed: true, evidence: "dated source reference"}` in the same player patch; the new team must exist in the schedule and all lineup identities must still reconcile. `rates` replaces the full rate map; `exposure`, `availability` and `role` merge only whitelisted fields. Notes belong to `role.notes`. Changing rates establishes a manual rate override, preserving the prior record in history; changing exposure establishes a season exposure override. A note or availability change never scales counts. Roster probability stays explicit metadata and never multiplies exposure again.

Team notes retain the original ordered note objects, including coordinates and source references; only their `text` may change. Appended notes require `authority: "manual_review"`. The patch carries dated evidence separately. Reviewers must not label an assumed camp lineup or imported injury scenario as verified without supporting evidence.

Each edit rejects a stale base revision, records the complete previous affected records, reason, evidence and timestamp, derives counts from rates times exposure exactly once, rebuilds team workload ledgers, and hashes the complete new document. Missing forecasts remain missing. Zero exposure remains zero. Invalid rates, unsupported statistics, altered source coordinates and mismatched lineup IDs fail validation.

The staging export is only the argument object for `canonical_stage_projection_run(p_payload jsonb)`. A separate authorized service-role operator can stage it, call `canonical_validate_projection_run(p_run_id uuid)`, inspect its errors, and only then consider `canonical_activate_projection_run(p_run_id uuid, p_expected_revision text, p_expected_active_revision text)`. Staging is not publication. These commands do not run any RPC. The database validator independently checks the payload; a local `publication_ready` flag is not sufficient authority.

Current imported data deliberately remains blocked from publication because of unallocated goalie priors, unresolved forecasts/lineup slots and overlapping skater camp scenarios. The offline editor always retains an explicit publication review gate. Resolving review scenarios does not mean claiming they are confirmed opening-night facts. SQL validation and an explicit publication review must be completed before deployment/activation. No production application has occurred.

Published exports must use `canonical_published_runs.source_payload` as the editable document and retain `source_run_id/source_revision` separately from the derived runtime `run_id/revision`. Nightly remaining counts and PostgreSQL hashes belong to the derived runtime snapshot; they do not replace the full-season editable source. For replacement activation, the operator must supply the exact runtime revision read when beginning review as `p_expected_active_revision`. A stale revision fails; only first activation into an empty season accepts null. The editor itself never invokes activation.

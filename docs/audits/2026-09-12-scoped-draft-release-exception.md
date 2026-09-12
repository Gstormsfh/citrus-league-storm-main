# Scoped production draft exception — review before dispatch

PR475 merged as f19d08420e5c1f82a6fc9f45278ddd563de19921, but production run34723184930 was refused by the draft freeze before either API or web deployment. Read-only investigation established that Roster text (3fd3e70c-fa85-432f-b98a-b29ce43a519c) was actively auto-picking:62→73→81picks, current source-event timestamps and active/in_progress lifecycle. The guard was correct.

After being informed of this activity, the user explicitly instructed: “Just proceed brother it doesn’t matter don’t worry it won’t progresss”. The coordinator authorized a release exception for that known draft only, not a pause/reset or a claim that it stopped. The existing repository-wide OVERRIDE_DRAFT_FREEZE switch also affects the engine and was not used or changed.

## Mechanism and boundaries

A manual Production Deploy dispatch on master must supply the exact40-character commit SHA, the one approved league UUID and a single-line10–500-character audit reason. The script verifies event, workflow name/path, ref, SHA equality and league allowlist before reading or bypassing anything. Invalid/partial input fails closed. It still calls the live guard RPC; any additional blocking league refuses the whole run. Database failure, null/non-array payloads and malformed blocker records remain fatal. Every workflow checkout is explicitly pinned to github.sha; the web artifact is downloaded from the same run. The audit logs supplied scope, reason, GitHub actor/run/attempt and the original blocker result; it never says an excepted active draft has stopped.

Inputs are mapped only on workflow_dispatch. Push runs and engine dispatches without these inputs keep their existing guard behavior. No repository variable, engine workflow, database state or authorization change is included. The normal lint/types/build/tests and API-first→web dependency chain remain intact. New subprocess regression tests execute the real guard with mocked RPC replies and are included in normal script CI and the production gate.

The exception applies to the pre-deploy guard snapshot, matching the existing workflow's timing; it does not continuously lock draft state. A manual dispatcher still requires existing GitHub workflow permissions. No other deployment checks are skipped.

## Proposed dispatch after review

Do not rerun old34723184930 with these inputs: f19d0842 predates this workflow. After exact-head review/all normal checks and merge, resolve the new master merge SHA, inspect its delta and confirm it contains only PR475 plus this reviewed exception work relative to f19d0842. A push-triggered run remains normally guarded. If that run succeeds after genuine clearance, no exception dispatch is needed. Otherwise, once the push run is terminal, propose/execute one manual dispatch of production-deploy.yml on master with:

- release_sha: the newly verified full merge SHA (must equal the dispatched run's headSha)
- draft_exception_league: 3fd3e70c-fa85-432f-b98a-b29ce43a519c
- draft_exception_reason: User explicitly approved PR475 production release despite the verified Roster text auto-draft; exception limited to this release and league, with draft state unchanged.

Recheck all intervening changes before dispatch; if master moves, mismatch refuses deployment. Record the actual run ID and exception audit, API serving revision/digest, Hosting version and public artifact hashes, then obtain normal-cache authenticated Test/Finalsz score/navigation acceptance from the existing browser owner. Local252–265ms replay remains a virtual scheduling result, not a production benchmark.

No dispatch has been executed by this PR. Coordinator review of the exact tested change is required before invoking it. Sourceaa5/runtime30e, forecasts, league settings, injury baseline, histories and draft state remain untouched. Build19 still needs the client addition before device acceptance; existing archives are preserved and signing/install/upload remain unauthorized. Rollback is a reviewed revert through the normal workflow, not a projection rollback or draft mutation.

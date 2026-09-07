# Local xG input/model/calibrator bundle proof

The saved development candidate now has a single immutable JSON inference
bundle per chronological fold. This is a tested local feature-row boundary,
not a production deployment or proof of complete original-input parity.

## Completed real-row parity

Evidence: `scripts/proof/results/offline-xg-bundle-proof-20260906-full/`.
`health.json` binds the declaration, two bundles, complete scored JSONL files,
source closure and report. No model or calibrator was refitted.

| Validation fold | Exact events | Raw versus saved/reversed/sampled singleton | Calibrated versus saved/reversed | Largest sampled singleton difference |
|---|---:|---|---|---:|
| Earlier | 120,080 | Exact | Exact | 2.0816681711721685e-17 |
| Later | 121,033 | Exact | Exact | 0 |

Every row was scored in batches of at most 4,096 and with its batch reversed.
The first row of each batch was also scored alone. Singleton calibration uses
the predeclared absolute tolerance 1e-12, relative tolerance zero. This is a
floating-point inference check, not a statistical accuracy tolerance.

An independent post-run review rehashed all seven health-bound output files
and 12,904 source-closure files. It checked every emitted event's uniqueness,
bundle identity, finite bounded probabilities and exact raw/calibrated match
against the saved conditional run, plus model/calibrator/schema lineage.
That review did not independently rescore the sampled singleton calls.

Each request carries the exact schema digest, event identity and every named
numeric/categorical input. Unknown values are explicit nulls; missing columns,
extra fields, outcomes, duplicate events within a batch, wrong schema and wrong
bundle identity fail. The proof additionally rejects duplicate events across
batches, empty folds, extra singleton outputs, and mismatched event order.

The bundle binds the saved training-only transform, model, conditional
calibrator, component hashes, source run/fold identity, runtime versions and
fixed inference-code hashes. Callers must supply an externally retained bundle
digest. Internal component hashes detect corruption; they do not independently
authenticate training provenance. The proof checks source file bytes against
the pinned completed run before bundling and rechecks inputs/code/output bytes
before completion.

The source rows come through `verified_movement_reuse_v2.py`, which rehashes
the completed source/feature certification and validates full cohort and
feature digests. Reuse is explicitly retrospective at the original
certification instant, not fresh source acquisition or historical-as-of proof.

Separate completed fast/slow receipts under
`verified-movement-reuse-v2-fast-20260906/` and
`verified-movement-reuse-v2-slow-20260906/` match every field digest and cohort
for both folds, including group vectors. The fast path disables source
projectors during its proof; the slow path recomputes baseline and movement
from retained source bodies. Main independently verified both report hashes
and exact comparison equality. Single local timings were 80.478 seconds for
reuse and 244.826 seconds for replay. Peak process memory was higher for reuse
(3,749,380,096 versus 2,461,876,224 bytes); this is not a universal speed or
memory improvement claim.

## Local verification and remaining gates

The complete offline pipeline suite passed **2,377 tests**, with 16 network
tests deselected and 33 existing UTC deprecation warnings. Receipt:
`scripts/proof/results/offline-bundle-verification-20260906-ledger-v7-full-suite.xml`.
The focused bundle/reuse/coverage/proof selection passed **79 tests**; receipt:
`scripts/proof/results/offline-bundle-verification-20260906-ledger-v7-focused.xml`.
Earlier v6 verification receipts remain retained separately.
Selections overlap and must not be added together as unique test counts.

Coverage ledger v7 preserves earlier obligations and adds these contracts,
including both reuse versions and their annotated feature-container fields;
547 items carry 3,829 unresolved decisions/gates. Enumeration is not acceptance.
The intermediate v6 remains retained; its missing explicit v2 contract entries
were caught in parent review and covered by a new regression test.
The number-verification skill was used to ground these counts in current run
receipts rather than inherit earlier model claims.

Live raw-event extraction, consumer-route integration, full legacy family
parity, independent/prospective predictive evidence and downstream GAR/FPAR
remain separate gates. This proof does not increase the previously measured
calibration gain, establish MoneyPuck equivalence, or support a world-leading
accuracy claim. Production, original artifacts and earlier failures remain
unchanged.

# Proposal: verified, content-addressed development feature reuse

Design only; no implementation, cache creation, frozen-file modification or
change to the running conditional experiment.

## Redundant work observed

`development_replay.py:157–220` rereads each frozen body and receipt, adapts
the same source, regenerates the same baseline features, compares every line
against an existing export, and reconstructs chronological cohorts. Each new
movement-derived runner then parses those bodies again for movement measurements.
The conditional runner additionally compares its movement vectors with the
completed movement feature audit. This is useful first certification, but
repeated identical parsing and arithmetic are avoidable after verified reuse.

The existing baseline `development.jsonl`, `groups.jsonl`, feature-audit and
game-inventory files already hold the baseline export. Completed movement and
zone runs hold their appended vectors and source/code hash closure. **Their
health status certifies completed execution, not a successful model-quality
guard.** A rejected model's correctly verified feature extraction remains usable;
no prediction quality or acceptance status should be laundered through a cache.

## Smallest safe fast path

Create a separately versioned cache builder that first performs one full replay
and byte-equivalence check. Store one canonical event table plus separately keyed
baseline, movement and optional zone feature tables. Store categorical values
explicitly, including nulls. Store exact fold membership, labels, group rows,
schema order and per-split cohort/source/feature digests; do not recompute labels
from predictions or collapse events by coordinates. Keep duplicate-event and
exact-population checks. A canonical table avoids storing the same event vector
repeatedly across expanding folds.

The cache identity is SHA-256 of a canonical manifest containing:

- Ordered source body/receipt path, size and digest inventory; complete schedule
  manifest and source eligibility rules, including excluded-game evidence.
- Complete extraction dependency closure and relevant runtime/library versions;
  baseline and appended schema versions, names, units, categorical semantics and
  missingness policy. A changed helper invalidates the affected feature family.
- Original export manifest/health digests, source-code declaration and completed
  movement/zone health receipts used for initial certification.
- Exact chronological split windows, identity selection, target definition,
  groups and cohort digests. These are not model-selection decisions.
- Cache format/version, canonical serialization contract, member byte sizes and
  hashes, and original replay-certification receipt. Time-sensitive source gates
  must be rechecked at reuse or have an explicit still-valid evaluation window;
  a code hash alone does not freeze the effect of a different current time.

To avoid a self-referential digest, derive the cache key from the input/contract
manifest; keep its generated-member manifest separately, bound by a final
create-only completion receipt. Use a scoped `cache/<key>/` directory and never
overwrite an existing entry. Incomplete attempts remain failed evidence rather
than being repaired in place.

## Every reuse remains verified

Before returning any rows, require a complete certification receipt and exact
directory inventory, with no failure marker, symlink, extra file, duplicate path,
traversal or conflicting digest. Rehash **every** declared input and cache member
from bytes, including source bodies and receipts; do not trust modification
times, sizes alone, a remembered validation result or a mutable `latest` alias.
Deduplicate identical hash checks within this one verification pass, not across
unverified future runs. Validate decoded rows, population partitions, feature
order, categorical membership and all cohort digests.

Recheck inputs and cache outputs at the end of the consuming run to detect
concurrent drift. Reuse avoids source JSON parsing, feature calculations and
repeated cohort expansion; it does **not** skip byte hashing or semantic row
validation. Record `verified_feature_cache_reuse`, original certification,
cache key and current verification receipt. Do not label it a fresh independent
raw-source replay or historical-as-of proof.

Any mismatch rejects the cache before fitting. A new attempt may explicitly
perform the slow replay and create a different entry; never silently fall back
mid-run, truncate populations, blend old/new family versions, or change the
declared method in place.

## Boundaries and acceptance tests

Keep fitted models, calibrators, medians, vocabularies and validation-driven
winner choices outside this feature cache. Fit preprocessing only on declared
training rows; fit calibration only on its declared earlier partition. A
separately pinned frozen model may still be reused under its own explicit
experiment plan—not because it happens to accompany a cached feature file.

Required tests: cold/full replay equals fast path in every event field and
digest; changing one source byte, label, split date, code helper, schema order,
category/null, group or receipt rejects reuse; extra/missing/duplicate members,
symlinks, path traversal and partial completion reject; concurrent drift rejects
at finalization; cache hit and miss return identical eligible populations.
Monkeypatch expensive projectors to raise on a certified cache hit, proving the
fast path actually avoids feature recomputation. Measure wall time and peak
memory on identical inputs before claiming speed gains. No current benchmark or
speedup number is asserted.

Prospective reservations, failed model results, original actuals and source
artifacts remain unchanged. New evidence links back to them without replacement.

# Availability review — the weekly injury pass

What a manager sees next to a player's name (OUT, IR, DTD, the sentence on the
card) comes from one place: the `availability` record on that player in the
canonical source document. Nothing else populates it. The ESPN injuries feed
(`player_talent_metrics.roster_status*`) has never written a row to
production; until it does, this pass is the whole system. Run it weekly during
camp, the day before every draft night, and whenever a report moves a player
the draft pool cares about.

Five steps. Steps 1–4 are offline and reversible. Step 5 writes production and
is the operator's keystroke.

## 1. Review — the CSV is the review

Copy the newest file in `data-pipeline/draftkit/availability/` to a new dated
name and edit it. One row per player:

| column | rule |
|---|---|
| `player_id` | the NHL id as it appears in the canonical document — never typed from memory; the generator refuses an id whose name/team do not match |
| `name`, `team` | must match the document exactly |
| `status` | `healthy` `injured` `out` `ir` `ltir` `day_to_day` `suspended` `unknown` — use the roster designation when a report gives one (IR/LTIR), `day_to_day` for "questionable", `out` for a stated absence |
| `reason` | for a manager: what happened and how long. "Shoulder surgery in August; no team timetable, out until at least Oct 31." No caveats, no provenance — that lives in the source record |
| `source_url` | https, the page you read. A dated article beats an aggregator; an aggregator is fine for "questionable for opening night" |
| `secondary_url` | optional second source |

Sources that have covered the league completely: the CBS injury report
(`cbssports.com/nhl/injuries/`) and Puckpedia (`puckpedia.com/injuries`).
Cross-check both; each misses players the other has. A player on a report but
not in the canonical document cannot be patched here (see the audit for who).

A row's `review_after` is derived: 7 days for `day_to_day`/`unknown`, 14 for
everything else. When it passes, the card says "review due" until the next
pass re-asserts or changes the row. That is the freshness guarantee — do not
extend it by hand.

## 2. Export the live source

```sh
node scripts/ops/projection-release/replacement/publish.mjs status
node scripts/ops/projection-release/replacement/publish.mjs export --out tmp/canonical/source-<first 8 of source_revision>.json
```

Record the `runtime_revision` the export prints. Activation needs it verbatim
as the compare-and-swap value; if anything publishes in between, activation
refuses and you start at step 2 again.

## 3. Patch, apply, publication review

```sh
python3 data-pipeline/draftkit/availability_patch.py \
  --source tmp/canonical/source-<rev8>.json \
  --csv data-pipeline/draftkit/availability/<date>-injury-reconciliation.csv \
  --as-of <date> --reviewed-by "<your name>" \
  --reason "<one line for review_history>" \
  --output tmp/canonical/patch-<date>.json

python3 data-pipeline/draftkit/canonical_review.py apply tmp/canonical/source-<rev8>.json \
  --patch tmp/canonical/patch-<date>.json --output tmp/canonical/edited-<date>.json

python3 data-pipeline/draftkit/canonical_review.py publication-review tmp/canonical/edited-<date>.json \
  --reason "<why this is publishable>" --reviewer "<your name>" --output tmp/canonical/reviewed-<date>.json

python3 data-pipeline/draftkit/canonical_review.py stage-payload tmp/canonical/reviewed-<date>.json \
  --output tmp/canonical/stage-args-<date>.json
```

`apply` runs the full production validator on every row and rejects the whole
patch on one bad row. `publication-review` clears only the publication gate,
records who and why in `review_history`, and re-digests; any other blocker
(coverage, crease budget, overlapping scenarios) refuses, because those are
findings, not a gate. Outputs are create-only: a new filename per revision.

## 4. Read what you are about to publish

```sh
python3 data-pipeline/draftkit/canonical_review.py history tmp/canonical/reviewed-<date>.json | tail -40
```

The last entry is your publication review; the one before it lists every
player changed with its `before`. If a row surprises you, fix the CSV and go
back to step 3 with a new output name.

## 5. Stage, validate, activate — production

```sh
node scripts/ops/projection-release/replacement/publish.mjs stage --payload tmp/canonical/stage-args-<date>.json
node scripts/ops/projection-release/replacement/publish.mjs validate --run-id <uuid from stage>
node scripts/ops/projection-release/replacement/publish.mjs activate --run-id <uuid> --revision <reviewed revision> --expected-active <runtime_revision from step 2>
node scripts/ops/projection-release/replacement/publish.mjs activate --run-id <uuid> --revision <reviewed revision> --expected-active <runtime_revision from step 2> --yes
```

`stage` sends the file's bytes verbatim (never a JavaScript re-serialization —
that can rewrite a number and break the digest). `validate` must return
`valid: true`. `activate` without `--yes` prints the swap it would make and
re-reads the active revision; with `--yes` it performs the single-transaction
switch and prints the new `status`. Then open one changed player's card on
production and read the sentence.

## What this does not do

- It does not touch rates, exposure, roles or lineups. Those have their own
  review; see `data-pipeline/draftkit/CANONICAL_REVIEW.md`.
- It does not fix the ESPN feed. When that feed works, its rows become the
  `reported_status` candidate the resolver already prefers for freshness, and
  this pass shrinks to the players the feed gets wrong.
- It cannot add a player the canonical document does not carry. Those are
  listed in the dated audit; adding a player is a `player_additions` review
  with a full record and identity evidence.

Credentials: `.env.admin.local` at the repo root (gitignored) carries
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The publish tool refuses any
URL that is not the production project.

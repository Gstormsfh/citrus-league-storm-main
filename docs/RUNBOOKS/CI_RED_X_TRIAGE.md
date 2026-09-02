# CI is red — triage in 60 seconds

> Written 2026-09-02, after twenty open branches all failed the same three
> Python assertions for a week and nobody could see why from the run page.

## The 60-second version

1. Open the failing run. Look at the **Branch Freshness (advisory)** job first.
   It never fails; it prints how far behind `master` the branch is and which
   files `master` changed that this branch never opened.
2. **Behind by 0** → the failure is this branch's. Read it normally.
3. **Behind by more than 0** → before reading the failure, run:

   ```bash
   git fetch origin && git merge origin/master   # or: git rebase origin/master
   ```

   Push, and look again. A failure that survives that is yours.

## Why this exists

On 2026-09-01 four PRs landed on `master`:

| PR | What it did |
|---|---|
| #387 | real win chance and projected finals in the matchup header |
| #388 | recalibrated `dynamic_confidence` for the new default scoring, and **rewrote the three tests that encode it** |
| #389 | slot chips, mirrored rows, actual-over-projected on mobile |
| #390 | CI trigger housekeeping (`push` narrowed to `master`) |

Twenty branches were open at the time. All twenty were cut before #388.
`.github/workflows/ci.yml` runs `pytest tests/` on every PR, so all twenty
inherited the pre-#388 copy of `data-pipeline/tests/test_projection_uncertainty.py`
and failed the same three assertions on every push — assertions about scoring
weights, in a file none of those branches had opened.

The signal on the run page was `3 failed, 323 passed`, with a traceback about
`goals*3, assists*2`. Nothing said "you are four commits behind." That is the
gap the freshness job closes.

### The specific trap

#385 changed default scoring to the Yahoo-aligned weights (G6 A4 PPP2 SOG0.9
BLK1). Those wider weights widened the Monte Carlo fantasy-point distribution,
which pushed the coefficient of variation up, which drove `1 - cv` into the
0.05 floor for ~90% of skaters and labelled 99% of them "Low". #388 replaced
the linear map with one linear in `ln(CV)` and re-derived the fixtures from
`DEFAULT_SCORING_WEIGHTS` so they cannot go stale again.

A branch without #388 has the old fixtures and the old map. It cannot pass.

## The three failure shapes, and which is yours

| Symptom | Whose | What to do |
|---|---|---|
| Freshness says behind, failure is in files only `master` touched | Not yours | merge `master` in |
| Freshness says behind, failure is in files you touched | Yours, possibly a real conflict | merge `master` in, then fix |
| Freshness says up to date | Yours | read the failure |

`Data Pipeline Tests (Python)` also prints a `::notice::` on failure pointing
back at the freshness job, so a red pytest never appears without the pointer.

### One implementation detail worth knowing

The freshness job checks out `github.event.pull_request.head.sha`, not the
default. For a `pull_request` event `actions/checkout` gives you
`refs/pull/N/merge` — a commit that **already contains the base** — so
measuring distance from there always reports zero. That is precisely the blind
spot this job exists to remove, so it would have been a quiet no-op.

## Preventing the next one

- **Merge `master` into a long-lived branch the day a PR lands on it.** The
  cost of a same-day merge is minutes; the cost at week's end was this file.
- **Turn on "Require branches to be up to date before merging"** in branch
  protection for `master`. CI cannot enforce it; only that setting can. It is
  the single change that makes this class of failure impossible.
- **Keep branches short-lived.** Twenty concurrent branches against a moving
  trunk is the actual root cause; everything above is mitigation.
- `apps/web/harness/README.md` is `merge=union` in `.gitattributes` — its
  route table is append-only and used to conflict on nearly every branch.
